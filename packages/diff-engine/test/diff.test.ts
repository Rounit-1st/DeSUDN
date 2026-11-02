import { describe, it, expect } from 'vitest';
import { BinaryDiffEngine } from '../src/bsdiff.js';

describe('BinaryDiffEngine', () => {
  it('should generate diff and apply patch correctly on identical buffers', () => {
    const original = Buffer.from('Hello world! This is version 1 of DeSUDN system.');
    const patch = BinaryDiffEngine.generateDiff(original, original);
    const restored = BinaryDiffEngine.applyPatch(original, patch);
    expect(restored.equals(original)).toBe(true);
  });

  it('should generate diff and apply patch correctly on modified buffers', () => {
    const v1 = Buffer.from('function main() { console.log("Version 1.0.0"); return 0; }');
    const v2 = Buffer.from('function main() { console.log("Version 2.0.0 - with new feature!"); return 1; }');
    
    const patch = BinaryDiffEngine.generateDiff(v1, v2);
    const restored = BinaryDiffEngine.applyPatch(v1, patch);
    expect(restored.toString('utf-8')).toBe(v2.toString('utf-8'));
  });

  it('should handle large binary buffers with scattered changes', () => {
    const size = 64 * 1024; // 64KB binary buffer
    const v1 = Buffer.alloc(size);
    for (let i = 0; i < size; i++) {
      v1[i] = (i * 37 + 13) & 0xff;
    }

    const v2 = Buffer.from(v1);
    // modify scattered bytes
    for (let i = 1000; i < 2000; i++) {
      v2[i] = (v2[i] + 7) & 0xff;
    }
    // append extra bytes
    const extra = Buffer.from('additional trailing payload data for version 2');
    const v2Final = Buffer.concat([v2, extra]);

    const patch = BinaryDiffEngine.generateDiff(v1, v2Final);
    const restored = BinaryDiffEngine.applyPatch(v1, patch);
    expect(restored.equals(v2Final)).toBe(true);
  });

  it('should fail cleanly on corrupted patch data', () => {
    const v1 = Buffer.from('Old binary data');
    const badPatch = Buffer.from('not a valid desudiff patch header');
    expect(() => BinaryDiffEngine.applyPatch(v1, badPatch)).toThrow();
  });
});
