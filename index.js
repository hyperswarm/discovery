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
    this.destroyed = false
    this.id = Buffer.concat([Buffer.from('id='), crypto.randomBytes(32)])

    const port = opts.localPort || 0
    const name = discovery._domain(key)

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
    for (const peer of (data.localPeers || EMPTY)) {
      this.emit('peer', { port: peer.port, host: peer.host, local: true, referrer: null, topic })
    }
    for (const peer of (data.peers || EMPTY)) {
      this.emit('peer', { port: peer.port, host: peer.host, local: false, referrer, topic })
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
  }

  _startDht () {
    const dht = this._discovery.dht
    const self = this
    const key = this.key
    const ondata = this._ondhtdata.bind(this)

    loop()

    function loop () {
      var called = false

      const ann = self.announce
      const stream = ann ? dht.announce(key, ann) : dht.lookup(key)
      self._timeoutDht = null
      self._stream = stream

      stream.on('data', ondata)
      stream.on('error', done)
      stream.on('end', done)

      function done (err) {
        if (called || self.destroyed) return
        self._stream = null
        called = true
        self.emit('update', err)
        self._timeoutDht = self._discovery._notify(loop, false)
      }
    }
  }
}

class Discovery extends EventEmitter {
  constructor (opts) {
    super()

    if (!opts) opts = {}

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

  lookupOne (key, cb) {
    const onclose = () => cb(new Error('Lookup failed'))

    this.lookup(key)
      .on('close', onclose)
      .once('peer', onpeer)

    function onpeer (peer) {
      this.removeListener('close', onclose)
      this.destroy()

      cb(null, peer)
    }
  }

  lookup (key) {
    if (this.destroyed) throw new Error('Discovery instance is destroyed')

    return this._topic(key)
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

  destroy () {
    if (this.destroyed) return
    this.destroyed = true

    const self = this
    var missing = 1

    this.mdns.destroy()

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

  _topic (key, ann) {
    const topic = new Topic(this, key, ann)
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

  _onmdnsquery (res) {
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

    if (r.answers.length) this.mdns.response(r)
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
