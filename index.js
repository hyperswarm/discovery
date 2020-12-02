const dht = require('@hyperswarm/dht')
const multicast = require('multicast-dns')
const { EventEmitter } = require('events')
const crypto = require('crypto')

const EMPTY = []

module.exports = opts => new Discovery(opts)

class Topic extends EventEmitter {
  constructor (discovery, key, opts) {
    super()

    if (!opts) opts = {}

    this.key = key
    this.announce = opts.announce || null
    this.lookup = opts.lookup || null
    this.destroyed = false
    this.id = Buffer.concat([Buffer.from('id='), crypto.randomBytes(32)])

    const port = opts.localPort || 0
    const name = discovery._domain(key)

    this._flush = []
    this._flushPending = false
    this._discovery = discovery
    this._timeoutDht = null
    this._timeoutMdns = null
    this._stream = null
    this._domain = name
    this._answer = port
      ? { type: 'SRV', name, data: { target: '0.0.0.0', port } }
      : null
    this._idAnswer = { type: 'TXT', name, data: [ this.id ] }
    this._startDht()
    if (!this.announce || opts.lookup) this._startMdns()
    if (this.announce) process.nextTick(this._fireAnnounce.bind(this))
  }

  _fireAnnounce () { // firing once right away make lookup, then announce much faster
    this._discovery._onmdnsquery({
      questions: [{ type: 'SRV', name: this._domain }],
      answers: []
    }, null)
  }

  update () {
    if (this.destroyed) return
    if (this._timeoutDht) {
      clearTimeout(this._timeoutDht)
      this._timeoutDht = null
      this._startDht()
    }
    clearTimeout(this._timeoutMdns)
    this._startMdns()
  }

  flush (cb) {
    if (this._flushPending) {
      this._flush.push(cb)
    } else {
      cb(null)
    }
  }

  destroy () {
    if (this.destroyed) return
    this.destroyed = true

    this._stopDht()
    clearTimeout(this._timeoutMdns)

    const set = this._discovery._domains.get(this._domain)
    set.delete(this)
    if (!set.size) this._discovery._domains.delete(this._domain)

    const onclose = this.emit.bind(this, 'close')

    if (!this.announce) return process.nextTick(onclose)
    this._discovery.dht.unannounce(this.key, this.announce, onclose)
  }

  _ondhtdata (data) {
    if (this.destroyed) return

    const topic = this.key
    const referrer = data.node
    const to = data.to

    for (const peer of (data.localPeers || EMPTY)) {
      this.emit('peer', { port: peer.port, host: peer.host, local: true, to, referrer: null, topic })
    }
    for (const peer of (data.peers || EMPTY)) {
      this.emit('peer', { port: peer.port, host: peer.host, local: false, to, referrer, topic })
    }
  }

  _startMdns () {
    const self = this

    const query = {
      questions: [{
        type: 'SRV',
        name: this._domain
      }]
    }

    loop()

    function loop () {
      self._discovery.mdns.query(query)
      self._timeoutMdns = self._discovery._notify(loop, true)
    }
  }

  _stopDht () {
    clearTimeout(this._timeoutDht)
    this._timeoutDht = null
    if (this._stream) this._stream.destroy()

    const flush = this._flush
    this._flush = []
    for (const cb of flush) cb(null)
  }

  _startDht () {
    const dht = this._discovery.dht
    const self = this
    const key = this.key
    const ondata = this._ondhtdata.bind(this)

    loop()

    function loop () {
      var called = false
      var flushed = false

      let maxReplies = 1
      let maxCount = 0
      let maxLocalReplies = 1
      let maxLocalCount = 0

      const ann = self.announce
      const stream = ann ? dht.announce(key, ann) : dht.lookup(key, self.lookup)

      self.emit('updating')

      self._timeoutDht = null
      self._flushPending = true
      self._stream = stream

      stream.on('data', function (data) {
        if (data.peers) {
          if (data.peers.length > maxReplies && data.peers.length < 16) {
            maxReplies = data.peers.length
            maxCount = 1
          } else if (data.peers.length >= maxReplies) {
            maxCount++
          }
        }
        if (data.localPeers) {
          if (data.localPeers.length > maxReplies && data.localPeers.length < 16) {
            maxLocalReplies = data.localPeers.length
            maxLocalCount = 1
          } else if (data.localPeers.length >= maxLocalReplies) {
            maxLocalCount++
          }
        }

        ondata(data)
        if (!flushed && (maxLocalCount >= 6 || maxCount >= 6)) onflush()
      })

      stream.on('error', done)
      stream.on('end', done)
      stream.on('close', done)

      function done (err) {
        if (called || self.destroyed) return
        self._stream = null
        called = true
        self.emit('update', err)
        self._timeoutDht = self._discovery._notify(loop, false)
        onflush(err)
      }

      function onflush (err) {
        if (flushed) return
        flushed = true
        self._flushPending = false
        const flush = self._flush
        self._flush = []
        for (const cb of flush) cb(null, !err)
      }
    }
  }
}

