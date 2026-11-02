import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  UpdateManifest,
  ChunkMetadata,
  PeerInfo,
  buildDhtKey,
  sha256,
  IntegrityCheckError,
} from '@desudn/shared';
import { DhtNode } from '@desudn/dht-discovery';
import { PeerClient, ChunkStorageManager } from '@desudn/p2p-network';
import { PatchAssembler } from '@desudn/chunker';
import { DownloadStateManager, DownloaderState } from './state-machine.js';

export interface PatchDownloaderOptions {
  manifest: UpdateManifest;
  cacheDir: string;
  dhtNode?: DhtNode;
  directPeers?: PeerInfo[];
  concurrency?: number;
  maxRetriesPerChunk?: number;
}

export interface DownloaderProgressEvent {
  totalChunks: number;
  completedChunks: number;
  totalBytes: number;
  downloadedBytes: number;
  percent: number;
}

export class PatchDownloader extends EventEmitter {
  public state: DownloaderState = 'IDLE';
  private manifest: UpdateManifest;
  private cacheDir: string;
  private dhtNode?: DhtNode;
  private directPeers: PeerInfo[];
  private concurrency: number;
  private maxRetries: number;
  private stateManager: DownloadStateManager;
  private storage: ChunkStorageManager;
  private peerFailureCounts: Map<string, number> = new Map();
  private knownPeersCache: Map<string, PeerInfo> = new Map();

  constructor(options: PatchDownloaderOptions) {
    super();
    this.manifest = options.manifest;
    this.cacheDir = options.cacheDir;
    this.dhtNode = options.dhtNode;
    this.directPeers = options.directPeers || [];
    this.concurrency = options.concurrency || 4;
    this.maxRetries = options.maxRetriesPerChunk || 3;

    this.stateManager = new DownloadStateManager(this.cacheDir, this.manifest);
    this.storage = new ChunkStorageManager(this.cacheDir);
  }

  /**
   * Starts downloading all missing chunks concurrently from DHT peers.
   * Returns the path to the reassembled and verified patch file.
   */
  async download(): Promise<string> {
    this.setState('DISCOVERING_PEERS');
    await fs.mkdir(this.cacheDir, { recursive: true });
    await this.stateManager.loadExistingState();

    // Check disk for any already-downloaded chunks to support seamless resumption
    await this.scanExistingChunksOnDisk();

    if (this.stateManager.isAllCompleted()) {
      return this.assembleAndVerifyPatch();
    }

    this.setState('DOWNLOADING');
    const pendingChunks = this.stateManager.getPendingChunks();

    // Work queue
    const queue = [...pendingChunks];
    const inFlight = new Set<Promise<void>>();

    while (queue.length > 0 || inFlight.size > 0) {
      while (inFlight.size < this.concurrency && queue.length > 0) {
        const chunk = queue.shift()!;
        const task = this.downloadSingleChunkWithRetry(chunk)
          .then(() => {
            this.emitProgress();
          })
          .catch((err) => {
            // Task failed after all retries
            throw err;
          })
          .finally(() => {
            inFlight.delete(task);
          });

        inFlight.add(task);
      }

      if (inFlight.size > 0) {
        await Promise.race(inFlight);
      }
    }

    return this.assembleAndVerifyPatch();
  }

  private async scanExistingChunksOnDisk(): Promise<void> {
    for (const chunk of this.manifest.chunks) {
      const hasChunk = await this.storage.hasChunk(
        this.manifest.software_id,
        this.manifest.version_id,
        chunk.chunk_id
      );

      if (hasChunk) {
        try {
          const data = await this.storage.getChunk(
            this.manifest.software_id,
            this.manifest.version_id,
            chunk.chunk_id
          );
          if (sha256(data).toLowerCase() === chunk.hash.toLowerCase()) {
            this.stateManager.setChunkStatus(chunk.chunk_id, 'completed');
          }
        } catch {
          // Chunk invalid on disk, will be re-downloaded
        }
      }
    }
    await this.stateManager.saveState();
  }

