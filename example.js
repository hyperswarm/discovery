const discovery = require('./')

const d = discovery()
const k = Buffer.alloc(32)

const topic = d.lookup(k)
topic.on('peer', peer => console.log('peer:', peer))

d.announce(k, {
  port: 10000,
  lookup: true
}).on('peer', peer => console.log('peer:', peer))

const ann = d.announce(k, {
  port: 10101
})

ann.once('update', function () {
  console.log('onupdate')
  d.unannounce(ann, () => {
    const d2 = discovery()
    d2.lookup(k)
      .on('peer', peer => console.log('more peers:', peer)) 
    setTimeout(() => {
      ann.destroy()
    }, 1000);
  })
})

setTimeout