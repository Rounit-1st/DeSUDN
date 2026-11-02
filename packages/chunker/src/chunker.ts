import { sha256, IntegrityCheckError } from '@desudn/shared';
import { ChunkItem, ChunkResult, IChunkerStrategy } from './types.js';

export const DEFAULT_CHUNK_SIZE = 64 * 1024; // 64 KB default chunk size

export class FixedSizeChunker implements IChunkerStrategy {
  constructor(private readonly chunkSize: number = DEFAULT_CHUNK_SIZE) {
    if (chunkSize <= 0) {
      throw new Error('Chunk size must be positive');
    }
  }

  chunk(patchBuffer: Buffer, softwareId: string, versionId: string): ChunkResult {
    const patchSize = patchBuffer.length;
    const patchHash = sha256(patchBuffer);
    const chunks: ChunkItem[] = [];

    let offset = 0;
    let index = 0;

    // Even if patchBuffer is empty, handle edge-case cleanly
    if (patchSize === 0) {
      const hash = sha256(Buffer.alloc(0));
      const chunkId = `${softwareId}_${versionId}_chunk_${index}_${hash.slice(0, 12)}`;
      chunks.push({
        metadata: {
          chunk_id: chunkId,
          index: 0,
          size: 0,
          hash,
          offset: 0,
        },
        data: Buffer.alloc(0),
      });
      return { patchHash, patchSize, chunkSize: this.chunkSize, chunks };
    }

    while (offset < patchSize) {
      const end = Math.min(offset + this.chunkSize, patchSize);
      const chunkData = patchBuffer.subarray(offset, end);
      const hash = sha256(chunkData);
      const chunkId = `${softwareId}_${versionId}_chunk_${index}_${hash.slice(0, 12)}`;

      chunks.push({
        metadata: {
          chunk_id: chunkId,
          index,
          size: chunkData.length,
          hash,
          offset,
        },
        data: Buffer.from(chunkData),
      });

      offset = end;
      index++;
    }

    return {
      patchHash,
      patchSize,
      chunkSize: this.chunkSize,
      chunks,
    };
  }
}

export class PatchAssembler {
  /**
   * Validates a single chunk against its expected hash and size.
   */
  static verifyChunk(chunkData: Buffer, expectedHash: string, expectedSize: number): boolean {
    if (chunkData.length !== expectedSize) {
      return false;
    }
    const actualHash = sha256(chunkData);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
  }

  /**
   * Assembles chunks into the full patch and verifies the total patch hash.
   */
  static assemble(chunksInOrder: Buffer[], expectedPatchHash: string): Buffer {
    const assembledPatch = Buffer.concat(chunksInOrder);
    const actualHash = sha256(assembledPatch);

    if (actualHash.toLowerCase() !== expectedPatchHash.toLowerCase()) {
      throw new IntegrityCheckError(
        `Assembled patch hash mismatch! Expected ${expectedPatchHash}, got ${actualHash}`
      );
    }

    return assembledPatch;
  }
}