  private async downloadSingleChunkWithRetry(chunk: ChunkMetadata): Promise<void> {
    this.stateManager.setChunkStatus(chunk.chunk_id, 'downloading');
    let lastError: Error | undefined;

    const peers = await this.findPeersForChunk(chunk);
    if (peers.length === 0) {
      this.stateManager.setChunkStatus(chunk.chunk_id, 'failed', undefined, 'No peers discovered');
      await this.stateManager.saveState();
      this.setState('FAILED');
      throw new Error(`No peers discovered for chunk ${chunk.chunk_id}`);
    }

    // Sort candidate peers: prioritize peers with fewer failures
    peers.sort((a, b) => {
      const failA = this.peerFailureCounts.get(a.peer_id) || 0;
      const failB = this.peerFailureCounts.get(b.peer_id) || 0;
      return failA - failB;
    });

    const totalAttempts = Math.max(this.maxRetries, peers.length);

    for (let attempt = 0; attempt < totalAttempts; attempt++) {
      const targetPeer = peers[attempt % peers.length];
      try {
        const chunkData = await PeerClient.downloadChunk(
          targetPeer,
          this.manifest.software_id,
          this.manifest.version_id,
          chunk.chunk_id,
          chunk.hash
        );

        // Save chunk locally
        await this.storage.saveChunk(
          this.manifest.software_id,
          this.manifest.version_id,
          chunk.chunk_id,
          chunkData,
          chunk.hash
        );

        this.stateManager.setChunkStatus(chunk.chunk_id, 'completed', targetPeer.peer_id);
        await this.stateManager.saveState();
        return;
      } catch (err: any) {
        lastError = err;
        const currentFails = this.peerFailureCounts.get(targetPeer.peer_id) || 0;
        this.peerFailureCounts.set(targetPeer.peer_id, currentFails + 1);
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }

    this.stateManager.setChunkStatus(chunk.chunk_id, 'failed', undefined, lastError?.message);
    await this.stateManager.saveState();
    this.setState('FAILED');
    throw new Error(
      `Failed to download chunk ${chunk.chunk_id} after ${totalAttempts} attempts: ${lastError?.message}`
    );
  }

  private async findPeersForChunk(chunk: ChunkMetadata): Promise<PeerInfo[]> {
    const candidatePeers = new Map<string, PeerInfo>();

    // 1. Add direct peers if provided
    for (const p of this.directPeers) {
      candidatePeers.set(p.peer_id, p);
    }

    // 2. Add already known cached peers
    for (const p of this.knownPeersCache.values()) {
      candidatePeers.set(p.peer_id, p);
    }

    // 3. Query DHT if available and need more peers
    if (this.dhtNode && candidatePeers.size === 0) {
      // Query specific chunk key and general version key in parallel
      const chunkKey = buildDhtKey(
        this.manifest.software_id,
        this.manifest.version_id,
        chunk.chunk_id
      );
      const versionKey = buildDhtKey(this.manifest.software_id, this.manifest.version_id);

      const [chunkPeers, versionPeers] = await Promise.all([
        this.dhtNode.findProviders(chunkKey),
        this.dhtNode.findProviders(versionKey),
      ]);

      for (const p of chunkPeers) {
        candidatePeers.set(p.peer_id, p);
        this.knownPeersCache.set(p.peer_id, p);
      }
      for (const p of versionPeers) {
        candidatePeers.set(p.peer_id, p);
        this.knownPeersCache.set(p.peer_id, p);
      }
    }

    return Array.from(candidatePeers.values());
  }

  private async assembleAndVerifyPatch(): Promise<string> {
    this.setState('VERIFYING');

    const chunkBuffers: Buffer[] = [];
    for (const chunk of this.manifest.chunks) {
      const data = await this.storage.getChunk(
        this.manifest.software_id,
        this.manifest.version_id,
        chunk.chunk_id
      );
      chunkBuffers.push(data);
    }

    // Assemble and verify patch hash
    const assembledPatch = PatchAssembler.assemble(chunkBuffers, this.manifest.patch_hash);

    const patchPath = path.join(
      this.cacheDir,
      `patch_${this.manifest.software_id}_${this.manifest.version_id}.diff`
    );
    await fs.writeFile(patchPath, assembledPatch);

    this.setState('COMPLETED');
    return patchPath;
  }

  private setState(state: DownloaderState): void {
    this.state = state;
    this.emit('stateChange', state);
  }

  private emitProgress(): void {
    const state = this.stateManager.getState();
    const percent =
      state.total_chunks > 0
        ? Math.floor((state.completed_chunks / state.total_chunks) * 100)
        : 100;

    const event: DownloaderProgressEvent = {
      totalChunks: state.total_chunks,
      completedChunks: state.completed_chunks,
      totalBytes: state.total_bytes,
      downloadedBytes: state.downloaded_bytes,
      percent,
    };

    this.emit('progress', event);
  }
}
