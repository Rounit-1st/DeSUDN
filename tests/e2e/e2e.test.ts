import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as http from 'http';
import { createApp } from '../../apps/main-server/src/app.js';
import { MemoryDatabase } from '../../apps/main-server/src/db/memory.js';
import { DhtNode } from '@desudn/dht-discovery';
import { PeerNodeDaemon } from '../../apps/peer-node/src/node.js';
import { SoftwareUploader } from '../../apps/uploader/src/publisher.js';
import { SoftwareUpdateClient } from '../../apps/update-client/src/client.js';
import { SafePatchApplier } from '@desudn/patch-applier';
import { BinaryDiffEngine } from '@desudn/diff-engine';
import { FixedSizeChunker } from '@desudn/chunker';
import { ManifestBuilder } from '@desudn/manifest';
import { generateEd25519KeyPair, sha256, sha256File } from '@desudn/shared';

describe('DeSUDN End-to-End System Demonstration', () => {
  let rootDir: string;
  let mainServerHttp: http.Server;
  let mainServerUrl: string;
  let bootstrapDht: DhtNode;
  let bootstrapAddr: string;
  let peer1: PeerNodeDaemon;
  let peer2: PeerNodeDaemon;

  const publisherKeys = generateEd25519KeyPair();
  let publisherToken: string;

  const v1Text = 'const APP_NAME = "SuperEditor";\nconst VERSION = "1.0.0";\nconsole.log(APP_NAME, VERSION);\n';
  const v2Text = 'const APP_NAME = "SuperEditor";\nconst VERSION = "2.0.0";\n// New decentralized P2P features enabled!\nconsole.log(APP_NAME, VERSION);\n';

  beforeAll(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desudn-e2e-'));

    // 1. Start Main Metadata Server
    const db = new MemoryDatabase();
    const app = createApp(db);
    await new Promise<void>((resolve) => {
      mainServerHttp = app.listen(0, '127.0.0.1', () => {
        const addr = mainServerHttp.address() as any;
        mainServerUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // 2. Start Dedicated Bootstrap DHT Node
    bootstrapDht = new DhtNode({ host: '127.0.0.1', port: 0 });
    await bootstrapDht.start();
    bootstrapAddr = `127.0.0.1:${bootstrapDht.port}`;

    // 3. Start Peer 1
    peer1 = new PeerNodeDaemon({
      peerId: 'peer-alpha',
      host: '127.0.0.1',
      peerPort: 0,
      dhtPort: 0,
      bootstrapNodes: [bootstrapAddr],
      storageDir: path.join(rootDir, 'peer1_storage'),
    });
    await peer1.start();

    // 4. Start Peer 2
    peer2 = new PeerNodeDaemon({
      peerId: 'peer-beta',
      host: '127.0.0.1',
      peerPort: 0,
      dhtPort: 0,
      bootstrapNodes: [bootstrapAddr],
      storageDir: path.join(rootDir, 'peer2_storage'),
    });
    await peer2.start();

    // 5. Register Publisher on Main Server
    const regRes = await fetch(`${mainServerUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pub-e2e-01',
        username: 'lead-dev',
        password: 'password123',
        public_key: publisherKeys.publicKey,
      }),
    });
    const regData: any = await regRes.json();
    publisherToken = regData.token;

    // 6. Register Software
    await fetch(`${mainServerUrl}/api/software`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({
        id: 'super-editor',
        name: 'Super Editor IDE',
        description: 'Decentralized text editor binary',
      }),
    });
  });

  afterAll(async () => {
    await peer1?.stop();
    await peer2?.stop();
    await bootstrapDht?.close();
    await new Promise((resolve) => mainServerHttp?.close(resolve));
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('Scenario 1: Complete end-to-end update from v1 to v2 via DHT and multiple peers', async () => {
    // Write binary v1 and binary v2 files
    const binariesDir = path.join(rootDir, 'binaries');
    await fs.mkdir(binariesDir, { recursive: true });

    const v1Path = path.join(binariesDir, 'editor_v1.bin');
    const v2Path = path.join(binariesDir, 'editor_v2.bin');
    await fs.writeFile(v1Path, v1Text);
    await fs.writeFile(v2Path, v2Text);

    // Publish update using SoftwareUploader
    const publishResult = await SoftwareUploader.publish({
      softwareId: 'super-editor',
      versionId: '2.0.0',
      baseVersionId: '1.0.0',
      oldBinaryPath: v1Path,
      newBinaryPath: v2Path,
      chunkSize: 20, // small chunks so multiple chunks are distributed
      publisherId: 'pub-e2e-01',
      publisherPublicKey: publisherKeys.publicKey,
      publisherPrivateKey: publisherKeys.privateKey,
      mainServerUrl,
      publisherAuthToken: publisherToken,
      seedStorageDir: path.join(rootDir, 'seed_storage'),
      seedPeer: peer1.peerServer,
    });

    expect(publishResult.total_chunks).toBeGreaterThanOrEqual(2);

    // Also distribute some chunks to Peer 2 and announce to DHT so swarm has multiple providers
    for (const chunk of publishResult.manifest.chunks) {
      const data = await peer1.peerServer.storage.getChunk('super-editor', '2.0.0', chunk.chunk_id);
      await peer2.peerServer.storeAndAnnounceChunk('super-editor', '2.0.0', chunk.chunk_id, data, chunk.hash);
    }

    // Set up Client with v1 installed
    const clientWorkspace = path.join(rootDir, 'client_workspace');
    await fs.mkdir(clientWorkspace, { recursive: true });
    const installedAppPath = path.join(clientWorkspace, 'super_editor');
    await fs.writeFile(installedAppPath, v1Text);

    const client = new SoftwareUpdateClient({
      softwareId: 'super-editor',
      installedFilePath: installedAppPath,
      currentVersion: '1.0.0',
      mainServerUrl,
      trustedPublisherPublicKey: publisherKeys.publicKey,
      cacheDir: path.join(clientWorkspace, 'cache'),
      bootstrapNodes: [bootstrapAddr],
      concurrency: 2,
    });

    // Check for update
    const checkRes = await client.checkUpdate();
    expect(checkRes.updateAvailable).toBe(true);
    expect(checkRes.latestVersion).toBe('2.0.0');

    // Run complete update workflow
    const updateResult = await client.update();
    expect(updateResult.success).toBe(true);
    expect(updateResult.current_stage).toBe('applied');

    // Verify installed software is now v2 byte-for-byte!
    const upgradedContent = await fs.readFile(installedAppPath, 'utf-8');
    expect(upgradedContent).toBe(v2Text);
    expect(client.currentVersion).toBe('2.0.0');

    // Verify backup of v1 was created
    expect(updateResult.backup_path).toBeDefined();
    const backupContent = await fs.readFile(updateResult.backup_path!, 'utf-8');
    expect(backupContent).toBe(v1Text);
  });

  it('Scenario 2: Main server offline resilience after manifest retrieval', async () => {
    // If the client obtained the update manifest, the update can proceed
    // even if the main server is completely unreachable!
    const clientWorkspace = path.join(rootDir, 'offline_client_ws');
    await fs.mkdir(clientWorkspace, { recursive: true });
    const installedAppPath = path.join(clientWorkspace, 'super_editor');
    await fs.writeFile(installedAppPath, v1Text);

    // Obtain manifest from peer1 seed
    const manifestRes = await fetch(`${mainServerUrl}/api/software/super-editor/versions/2.0.0/manifest`);
    const manifest = await manifestRes.json();

    // Client pointing to an INVALID / DEAD main server URL
    const client = new SoftwareUpdateClient({
      softwareId: 'super-editor',
      installedFilePath: installedAppPath,
      currentVersion: '1.0.0',
      mainServerUrl: 'http://127.0.0.1:59999', // Completely dead server port
      trustedPublisherPublicKey: publisherKeys.publicKey,
      cacheDir: path.join(clientWorkspace, 'cache'),
      bootstrapNodes: [bootstrapAddr],
      concurrency: 2,
    });

    // Update using DHT discovery and peers without central server!
    const updateResult = await client.applyManifestUpdate(manifest);
    expect(updateResult.success).toBe(true);

    const upgradedContent = await fs.readFile(installedAppPath, 'utf-8');
    expect(upgradedContent).toBe(v2Text);
  });

  it('Scenario 3: Corrupted chunk rejection and peer failover', async () => {
    // Start a rogue peer that sends corrupted chunk data
    const rogueStorageDir = path.join(rootDir, 'rogue_storage');
    const roguePeer = new PeerNodeDaemon({
      peerId: 'peer-rogue',
      host: '127.0.0.1',
      peerPort: 0,
      dhtPort: 0,
      bootstrapNodes: [bootstrapAddr],
      storageDir: rogueStorageDir,
    });
    await roguePeer.start();

    // Rogue peer stores corrupted data under valid chunkId
    const manifestRes = await fetch(`${mainServerUrl}/api/software/super-editor/versions/2.0.0/manifest`);
    const manifest = await manifestRes.json();
    const chunk0 = manifest.chunks[0];

    const corruptedData = Buffer.from('Corrupted malicious payload from rogue peer');
    // Save without verifying hash
    await roguePeer.peerServer.storage.saveChunk('super-editor', '2.0.0', chunk0.chunk_id, corruptedData);

    const clientWorkspace = path.join(rootDir, 'rogue_test_ws');
    await fs.mkdir(clientWorkspace, { recursive: true });
    const installedAppPath = path.join(clientWorkspace, 'super_editor');
    await fs.writeFile(installedAppPath, v1Text);

    // Provide both rogue peer and honest peer1
    const client = new SoftwareUpdateClient({
      softwareId: 'super-editor',
      installedFilePath: installedAppPath,
      currentVersion: '1.0.0',
      mainServerUrl,
      trustedPublisherPublicKey: publisherKeys.publicKey,
      cacheDir: path.join(clientWorkspace, 'cache'),
      directPeers: [roguePeer.peerInfo, peer1.peerInfo],
      concurrency: 1,
    });

    // Client must reject corrupted chunk from rogue, failover to honest peer, and succeed!
    const updateResult = await client.applyManifestUpdate(manifest);
    expect(updateResult.success).toBe(true);

    const updatedContent = await fs.readFile(installedAppPath, 'utf-8');
    expect(updatedContent).toBe(v2Text);

    await roguePeer.stop();
  });

  it('Scenario 4: Download resumption after interruption', async () => {
    const clientWorkspace = path.join(rootDir, 'resume_client_ws');
    const cacheDir = path.join(clientWorkspace, 'cache');
    await fs.mkdir(cacheDir, { recursive: true });
    const installedAppPath = path.join(clientWorkspace, 'super_editor');
    await fs.writeFile(installedAppPath, v1Text);

    const manifestRes = await fetch(`${mainServerUrl}/api/software/super-editor/versions/2.0.0/manifest`);
    const manifest = await manifestRes.json();

    // Pre-populate chunk 0 in client cache (as if previous download was interrupted)
    const chunk0 = manifest.chunks[0];
    const chunk0Data = await peer1.peerServer.storage.getChunk('super-editor', '2.0.0', chunk0.chunk_id);
    const clientStorage = peer1.peerServer.storage; // or use ChunkStorageManager
    const clientStorageManager = new (await import('@desudn/p2p-network')).ChunkStorageManager(cacheDir);
    await clientStorageManager.saveChunk('super-editor', '2.0.0', chunk0.chunk_id, chunk0Data, chunk0.hash);

    // Run updater client - it must recognize chunk 0 and only download remaining chunks!
    const client = new SoftwareUpdateClient({
      softwareId: 'super-editor',
      installedFilePath: installedAppPath,
      currentVersion: '1.0.0',
      mainServerUrl,
      trustedPublisherPublicKey: publisherKeys.publicKey,
      cacheDir,
      bootstrapNodes: [bootstrapAddr],
      concurrency: 2,
    });

    const updateResult = await client.applyManifestUpdate(manifest);
    expect(updateResult.success).toBe(true);

    const upgradedContent = await fs.readFile(installedAppPath, 'utf-8');
    expect(upgradedContent).toBe(v2Text);
  });

  it('Scenario 5: Update rollback when staged verification fails', async () => {
    const clientWorkspace = path.join(rootDir, 'rollback_client_ws');
    await fs.mkdir(clientWorkspace, { recursive: true });
    const installedAppPath = path.join(clientWorkspace, 'super_editor');
    await fs.writeFile(installedAppPath, v1Text);

    const manifestRes = await fetch(`${mainServerUrl}/api/software/super-editor/versions/2.0.0/manifest`);
    const validManifest = await manifestRes.json();

    // Clone manifest and tamper target_version_hash
    const tamperedManifest = {
      ...validManifest,
      target_version_hash: '0'.repeat(64), // Invalid target hash!
    };
    // Re-sign with publisher key so signature passes, but target hash verification fails
    tamperedManifest.signature = ManifestBuilder.signManifest(tamperedManifest, publisherKeys.privateKey);

    const client = new SoftwareUpdateClient({
      softwareId: 'super-editor',
      installedFilePath: installedAppPath,
      currentVersion: '1.0.0',
      mainServerUrl,
      trustedPublisherPublicKey: publisherKeys.publicKey,
      cacheDir: path.join(clientWorkspace, 'cache'),
      bootstrapNodes: [bootstrapAddr],
    });

    const updateResult = await client.applyManifestUpdate(tamperedManifest);
    expect(updateResult.success).toBe(false);
    expect(updateResult.current_stage).toBe('rolled_back');

    // Installed file must be completely unharmed and still at v1
    const currentContent = await fs.readFile(installedAppPath, 'utf-8');
    expect(currentContent).toBe(v1Text);
  });
});
