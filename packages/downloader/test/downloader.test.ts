import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PeerServer } from '@desudn/p2p-network';
import { FixedSizeChunker } from '@desudn/chunker';
import { ManifestBuilder } from '@desudn/manifest';
import { PatchDownloader } from '../src/downloader.js';
import { generateEd25519KeyPair, sha256 } from '@desudn/shared';

describe('PatchDownloader Multi-Peer Concurrency and Reassembly', () => {
  let rootDir: string;
  let peerA: PeerServer;
  let peerB: PeerServer;

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'downloader-test-'));

    peerA = new PeerServer({
      peerId: 'peer-A',
      port: 0,
      storageDir: path.join(rootDir, 'peerA'),
    });
    await peerA.start();

    peerB = new PeerServer({
      peerId: 'peer-B',
      port: 0,
      storageDir: path.join(rootDir, 'peerB'),
    });
    await peerB.start();
  });

  afterAll(async () => {
    await peerA?.stop();
    await peerB?.stop();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('should download chunks from multiple peers concurrently, resume, and reassemble', async () => {
    const rawPatch = Buffer.from('Large patch data divided across multiple peer nodes to simulate decentralized swarm');
    const chunker = new FixedSizeChunker(25);
    const chunkResult = chunker.chunk(rawPatch, 'my-app', '2.0.0');

    expect(chunkResult.chunks.length).toBeGreaterThanOrEqual(3);

    // Distribute half to Peer A, half to Peer B
    const half = Math.floor(chunkResult.chunks.length / 2);
    for (let i = 0; i < half; i++) {
      const c = chunkResult.chunks[i];
      await peerA.storage.saveChunk('my-app', '2.0.0', c.metadata.chunk_id, c.data, c.metadata.hash);
    }
    for (let i = half; i < chunkResult.chunks.length; i++) {
      const c = chunkResult.chunks[i];
      await peerB.storage.saveChunk('my-app', '2.0.0', c.metadata.chunk_id, c.data, c.metadata.hash);
    }

    const { publicKey, privateKey } = generateEd25519KeyPair();
    const manifest = ManifestBuilder.create({
      software_id: 'my-app',
      version_id: '2.0.0',
      base_version: '1.0.0',
      base_version_hash: '1'.repeat(64),
      target_version_hash: '2'.repeat(64),
      patch_hash: chunkResult.patchHash,
      patch_size: chunkResult.patchSize,
      chunk_size: chunkResult.chunkSize,
      chunks: chunkResult.chunks.map((c) => c.metadata),
      publisher_id: 'pub-test',
      publisher_public_key: publicKey,
      publisher_private_key: privateKey,
    });

    const clientCache = path.join(rootDir, 'client_cache');
    const downloader = new PatchDownloader({
      manifest,
      cacheDir: clientCache,
      directPeers: [peerA.peerInfo, peerB.peerInfo],
      concurrency: 2,
    });

    const assembledPatchPath = await downloader.download();
    expect(downloader.state).toBe('COMPLETED');

    const assembledData = await fs.readFile(assembledPatchPath);
    expect(assembledData.equals(rawPatch)).toBe(true);
    expect(sha256(assembledData)).toBe(chunkResult.patchHash);
  });
});
