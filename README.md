# @hyperswarm/discovery

The hyperswarm peer discovery module

```
npm install @hyperswarm/discovery
```

## Usage

``` js
const discovery = require('@hyperswarm/discovery')
const crypto = require('crypto')

const d = discovery()
const key = crypto.randomBytes(32)

const ann = d.announce(key, {
  port: 10000
})

const lookup = d.lookup(key)

// emitted when a peer is found
lookup.on('peer', console.log)
```

## API

#### `d = discovery([options])`

Create a new discovery instance

Options include:

```js
{
  // Optionally overwrite the default set of bootstrap servers
  bootstrap: [addresses],
  // Set to false if this is a long running instance on a server
  // When running in ephemeral mode you don't join the DHT but just 
  // query it instead. If unset, or set to a non-boolean (default undefined)
  // then the node will start in short-lived (ephemeral) mode and switch 
  // to long-lived (non-ephemeral) mode after a certain period of uptime
  ephemeral: undefined,
  // Pass in your own udp/utp socket (needed for hole punching)
  socket: (a udp or utp socket)
}
```

#### `topic = d.lookup(key)`

Start looking for peers shared on `key`, which should be a 32 byte buffer.

* `topic.destroy()` - Call this to stop looking for peers
* `topic.update()` - Call this to force update
* `topic.on('update')` - Emitted when a peer discovery cycle has finished
* `topic.on('peer', peer)` - Emitted when a peer is found
* `topic.on('close')` - Emitted when this topic is fully closed

It is up to you to call `.destroy()` when you don't wanna look for anymore peers.
Note that the same peer might be emitted multiple times.

An update cycle indicates that you are done querying the DHT and that
the topic instance will sleep for a bit (~5-10min) before querying it again

#### `topic = d.announce(key, options)`

Start announcing a `key`. `topic` has the same API as lookup.

Options include:

```js
{
  // If you set port: 0 the port of the discovery socket is used.
  port: (port you want to announce),
  localPort: (LAN port you wanna announce),
  // Set to true to also do a lookup in parallel.
  // More efficient than calling .lookup() in parallel yourself.
  lookup: false
}
```

When the topic is destroyed the port will be explicitly unannounced
from the network as well

#### `d.lookupOne(key, cb)`

Find a single peer and returns that to the callback.

#### `d.ping(cb)`

Ping all bootstrap servers. Returns an array of results:

```
[
  {
    bootstrap: (bootstrap node that replied),
    rtt: (round trip time in ms),
    pong: {
      host: (your ip),
      port: (your port)
    }
  }
]
```

If your IP and port is consistent across the bootstrap nodes
holepunching *usually* works.

#### `d.holepunch(peer, cb)`

UDP holepunch to another peer.

#### `d.flush(cb)`

Call the callback when all pending DHT operations are fully flushed.

#### `d.destroy()`

Fully destroy the discovery instance, and it's underlying resources.
Will *also* destroy the socket you passed in the constructor.

All running announces will be unannounced as well.

Will emit `close` when the instance if fully closed.

## License

MIT
