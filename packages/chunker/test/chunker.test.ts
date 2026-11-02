import { describe, it, expect } from 'vitest';
import { FixedSizeChunker, PatchAssembler } from '../src/chunker.js';

describe('FixedSizeChunker and PatchAssembler', () => {
  it('should split data into chunks correctly', () => {
    const chunker = new FixedSizeChunker(100);
    const testData = Buffer.alloc(250, 'A');
    const result = chunker.chunk(testData, 'app1', '1.1.0');

    expect(result.chunks.length).toBe(3);
    expect(result.chunks[0].metadata.size).toBe(100);
    expect(result.chunks[1].metadata.size).toBe(100);
    expect(result.chunks[2].metadata.size).toBe(50);
    expect(result.patchSize).toBe(250);
  });

  it('should verify individual chunks correctly', () => {
    const chunker = new FixedSizeChunker(50);
    const testData = Buffer.from('Testing chunk verification functionality');
    const result = chunker.chunk(testData, 'app1', '1.0.0');

    const chunk0 = result.chunks[0];
    expect(PatchAssembler.verifyChunk(chunk0.data, chunk0.metadata.hash, chunk0.metadata.size)).toBe(true);

    // Corrupted chunk
    const corruptedData = Buffer.from(chunk0.data);
    corruptedData[0] = (corruptedData[0] + 1) % 256;
    expect(PatchAssembler.verifyChunk(corruptedData, chunk0.metadata.hash, chunk0.metadata.size)).toBe(false);
  });

  it('should reassemble chunks and verify full patch hash', () => {
    const chunker = new FixedSizeChunker(64);
    const testData = Buffer.from('A'.repeat(200));
    const result = chunker.chunk(testData, 'app1', '2.0.0');

    const chunkBuffers = result.chunks.map((c) => c.data);
    const assembled = PatchAssembler.assemble(chunkBuffers, result.patchHash);
    expect(assembled.equals(testData)).toBe(true);
  });

  it('should throw IntegrityCheckError when reassembling corrupted patch', () => {
    const chunker = new FixedSizeChunker(64);
    const testData = Buffer.from('B'.repeat(150));
    const result = chunker.chunk(testData, 'app1', '2.0.0');

    const chunkBuffers = result.chunks.map((c) => Buffer.from(c.data));
    chunkBuffers[0][0] = 0x00; // corrupt first byte

    expect(() => PatchAssembler.assemble(chunkBuffers, result.patchHash)).toThrow();
  });
});
