import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SafePatchApplier } from '../src/safe-applier.js';
import { BinaryDiffEngine } from '@desudn/diff-engine';
import { ManifestBuilder } from '@desudn/manifest';
import { FixedSizeChunker } from '@desudn/chunker';
import { generateEd25519KeyPair, sha256, sha256File } from '@desudn/shared';

describe('SafePatchApplier Transactional Updates and Rollback', () => {
  let rootDir: string;
  const v1Content = 'Application v1.0.0 initial executable binary payload';
  const v2Content = 'Application v2.0.0 upgraded executable binary payload with safety checks';

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'safe-applier-test-'));
  });

  afterAll(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('should safely stage, verify, and atomically upgrade binary to v2', async () => {
    const appFile = path.join(rootDir, 'my_app.bin');
    await fs.writeFile(appFile, v1Content);

    const v1Hash = await sha256File(appFile);
    const v2Buffer = Buffer.from(v2Content);
    const v2Hash = sha256(v2Buffer);

    // Generate patch
    const patchBuffer = BinaryDiffEngine.generateDiff(Buffer.from(v1Content), v2Buffer);
    const patchFile = path.join(rootDir, 'update.diff');
    await fs.writeFile(patchFile, patchBuffer);

    const chunker = new FixedSizeChunker(50);
    const chunkResult = chunker.chunk(patchBuffer, 'my-app', '2.0.0');

    const { publicKey, privateKey } = generateEd25519KeyPair();
    const manifest = ManifestBuilder.create({
      software_id: 'my-app',
      version_id: '2.0.0',
      base_version: '1.0.0',
      base_version_hash: v1Hash,
      target_version_hash: v2Hash,
      patch_hash: chunkResult.patchHash,
      patch_size: chunkResult.patchSize,
      chunk_size: chunkResult.chunkSize,
      chunks: chunkResult.chunks.map((c) => c.metadata),
      publisher_id: 'pub-test',
      publisher_public_key: publicKey,
      publisher_private_key: privateKey,
    });

    const applier = new SafePatchApplier(rootDir);
    const result = await applier.applyUpdate({
      softwareId: 'my-app',
      installedFilePath: appFile,
      patchFilePath: patchFile,
      manifest,
      workspaceDir: rootDir,
    });

    expect(result.success).toBe(true);
    expect(result.current_stage).toBe('applied');

    // Confirm file on disk now has v2 contents
    const updatedContent = await fs.readFile(appFile, 'utf-8');
    expect(updatedContent).toBe(v2Content);

    // Confirm backup exists
    expect(result.backup_path).toBeDefined();
    const backupContent = await fs.readFile(result.backup_path!, 'utf-8');
    expect(backupContent).toBe(v1Content);
  });

  it('should automatically rollback if target verification fails and preserve original file', async () => {
    const appFile = path.join(rootDir, 'fragile_app.bin');
    await fs.writeFile(appFile, v1Content);

    const v1Hash = await sha256File(appFile);
    const v2Buffer = Buffer.from(v2Content);

    // Generate valid diff
    const patchBuffer = BinaryDiffEngine.generateDiff(Buffer.from(v1Content), v2Buffer);
    const patchFile = path.join(rootDir, 'corrupt_manifest.diff');
    await fs.writeFile(patchFile, patchBuffer);

    const chunker = new FixedSizeChunker(50);
    const chunkResult = chunker.chunk(patchBuffer, 'fragile-app', '2.0.0');

    const { publicKey, privateKey } = generateEd25519KeyPair();
    // Tamper target_version_hash in manifest so target verification fails!
    const manifest = ManifestBuilder.create({
      software_id: 'fragile-app',
      version_id: '2.0.0',
      base_version: '1.0.0',
      base_version_hash: v1Hash,
      target_version_hash: 'f'.repeat(64), // WRONG TARGET HASH
      patch_hash: chunkResult.patchHash,
      patch_size: chunkResult.patchSize,
      chunk_size: chunkResult.chunkSize,
      chunks: chunkResult.chunks.map((c) => c.metadata),
      publisher_id: 'pub-test',
      publisher_public_key: publicKey,
      publisher_private_key: privateKey,
    });

    const applier = new SafePatchApplier(rootDir);
    const result = await applier.applyUpdate({
      softwareId: 'fragile-app',
      installedFilePath: appFile,
      patchFilePath: patchFile,
      manifest,
      workspaceDir: rootDir,
    });

    expect(result.success).toBe(false);
    expect(result.current_stage).toBe('rolled_back');
    expect(result.error).toContain('target hash mismatch');

    // Original file must NOT have been overwritten
    const preservedContent = await fs.readFile(appFile, 'utf-8');
    expect(preservedContent).toBe(v1Content);
  });
});
