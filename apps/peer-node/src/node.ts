import * as crypto from 'crypto';
import { DhtNode } from '@desudn/dht-discovery';
import { PeerServer, ChunkStorageManager } from '@desudn/p2p-network';

export interface PeerNodeConfig {
  peerId?: string;
  host?: string;
  peerPort?: number;
  dhtPort?: number;
  bootstrapNodes?: string[];
  storageDir: string;
}

export class PeerNodeDaemon {
  public readonly peerId: string;
  public dhtNode: DhtNode;
  public peerServer: PeerServer;
  private isRunning = false;

  constructor(private config: PeerNodeConfig) {
    this.peerId = config.peerId || `peer-${crypto.randomBytes(4).toString('hex')}`;
    const host = config.host || '127.0.0.1';

    this.dhtNode = new DhtNode({
      host,
      port: config.dhtPort || 0,
    });

    this.peerServer = new PeerServer({
      peerId: this.peerId,
      host,
      port: config.peerPort || 0,
      storageDir: config.storageDir,
      dhtNode: this.dhtNode,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    // 1. Start DHT Node
    await this.dhtNode.start();
    console.log(`[PeerNode:${this.peerId}] DHT node listening on UDP ${this.dhtNode.host}:${this.dhtNode.port}`);

    // 2. Start Peer HTTP Server
    await this.peerServer.start();
    console.log(
      `[PeerNode:${this.peerId}] Peer HTTP chunk server listening on http://${this.peerServer.host}:${this.peerServer.port}`
    );

    // 3. Connect to Bootstrap DHT nodes
    if (this.config.bootstrapNodes && this.config.bootstrapNodes.length > 0) {
      console.log(`[PeerNode:${this.peerId}] Bootstrapping into DHT:`, this.config.bootstrapNodes);
      await this.dhtNode.bootstrap(this.config.bootstrapNodes);
    }

    this.isRunning = true;
  }

  async stop(): Promise<void> {
    if (!this.isRunning) return;
    await this.peerServer.stop();
    await this.dhtNode.close();
    this.isRunning = false;
    console.log(`[PeerNode:${this.peerId}] Stopped.`);
  }

  get peerInfo() {
    return this.peerServer.peerInfo;
  }
}
