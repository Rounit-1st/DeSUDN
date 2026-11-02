import { describe, it, expect } from 'vitest';
import { ManifestBuilder, ManifestValidator } from '../src/index.js';
import { generateEd25519KeyPair } from '@desudn/shared';

describe('ManifestBuilder and ManifestValidator', () => {
  const { publicKey, privateKey } = generateEd25519KeyPair();

  it('should generate, sign and successfully validate a manifest', () => {
    const manifest = ManifestBuilder.create({
      software_id: 'test-app',
      version_id: '2.0.0',
      base_version: '1.0.0',
      base_version_hash: 'a'.repeat(64),
      target_version_hash: 'b'.repeat(64),
      patch_hash: 'c'.repeat(64),
      patch_size: 150,
      chunk_size: 100,
      chunks: [
        { chunk_id: 'c1', index: 0, size: 100, hash: '1'.repeat(64), offset: 0 },
        { chunk_id: 'c2', index: 1, size: 50, hash: '2'.repeat(64), offset: 100 },
      ],
      publisher_id: 'pub-1',
      publisher_public_key: publicKey,
      publisher_private_key: privateKey,
    });

    expect(manifest.signature).toBeDefined();
    const result = ManifestValidator.validate(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject manifest with tampered patch size', () => {
    const manifest = ManifestBuilder.create({
      software_id: 'test-app',
      version_id: '2.0.0',
      base_version: '1.0.0',
      base_version_hash: 'a'.repeat(64),
      target_version_hash: 'b'.repeat(64),
      patch_hash: 'c'.repeat(64),
      patch_size: 150,
      chunk_size: 100,
      chunks: [
        { chunk_id: 'c1', index: 0, size: 100, hash: '1'.repeat(64), offset: 0 },
        { chunk_id: 'c2', index: 1, size: 50, hash: '2'.repeat(64), offset: 100 },
      ],
      publisher_id: 'pub-1',
      publisher_public_key: publicKey,
      publisher_private_key: privateKey,
    });

    manifest.patch_size = 999; // Tamper
    const result = ManifestValidator.validate(manifest);
    expect(result.valid).toBe(false);
  });

  it('should reject manifest with invalid signature', () => {
    const otherKey = generateEd25519KeyPair();
    const manifest = ManifestBuilder.create({
      software_id: 'test-app',
      version_id: '2.0.0',
      base_version: '1.0.0',
      base_version_hash: 'a'.repeat(64),
      target_version_hash: 'b'.repeat(64),
      patch_hash: 'c'.repeat(64),
      patch_size: 100,
      chunk_size: 100,
      chunks: [
        { chunk_id: 'c1', index: 0, size: 100, hash: '1'.repeat(64), offset: 0 },
      ],
      publisher_id: 'pub-1',
      publisher_public_key: otherKey.publicKey, // wrong key!
      publisher_private_key: privateKey,
    });

    const result = ManifestValidator.validate(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('signature'))).toBe(true);
  });
});
