const dht = require('hyperdht')
const multicast = require('multicast-dns')
const { EventEmitter } = require('events')

module.exports = opts => new Discovery(opts)

class Topic extends EventEmitter {
  constructor (discovery, key, opts) {
    super()

    if (!opts) opts = {}

    this.key = key
    this.announce = opts.announce || null
    this.destroyed = false

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

    const referrer = data.node
    for (const peer of data.localPeers) {
      this.emit('peer', peer, true, null)
    }
    for (const peer of data.peers) {
      this.emit('peer', peer, false, referrer)
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

    if (!opts.bootstrap) {
      opts.bootstrap = [
        'bootstrap1.hyperdht.org',
        'bootstrap2.hyperdht.org',
        'bootstrap3.hyperdht.org'
      ]
    }

    opts.ephemeral = opts.ephemeral !== false

    this.destroyed = false
    this.dht = dht(opts)
    this.mdns = multicast()

    this.mdns.on('query', this._onmdnsquery.bind(this))
    this.mdns.on('response', this._onmdnsresponse.bind(this))

    const domain = opts.domain || 'hyperswarm.local'

    this._tld = '.' + domain
    this._domains = new Map()
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

      for (const topic of set) {
        topic.emit('peer', { host, port: a.data.port }, true, null)
      }
    }
  }

  _onmdnsquery (res) {
    const r = { answers: [] }

    for (const q of res.questions) {
      const set = q.type === 'SRV' && this._domains.get(q.name)
      if (!set) continue

      for (const topic of set) {
        if (topic._answer) r.answers.push(topic._answer)
      }
    }

    this.mdns.response(r)
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
