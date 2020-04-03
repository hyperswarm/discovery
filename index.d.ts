import { EventEmitter } from 'events'
import { Socket } from 'net'
import { HyperDHT } from '@hyperswarm/dht'

declare function _exports(opts?: DiscoveryOptions): Discovery;
export default _exports;

export interface DiscoveryOptions {
  /** Optionally overwrite the default set of bootstrap servers */
  bootstrap: String[],
  /** Set to false if this is a long running instance on a server When running in ephemeral mode you don't join the DHT but just query it instead. If unset, or set to a non-boolean (default undefined) then the node will start in short-lived (ephemeral) mode and switch to long-lived (non-ephemeral) mode after a certain period of uptime*/
  ephemeral: boolean,
  /**  Pass in your own udp/utp socket (needed for hole punching) */
  socket: Socket
}

export interface AnnounceOptions {
  /** Port you want to announce. If you set port: 0 the port of the discovery socket is used. */
  port?: number,
  /** LAN port you want to announce */
  localPort?: number,
  /** Set to true to also do a lookup in parallel. More efficient than calling .lookup() in parallel yourself. */
  lookup?: boolean
  length?: number
  includeLength?: boolean
  localAddress?:string
}

export interface Peer {
  port?: number
  host?: string
  referrer?: Peer
  topic?: Buffer
}

export declare class Discovery extends EventEmitter {
  constructor(opts?: DiscoveryOptions);
  on( event:string, listener: any ):this
  on( event: 'peer', listener: (peer:Peer) => void ):this
  on( event: 'close', listener: () => void ):this

  destroyed: boolean;
  dht: HyperDHT;
  /** add type here if multicast-dns ever gets typings*/
  mdns: any;
  private _tld: string;
  private _domains: any;
  private _bootstrap: any;
  get ephemeral(): any;
  /** ping all bootstrap servers. Returns an array of results */
  ping(cb: ( result: Array<{ bootstrap: string, rtt: number, pong: { host: string, port: number }}> ) => {}): any;
  holepunchable(cb: ( err:Error, holepunchable:boolean ) => void): void;
  /** Call the callback when all pending DHT operations are fully flushed. */
  flush(cb: () => void ): void;
  /** Find a single peer and returns that to the callback. */
  lookupOne(topic: Buffer, opts?: TopicOptions['lookup'], cb?: () => void ): Peer;
  /** Start looking for peers shared on key, which should be a 32 byte buffer. */
  lookup(topic: Buffer, opts?: TopicOptions['lookup']): Topic;
  /** Start announcing a key. topic has the same API as lookup. */
  announce(topic: Buffer, opts?: AnnounceOptions): Topic;
  /** UDP holepunch to another peer. */
  holepunch(peer: Peer, cb: () => void ): any;
  /** Fully destroy the discovery instance, and it's underlying resources. Will also destroy the socket you passed in the constructor. All running announces will be unannounced as well. Will emit close when the instance if fully closed. */
  destroy(opts?: { force:boolean, }): any;
  private _getId(res: any, name: any): any;
  private _topic(key: any, opts: any): Topic;
  private _onmdnsresponse(res: any, rinfo: any): void;
  private _onmdnsquery(res: any, rinfo: any): void;
  private _domain(key: any): string;
  private _notify(fn: any, eager: any): number;
}

export interface TopicOptions {
  announce?: {
    port?: number,
    localAddress?: string
    length?:number,
    includeLength?:boolean
  }
  lookup?:boolean
  localPort?:number
}


export declare class Topic extends EventEmitter {
  constructor(discovery: Discovery, key: Buffer, opts?: TopicOptions);
  on( event:string, listener: any ):this
  on( event: 'peer', listener: (peer:Peer) => void ):this
  on( event: 'update', listener: () => void ):this
  on( event: 'close', listener: () => void ):this


  key: Buffer;
  announce: boolean;
  lookup: boolean;
  destroyed: boolean;
  id: Buffer;
  private _flush: any[];
  private _flushPending: boolean;
  private _maxLength: number;
  private _discovery: any;
  private _timeoutDht: any;
  private _timeoutMdns: any;
  private _stream: any;
  private _domain: any;
  private _answer: {
    type: string;
    name: any;
    data: {
      target: string;
      port: any;
    };
  };
  private _idAnswer: {
    type: string;
    name: any;
    data: any[];
  };
  private _fireAnnounce(): void;
  update(): void;
  flush(cb: ( err:Error, result: { maxLength:number }) => void ): void;
  destroy(): void;
  private _ondhtdata(data: any): void;
  private _startMdns(): void;
  private _stopDht(): void;
  private _startDht(): void;
}
