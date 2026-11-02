import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PeerServer, PeerClient, ChunkStorageManager } from '../src/index.js';
import { sha256 } from '@desudn/shared';

describe('P2P Network Package', () => {
  let tempDir: string;
  let server: PeerServer;
  const chunkData = Buffer.from('Testing P2P chunk transfer and verification.');
  const chunkHash = sha256(chunkData);

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p2p-test-'));
    server = new PeerServer({
      peerId: 'peer-test-1',
      host: '127.0.0.1',
      port: 0, // dynamic port
      storageDir: tempDir,
    });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should prevent path traversal attempts in storage manager', () => {
    const storage = new ChunkStorageManager(tempDir);
    expect(() => storage.getChunkPath('../hack', '1.0.0', 'c1')).toThrow();
    expect(() => storage.getChunkPath('app', '../../etc/passwd', 'c1')).toThrow();
    expect(() => storage.getChunkPath('app', '1.0.0', '..')).toThrow();
  });

  it('should store and serve a valid chunk via HTTP', async () => {
    await server.storage.saveChunk('app1', '1.0.0', 'chunk-001', chunkData, chunkHash);

    const downloaded = await PeerClient.downloadChunk(
      server.peerInfo,
      'app1',
      '1.0.0',
      'chunk-001',
      chunkHash
    );

    expect(downloaded.equals(chunkData)).toBe(true);
  });

  it('should reject corrupted chunk download if hash does not match', async () => {
    const wrongHash = '0'.repeat(64);
    await expect(
      PeerClient.downloadChunk(server.peerInfo, 'app1', '1.0.0', 'chunk-001', wrongHash)
    ).rejects.toThrow();
  });

  it('should return 404 for non-existent chunks', async () => {
    await expect(
      PeerClient.downloadChunk(server.peerInfo, 'app1', '1.0.0', 'nonexistent-chunk', chunkHash)
    ).rejects.toThrow();
  });
});
