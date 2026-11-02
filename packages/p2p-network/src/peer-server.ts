import * as http from 'http';
import { ChunkStorageManager } from './storage.js';
import { DhtNode } from '@desudn/dht-discovery';
import { PeerInfo, buildDhtKey, sha256 } from '@desudn/shared';

export interface PeerServerOptions {
  peerId: string;
  host?: string;
  port?: number;
  storageDir: string;
  dhtNode?: DhtNode;
  maxConcurrentUploads?: number;
}

export class PeerServer {
  public readonly peerId: string;
  public readonly host: string;
  public port: number;
  public readonly storage: ChunkStorageManager;
  private server?: http.Server;
  private dhtNode?: DhtNode;
  private activeUploads = 0;
  private maxConcurrentUploads: number;

  constructor(options: PeerServerOptions) {
    this.peerId = options.peerId;
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 0;
    this.storage = new ChunkStorageManager(options.storageDir);
    this.dhtNode = options.dhtNode;
    this.maxConcurrentUploads = options.maxConcurrentUploads || 32;
  }

  get peerInfo(): PeerInfo {
    return {
      peer_id: this.peerId,
      host: this.host,
      port: this.port,
      dht_port: this.dhtNode?.port,
      last_seen: Date.now(),
    };
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        if (typeof addr === 'object' && addr !== null) {
          this.port = addr.port;
        }
        resolve();
      });

      this.server.once('error', reject);
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = undefined;
        resolve();
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);
    const pathname = url.pathname;

    // Health / Status Check
    if (req.method === 'GET' && pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          peer_id: this.peerId,
          host: this.host,
          port: this.port,
          active_uploads: this.activeUploads,
        })
      );
      return;
    }

    // GET /chunks/:softwareId/:versionId/:chunkId
    const chunkRegex = /^\/chunks\/([^/]+)\/([^/]+)\/([^/]+)$/;
    const match = pathname.match(chunkRegex);

    if (req.method === 'GET' && match) {
      const [, softwareId, versionId, chunkId] = match;

      if (this.activeUploads >= this.maxConcurrentUploads) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Peer is at maximum upload capacity' }));
        return;
      }

      this.activeUploads++;
      try {
        const chunkData = await this.storage.getChunk(softwareId, versionId, chunkId);
        const hash = sha256(chunkData);

        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': chunkData.length,
          'ETag': `"${hash}"`,
          'X-Chunk-Id': chunkId,
          'Cache-Control': 'public, max-age=31536000, immutable',
        });
        res.end(chunkData);
      } catch (err: any) {
        if (err.name === 'ChunkNotFoundError') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Chunk ${chunkId} not found on this peer` }));
        } else {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      } finally {
        this.activeUploads--;
      }
      return;
    }

    // 404 for unknown endpoints
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  }

  /**
   * Stores a chunk locally and announces its availability to the DHT.
   */
  async storeAndAnnounceChunk(
    softwareId: string,
    versionId: string,
    chunkId: string,
    data: Buffer,
    expectedHash?: string
  ): Promise<void> {
    await this.storage.saveChunk(softwareId, versionId, chunkId, data, expectedHash);

    if (this.dhtNode) {
      // Announce for specific chunk
      const chunkKey = buildDhtKey(softwareId, versionId, chunkId);
      await this.dhtNode.announceProvider(chunkKey, this.peerInfo);

      // Also announce for general version
      const versionKey = buildDhtKey(softwareId, versionId);
      await this.dhtNode.announceProvider(versionKey, this.peerInfo);
    }
  }

  /**
   * Scans all locally stored chunks and re-announces them to the DHT.
   */
  async announceAllLocalChunks(softwareId: string, versionId: string): Promise<number> {
    if (!this.dhtNode) return 0;

    const chunkIds = await this.storage.listChunks(softwareId, versionId);
    for (const chunkId of chunkIds) {
      const chunkKey = buildDhtKey(softwareId, versionId, chunkId);
      await this.dhtNode.announceProvider(chunkKey, this.peerInfo);
    }

    const versionKey = buildDhtKey(softwareId, versionId);
    await this.dhtNode.announceProvider(versionKey, this.peerInfo);

    return chunkIds.length;
  }
}
