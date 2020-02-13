const crypto = require('crypto')
const test = require('tape')
const dht = require('dht-rpc')
const discovery = require('./')

const bootstrap = dht({ ephemeral: true })
var bootstrapPort

test('setup bootstrap', t => {
  bootstrap.listen(null, err => {
    t.error(err)

    bootstrapPort = bootstrap.socket.address().port
    t.pass(`bootstrap listening at 127.0.0.1:${bootstrapPort}`)
    t.end()
  })
})

test('ping', t => {
  const d1 = inst()
  d1.ping((err, res) => {
    t.error(err)

    t.equal(res.length, 1, 'one bootstrap pinged')
    t.equal(res[0].bootstrap.port, bootstrapPort, 'pinged bootstrap port is correct')
    t.equal(res[0].bootstrap.host, '127.0.0.1', 'pinged bootstrap host is correct')
    t.ok(typeof res[0].rtt === 'number', 'ping rtt number is included')
    t.equal(res[0].pong.host, '127.0.0.1', 'pinged pong host is correct')
    t.ok(typeof res[0].pong.port === 'number', 'pinged pong port number is included')

    d1.destroy()
    t.end()
  })
})

test('announce & lookup', t => {
  const key = crypto.randomBytes(32)
  const d1 = inst()
  const d2 = inst()

  const to = setTimeout(() => {
    t.fail('Timed out waiting for lookup')
    d1.destroy()
    d2.destroy()
    t.end()
  }, 5e3)

  const port = allocPort()
  d1.announce(key, { port })
  const lookup = d2.lookup(key)
  lookup.on('peer', (peer) => {
    clearTimeout(to)

    t.equal(peer.port, port, 'peer port is as expected')
    t.ok(typeof peer.host === 'string', 'peer host string is included')
    t.equal(peer.local, true, 'peer was local')
    t.equal(peer.referrer, null, 'peer referrer is null')

    d1.destroy()
    d2.destroy()
    t.end()
  })
})

test('announce & lookupOne', t => {
  const key = crypto.randomBytes(32)
  const d1 = inst()
  const d2 = inst()

  const to = setTimeout(() => {
    t.fail('Timed out waiting for lookup')
    d1.destroy()
    d2.destroy()
    t.end()
  }, 5e3)

  const port = allocPort()
  d1.announce(key, { port })
  d2.lookupOne(key, (err, peer) => {
    clearTimeout(to)
    t.error(err)

    t.equal(peer.port, port, 'peer port is as expected')
    t.ok(typeof peer.host === 'string', 'peer host string is included')
    t.equal(peer.local, true, 'peer was local')
    t.equal(peer.referrer, null, 'peer referrer is null')

    d1.destroy()
    d2.destroy()
    t.end()
  })
})

test('announce & announce with lookup = true', t => {
  const key = crypto.randomBytes(32)
  const d1 = inst()
  const d2 = inst()

  const to = setTimeout(() => {
    t.fail('Timed out waiting for peers')
    d1.destroy()
    d2.destroy()
    t.end()
  }, 5e3)

  const port1 = allocPort()
  const ann1 = d1.announce(key, { port: port1, lookup: true })
  const port2 = allocPort()
  const ann2 = d2.announce(key, { port: port2, lookup: true })

  var hits = 2
  function onPeer (port) {
    return (peer) => {
      t.equal(peer.port, port, 'peer port is as expected')
      t.ok(typeof peer.host === 'string', 'peer host string is included')
      t.equal(peer.local, true, 'peer was local')
      t.equal(peer.referrer, null, 'peer referrer is null')

      if (!(--hits)) {
        clearTimeout(to)
        d1.destroy()
        d2.destroy()
        t.end()
      }
    }
  }

  ann1.on('peer', onPeer(port2))
  ann2.on('peer', onPeer(port1))
})

test('flush discovery', t => {
  const key = crypto.randomBytes(32)
  const d1 = inst({ ephemeral: false })
  const d2 = inst({ ephemeral: false })

  d2.dht.bootstrap(() => {
    d1.flush(function () {
      d1.announce(key, { port: 1001 })
      d1.announce(key, { port: 1002 })
      d1.flush(function () {
        const peers = []
        d1.lookup(key).on('peer', function (peer) {
          peers.push(peer.port)

          if (peers.length === 4) {
            peers.sort()
            t.same(peers, [
              1001,
              1001,
              1002,
              1002
            ])
            d1.destroy()
            d2.destroy()
            t.end()
          }
        })
      })
    })
  })
})

test.onFinish(() => {
  bootstrap.destroy()
})

function inst (opts = {}) {
  return discovery(Object.assign({ bootstrap: [`127.0.0.1:${bootstrapPort}`] }, opts))
}

var nextPort = 10000
function allocPort () {
  return nextPort++
}
