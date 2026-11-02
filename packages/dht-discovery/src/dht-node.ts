import * as dgram from 'dgram';
import * as crypto from 'crypto';
import { PeerInfo, hashDhtKey } from '@desudn/shared';
import { DhtMessage, DhtMessageType, DhtNodeInfo } from './types.js';
import { RoutingTable } from './routing-table.js';
import { ProviderStore } from './provider-store.js';

export interface DhtNodeOptions {
  nodeId?: string;
  host?: string;
  port?: number;
  bootstrapNodes?: string[]; // array of "host:port"
  providerTtlMs?: number;
  requestTimeoutMs?: number;
}

export class DhtNode {
  public readonly nodeId: string;
  public readonly host: string;
  public port: number;
  private socket: dgram.Socket;
  private routingTable: RoutingTable;
  private providerStore: ProviderStore;
  private pendingRequests: Map<
    string,
    { resolve: (msg: DhtMessage) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  > = new Map();
  private isListening = false;
  private requestTimeoutMs: number;

  constructor(options: DhtNodeOptions = {}) {
    this.nodeId = options.nodeId || crypto.randomBytes(20).toString('hex');
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 0; // 0 for random available port
    this.requestTimeoutMs = options.requestTimeoutMs || 800; // Snappy timeout for responsive peer detection

    this.routingTable = new RoutingTable(this.nodeId);
    this.providerStore = new ProviderStore(options.providerTtlMs);
    this.socket = dgram.createSocket('udp4');
    this.setupSocket();
  }

  get localInfo(): DhtNodeInfo {
    return {
      nodeId: this.nodeId,
      host: this.host,
      port: this.port,
    };
  }

  private setupSocket(): void {
    this.socket.on('message', (msgBuffer, rinfo) => {
      try {
        const raw = msgBuffer.toString('utf-8');
        const message: DhtMessage = JSON.parse(raw);
        this.handleMessage(message, rinfo.address, rinfo.port);
      } catch {
        // Ignore malformed packets
      }
    });

    this.socket.on('error', (err) => {
      // console.error(`DHT socket error [${this.nodeId.slice(0, 8)}]:`, err.message);
    });
  }

  async start(): Promise<void> {
    if (this.isListening) return;

    return new Promise((resolve, reject) => {
      this.socket.bind(this.port, this.host, () => {
        const addr = this.socket.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
        }
        this.isListening = true;
        resolve();
      });

      this.socket.once('error', (err) => {
        if (!this.isListening) reject(err);
      });
    });
  }

  async close(): Promise<void> {
    if (!this.isListening) return;

    for (const [id, req] of this.pendingRequests.entries()) {
      clearTimeout(req.timer);
      req.reject(new Error('DHT node closed'));
    }
    this.pendingRequests.clear();
    this.providerStore.destroy();

    return new Promise((resolve) => {
      this.socket.close(() => {
        this.isListening = false;
        resolve();
      });
    });
  }

  private handleMessage(message: DhtMessage, remoteHost: string, remotePort: number): void {
    // Learn sender info into routing table
    if (message.sender && message.sender.nodeId !== this.nodeId) {
      this.routingTable.addNode({
        nodeId: message.sender.nodeId,
        host: remoteHost,
        port: message.sender.port || remotePort,
      });
    }

    // Handle responses
    const pending = this.pendingRequests.get(message.msgId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.msgId);
      pending.resolve(message);
      return;
    }

