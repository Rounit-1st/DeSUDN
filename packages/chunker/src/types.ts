import { ChunkMetadata } from '@desudn/shared';

export interface ChunkItem {
  metadata: ChunkMetadata;
  data: Buffer;
}

export interface ChunkResult {
  patchHash: string;
  patchSize: number;
  chunkSize: number;
  chunks: ChunkItem[];
}

export interface IChunkerStrategy {
  chunk(patchBuffer: Buffer, softwareId: string, versionId: string): ChunkResult;
}