class Discovery extends EventEmitter {
  constructor (opts) {
    super()

    if (!opts) opts = {}

    if (!('adaptive' in opts)) {
      // if ephemeral is undefined, null or anything other than a boolean
      // then this signifies adaptive ephemerality
      opts.adaptive = typeof opts.ephemeral !== 'boolean'
    }
    // ephemeral defaults to true in discovery but defaults to false in dht
    opts.ephemeral = opts.ephemeral !== false

    this.destroyed = false
    this.dht = dht(opts)
    this.mdns = opts.multicast || multicast()

    this.mdns.on('query', this._onmdnsquery.bind(this))
    this.mdns.on('response', this._onmdnsresponse.bind(this))

    const domain = opts.domain || 'hyperswarm.local'

    this._tld = '.' + domain
    this._domains = new Map()
    this._bootstrap = this.dht.bootstrapNodes
  }
  get ephemeral () {
    return this.dht.ephemeral
  }
  ping (cb) {
    const res = []
    const len = this._bootstrap.length

    if (!len) {
      return process.nextTick(cb, new Error('No bootstrap nodes available'))
    }

    var missing = len
    const start = Date.now()

    for (const bootstrap of this._bootstrap) {
      this.dht.ping(bootstrap, function (_, pong) {
        if (pong) res.push({ bootstrap, rtt: Date.now() - start, pong })
        if (--missing) return
        if (!res.length) return cb(new Error('All bootstrap nodes failed'))
        cb(null, res)
      })
    }
  }

  holepunchable (cb) {
    this.ping(function (err, res) {
      if (err) return cb(err)
      if (res.length < 2) return cb(new Error('Not enough bootstrap nodes replied'))
      const first = res[0].pong
      for (var i = 1; i < res.length; i++) {
        const pong = res[i].pong
        if (pong.host !== first.host || pong.port !== first.port) {
          return cb(null, false)
        }
      }

      cb(null, true)
    })
  }

  flush (cb) {
    let missing = 1

    for (const set of this._domains.values()) {
      for (const topic of set) {
        missing++
        topic.flush(onflush)
      }
    }

    onflush()

    function onflush () {
      if (!--missing) cb()
    }
  }

  lookupOne (key, opts, cb) {
    if (typeof opts === 'function') return this.lookupOne(key, null, opts)
    const onclose = () => cb(new Error('Lookup failed'))

    this.lookup(key, opts)
      .on('close', onclose)
      .once('peer', onpeer)

    function onpeer (peer) {
      this.removeListener('close', onclose)
      this.destroy()

      cb(null, peer)
    }
  }

  lookup (key, opts) {
    if (this.destroyed) throw new Error('Discovery instance is destroyed')

    return this._topic(key, {
      lookup: opts || null
    })
  }

  announce (key, opts) {
    if (this.destroyed) throw new Error('Discovery instance is destroyed')

    const topic = this._topic(key, {
      localPort: opts.localPort || opts.port || 0,
      lookup: opts && opts.lookup,
      announce: {
        port: opts.port || 0,
        localAddress: opts.localAddress
      }
    })

    return topic
  }

  holepunch (peer, cb) {
    if (!peer.referrer) return process.nextTick(new Error('Referrer needed to holepunch'))
    this.dht.holepunch(peer, cb)
  }

  destroy (opts) {
    if (this.destroyed) return
    this.destroyed = true

    if (!opts) opts = {}

    const self = this
    var missing = 1

    this.mdns.destroy()
    if (opts.force) return process.nextTick(done)

    for (const set of this._domains.values()) {
      for (const topic of set) {
        missing++
        topic.destroy()
        topic.on('close', done)
      }
    }

    process.nextTick(done)

    function done () {
      if (--missing) return
      self.dht.destroy()
      self.emit('close')
    }
  }

  _getId (res, name) {
    for (const a of res.answers) {
      if (a.type === 'TXT' && a.name === name && a.data.length) {
        return a.data[0]
      }
    }
    return null
  }

  _topic (key, opts) {
    const topic = new Topic(this, key, opts)
    const domain = this._domain(key)
    if (!this._domains.has(domain)) {
      this._domains.set(domain, new Set())
    }
    const set = this._domains.get(domain)
    set.add(topic)
    return topic
  }

  _onmdnsresponse (res, rinfo) {
    for (const a of res.answers) {
      const set = a.type === 'SRV' && this._domains.get(a.name)
      if (!set) continue

      const host = a.data.target === '0.0.0.0'
        ? rinfo.address
        : a.data.target
      const id = this._getId(res, a.name)

      for (const topic of set) {
        if (id && id.equals(topic.id)) continue
        topic.emit('peer', { port: a.data.port, host, local: true, referrer: null, topic: topic.key })
      }
    }
  }

  _onmdnsquery (res, rinfo) {
    const r = { answers: [] }

    for (const q of res.questions) {
      const set = q.type === 'SRV' && this._domains.get(q.name)
      if (!set) continue

      const id = this._getId(res, q.name)
      for (const topic of set) {
        if (id && topic.id.equals(id)) continue
        if (topic._answer) {
          r.answers.push(topic._answer)
          r.answers.push(topic._idAnswer)
        }
      }
    }

    if (r.answers.length && rinfo) {
      r.answers.push({
        type: 'A',
        name: 'referrer' + this._tld,
        data: rinfo.address
      })
    }
    if (r.answers.length) {
      this.mdns.response(r)
    }
  }

  _domain (key) {
    return key.slice(0, 20).toString('hex') + this._tld
  }

  _notify (fn, eager) {
    const wait = eager
      ? 30000
      : 300000
    return setTimeout(fn, Math.floor(wait + Math.random() * wait))
  }
}