    // Handle requests
    switch (message.type) {
      case 'PING':
        this.sendDirect(remoteHost, remotePort, {
          msgId: message.msgId,
          type: 'PONG',
          sender: this.localInfo,
        });
        break;

      case 'FIND_NODE': {
        const targetId = message.payload?.targetId || '';
        const closest = this.routingTable.findClosest(targetId);
        this.sendDirect(remoteHost, remotePort, {
          msgId: message.msgId,
          type: 'NODES_FOUND',
          sender: this.localInfo,
          payload: { nodes: closest },
        });
        break;
      }

      case 'ANNOUNCE_PROVIDER': {
        const { key, peerInfo, ttlMs } = message.payload || {};
        if (key && peerInfo) {
          this.providerStore.addProvider(key, peerInfo, ttlMs);
          this.sendDirect(remoteHost, remotePort, {
            msgId: message.msgId,
            type: 'ANNOUNCE_ACK',
            sender: this.localInfo,
            payload: { success: true },
          });
        }
        break;
      }

      case 'GET_PROVIDERS': {
        const key = message.payload?.key || '';
        const providers = this.providerStore.getProviders(key);
        const closestNodes = this.routingTable.findClosest(key);
        this.sendDirect(remoteHost, remotePort, {
          msgId: message.msgId,
          type: 'PROVIDERS_FOUND',
          sender: this.localInfo,
          payload: { providers, closerNodes: closestNodes },
        });
        break;
      }
    }
  }

  private sendDirect(host: string, port: number, message: DhtMessage): void {
    if (!this.isListening) return;
    const buffer = Buffer.from(JSON.stringify(message), 'utf-8');
    this.socket.send(buffer, 0, buffer.length, port, host);
  }

  async sendRequest(
    host: string,
    port: number,
    type: DhtMessageType,
    payload?: any
  ): Promise<DhtMessage> {
    if (!this.isListening) {
      throw new Error('DHT node is not started');
    }

    const msgId = crypto.randomBytes(8).toString('hex');
    const message: DhtMessage = {
      msgId,
      type,
      sender: this.localInfo,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(msgId);
        reject(new Error(`DHT request timeout (${type} to ${host}:${port})`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(msgId, { resolve, reject, timer });
      this.sendDirect(host, port, message);
    });
  }

  async ping(host: string, port: number): Promise<boolean> {
    try {
      const res = await this.sendRequest(host, port, 'PING');
      return res.type === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Connects to bootstrap nodes to join the DHT network.
   */
  async bootstrap(bootstrapAddresses: string[]): Promise<void> {
    for (const addr of bootstrapAddresses) {
      const [host, portStr] = addr.split(':');
      const port = parseInt(portStr, 10);
      if (!host || isNaN(port)) continue;

      try {
        const pingOk = await this.ping(host, port);
        if (pingOk) {
          // Ask bootstrap node for nodes closest to our own nodeId
          const response = await this.sendRequest(host, port, 'FIND_NODE', {
            targetId: this.nodeId,
          });
          const nodes: DhtNodeInfo[] = response.payload?.nodes || [];
          for (const node of nodes) {
            this.routingTable.addNode(node);
          }
        }
      } catch {
        // Skip unavailable bootstrap nodes
      }
    }
  }

  /**
   * Announces that the given peer provides chunks for the specified key.
   */
  async announceProvider(key: string, peerInfo: PeerInfo, ttlMs?: number): Promise<void> {
    const keyHash = hashDhtKey(key);
    // 1. Store in local provider table
    this.providerStore.addProvider(keyHash, peerInfo, ttlMs);

    // 2. Announce to k-closest nodes in the DHT
    const closestNodes = this.routingTable.findClosest(keyHash);
    const promises = closestNodes.map(async (node) => {
      try {
        await this.sendRequest(node.host, node.port, 'ANNOUNCE_PROVIDER', {
          key: keyHash,
          peerInfo,
          ttlMs,
        });
      } catch {
        // Node may be offline, ignore failure
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Finds peers providing chunks for the specified key.
   */
  async findProviders(key: string, maxProviders = 8): Promise<PeerInfo[]> {
    const keyHash = hashDhtKey(key);
    const discoveredPeers = new Map<string, PeerInfo>();

    // 1. Check local store
    for (const peer of this.providerStore.getProviders(keyHash)) {
      discoveredPeers.set(peer.peer_id, peer);
    }

    if (discoveredPeers.size >= maxProviders) {
      return Array.from(discoveredPeers.values()).slice(0, maxProviders);
    }

    // 2. Query closest nodes in routing table in parallel
    const closestNodes = this.routingTable.findClosest(keyHash);
    const visitedNodes = new Set<string>();

    const queries = closestNodes.slice(0, 4).map(async (node) => {
      if (visitedNodes.has(node.nodeId)) return;
      visitedNodes.add(node.nodeId);

      try {
        const res = await this.sendRequest(node.host, node.port, 'GET_PROVIDERS', {
          key: keyHash,
        });

        const providers: PeerInfo[] = res.payload?.providers || [];
        for (const p of providers) {
          discoveredPeers.set(p.peer_id, p);
        }

        const closerNodes: DhtNodeInfo[] = res.payload?.closerNodes || [];
        for (const cn of closerNodes) {
          this.routingTable.addNode(cn);
        }
      } catch {
        // Remove unresponsive node from routing table
        this.routingTable.removeNode(node.nodeId);
      }
    });

    await Promise.allSettled(queries);

    return Array.from(discoveredPeers.values()).slice(0, maxProviders);
  }

  getRoutingTable(): RoutingTable {
    return this.routingTable;
  }

  getProviderStore(): ProviderStore {
    return this.providerStore;
  }
}
