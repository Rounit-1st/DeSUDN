import * as fs from 'fs/promises';
import * as path from 'path';
import { sha256, IntegrityCheckError, ChunkNotFoundError } from '@desudn/shared';

// Safe filename check to prevent path traversal
const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-\.]+$/;

export class ChunkStorageManager {
  constructor(private readonly baseDir: string) {}

  private validateIdentifier(val: string, name: string): void {
    if (!val || !SAFE_ID_REGEX.test(val) || val.includes('..')) {
      throw new Error(`Invalid or unsafe ${name}: ${val}`);
    }
  }

  getChunkPath(softwareId: string, versionId: string, chunkId: string): string {
    this.validateIdentifier(softwareId, 'softwareId');
    this.validateIdentifier(versionId, 'versionId');
    this.validateIdentifier(chunkId, 'chunkId');

    const resolved = path.resolve(this.baseDir, 'chunks', softwareId, versionId, `${chunkId}.chunk`);
    const expectedPrefix = path.resolve(this.baseDir);
    if (!resolved.startsWith(expectedPrefix)) {
      throw new Error('Path traversal attempt detected');
    }
    return resolved;
  }

  async saveChunk(
    softwareId: string,
    versionId: string,
    chunkId: string,
    data: Buffer,
    expectedHash?: string
  ): Promise<void> {
    if (expectedHash) {
      const actualHash = sha256(data);
      if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
        throw new IntegrityCheckError(
          `Chunk hash mismatch for ${chunkId}: expected ${expectedHash}, got ${actualHash}`
        );
      }
    }

    const filePath = this.getChunkPath(softwareId, versionId, chunkId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async getChunk(softwareId: string, versionId: string, chunkId: string): Promise<Buffer> {
    const filePath = this.getChunkPath(softwareId, versionId, chunkId);
    try {
      return await fs.readFile(filePath);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        throw new ChunkNotFoundError(chunkId);
      }
      throw err;
    }
  }

  async hasChunk(softwareId: string, versionId: string, chunkId: string): Promise<boolean> {
    const filePath = this.getChunkPath(softwareId, versionId, chunkId);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async listChunks(softwareId: string, versionId: string): Promise<string[]> {
    this.validateIdentifier(softwareId, 'softwareId');
    this.validateIdentifier(versionId, 'versionId');

    const dir = path.resolve(this.baseDir, 'chunks', softwareId, versionId);
    try {
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('.chunk'))
        .map((f) => f.replace(/\.chunk$/, ''));
    } catch {
      return [];
    }
  }

  async deleteChunk(softwareId: string, versionId: string, chunkId: string): Promise<boolean> {
    const filePath = this.getChunkPath(softwareId, versionId, chunkId);
    try {
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
