import * as fs from 'fs/promises';
import * as path from 'path';
import {
  UpdateManifest,
  ChunkMetadata,
  DownloadSessionState,
  ChunkProgress,
  ChunkDownloadStatus,
} from '@desudn/shared';

export type DownloaderState =
  | 'IDLE'
  | 'DISCOVERING_PEERS'
  | 'DOWNLOADING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

export class DownloadStateManager {
  private sessionState: DownloadSessionState;
  private stateFilePath: string;

  constructor(
    private readonly cacheDir: string,
    private readonly manifest: UpdateManifest
  ) {
    this.stateFilePath = path.join(
      cacheDir,
      `download_state_${manifest.software_id}_${manifest.version_id}.json`
    );

    const initialChunks: Record<string, ChunkProgress> = {};
    for (const chunk of manifest.chunks) {
      initialChunks[chunk.chunk_id] = {
        chunk_id: chunk.chunk_id,
        index: chunk.index,
        size: chunk.size,
        hash: chunk.hash,
        status: 'pending',
      };
    }

    this.sessionState = {
      software_id: manifest.software_id,
      version_id: manifest.version_id,
      base_version: manifest.base_version,
      total_chunks: manifest.chunks.length,
      completed_chunks: 0,
      total_bytes: manifest.patch_size,
      downloaded_bytes: 0,
      chunks: initialChunks,
      is_completed: false,
      last_updated: new Date().toISOString(),
    };
  }

  async loadExistingState(): Promise<boolean> {
    try {
      const data = await fs.readFile(this.stateFilePath, 'utf-8');
      const loaded: DownloadSessionState = JSON.parse(data);

      if (
        loaded.software_id === this.manifest.software_id &&
        loaded.version_id === this.manifest.version_id &&
        loaded.total_chunks === this.manifest.chunks.length
      ) {
        this.sessionState = loaded;
        return true;
      }
    } catch {
      // No existing state or file corrupt
    }
    return false;
  }

  async saveState(): Promise<void> {
    this.sessionState.last_updated = new Date().toISOString();
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(this.stateFilePath, JSON.stringify(this.sessionState, null, 2));
  }

  getChunkProgress(chunkId: string): ChunkProgress | undefined {
    return this.sessionState.chunks[chunkId];
  }

  setChunkStatus(chunkId: string, status: ChunkDownloadStatus, peerId?: string, error?: string): void {
    const chunk = this.sessionState.chunks[chunkId];
    if (!chunk) return;

    const previousStatus = chunk.status;
    chunk.status = status;
    chunk.peer_id = peerId;
    chunk.error = error;

    if (previousStatus !== 'completed' && status === 'completed') {
      this.sessionState.completed_chunks++;
      this.sessionState.downloaded_bytes += chunk.size;
    } else if (previousStatus === 'completed' && status !== 'completed') {
      this.sessionState.completed_chunks--;
      this.sessionState.downloaded_bytes -= chunk.size;
    }

    if (this.sessionState.completed_chunks === this.sessionState.total_chunks) {
      this.sessionState.is_completed = true;
    }
  }

  getState(): DownloadSessionState {
    return this.sessionState;
  }

  getPendingChunks(): ChunkMetadata[] {
    return this.manifest.chunks.filter(
      (c) => this.sessionState.chunks[c.chunk_id]?.status !== 'completed'
    );
  }

  isAllCompleted(): boolean {
    return this.sessionState.completed_chunks === this.sessionState.total_chunks;
  }
}
