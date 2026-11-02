import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as http from 'http';
import { createApp } from '../apps/main-server/src/app.js';
import { MemoryDatabase } from '../apps/main-server/src/db/memory.js';
import { DhtNode } from '@desudn/dht-discovery';
import { PeerNodeDaemon } from '../apps/peer-node/src/node.js';
import { SoftwareUploader } from '../apps/uploader/src/publisher.js';
import { SoftwareUpdateClient } from '../apps/update-client/src/client.js';
import { generateEd25519KeyPair, sha256 } from '@desudn/shared';

async function runDemo() {
  console.log('========================================================================');
  console.log('      DeSUDN: Decentralized Software Update Distribution Network       ');
  console.log('              Trackerless P2P Swarm & Atomic Update Demo                ');
  console.log('========================================================================\n');

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'desudn-demo-'));
  console.log(`[Demo] Temporary working directory: ${rootDir}`);

  // 1. Launch Main Server
  console.log('\n[1/7] Initializing Main Server (Metadata & Publisher Auth)...');
  const db = new MemoryDatabase();
  const app = createApp(db);
  let mainServer: http.Server;
  let mainServerUrl: string;

  await new Promise<void>((resolve) => {
    mainServer = app.listen(0, '127.0.0.1', () => {
      const addr = mainServer.address() as any;
      mainServerUrl = `http://127.0.0.1:${addr.port}`;
      console.log(`   -> Main Server active at: ${mainServerUrl}`);
      resolve();
    });
  });

  // 2. Launch DHT Bootstrap Node and Peer Nodes
  console.log('\n[2/7] Initializing Trackerless DHT Swarm (Kademlia DHT)...');
  const bootstrapDht = new DhtNode({ host: '127.0.0.1', port: 0 });
  await bootstrapDht.start();
  const bootstrapAddr = `127.0.0.1:${bootstrapDht.port}`;
  console.log(`   -> DHT Bootstrap Node active on UDP: ${bootstrapAddr}`);

  const peer1 = new PeerNodeDaemon({
    peerId: 'peer-alpha-seed',
    host: '127.0.0.1',
    storageDir: path.join(rootDir, 'peer1_storage'),
    bootstrapNodes: [bootstrapAddr],
  });
  await peer1.start();
  console.log(`   -> Peer 1 (Alpha) running: HTTP :${peer1.peerServer.port}, DHT UDP :${peer1.dhtNode.port}`);

  const peer2 = new PeerNodeDaemon({
    peerId: 'peer-beta-mirror',
    host: '127.0.0.1',
    storageDir: path.join(rootDir, 'peer2_storage'),
    bootstrapNodes: [bootstrapAddr],
  });
  await peer2.start();
  console.log(`   -> Peer 2 (Beta) running: HTTP :${peer2.peerServer.port}, DHT UDP :${peer2.dhtNode.port}`);

  // 3. Register Publisher and Software
  console.log('\n[3/7] Registering Publisher and Software Product...');
  const keyPair = generateEd25519KeyPair();
  const regRes = await fetch(`${mainServerUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'pub-lead-team',
      username: 'engineering',
      password: 'SecuredPassword2026!',
      public_key: keyPair.publicKey,
    }),
  });
  const regData: any = await regRes.json();
  const publisherToken = regData.token;

  await fetch(`${mainServerUrl}/api/software`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${publisherToken}`,
    },
    body: JSON.stringify({
      id: 'vector-cad',
      name: 'Vector CAD Engine',
      description: 'High-performance 3D vector CAD system',
    }),
  });
  console.log('   -> Software "vector-cad" registered with Ed25519 signature enforcement.');

  // 4. Create v1.0.0 and v2.0.0 Software Payloads
  console.log('\n[4/7] Generating v1.0.0 and v2.0.0 Software Binaries...');
  const v1Payload = Buffer.from('BINARY_HEADER_V1_0_0_DESUDN_PAYLOAD_FOR_TESTING_DATA_INTEGRITY_CHECK_BLOCK_123456');
  const v2Payload = Buffer.from('BINARY_HEADER_V2_0_0_DESUDN_UPGRADED_FAST_RENDER_P2P_NETWORK_ACCELERATION_987654');

  const v1Path = path.join(rootDir, 'vector_cad_v1.bin');
  const v2Path = path.join(rootDir, 'vector_cad_v2.bin');
  await fs.writeFile(v1Path, v1Payload);
  await fs.writeFile(v2Path, v2Payload);

  console.log(`   -> v1 size: ${v1Payload.length} bytes, SHA-256: ${sha256(v1Payload).slice(0, 16)}...`);
  console.log(`   -> v2 size: ${v2Payload.length} bytes, SHA-256: ${sha256(v2Payload).slice(0, 16)}...`);

  // 5. Publisher Generates Diff, Chunks, Signs Manifest, and Seeds Swarm
  console.log('\n[5/7] Publishing Update (Binary Diffing, Chunking, Ed25519 Signing, Seeding)...');
  const publishResult = await SoftwareUploader.publish({
    softwareId: 'vector-cad',
    versionId: '2.0.0',
    baseVersionId: '1.0.0',
    oldBinaryPath: v1Path,
    newBinaryPath: v2Path,
    chunkSize: 24, // 24-byte chunks
    publisherId: 'pub-lead-team',
    publisherPublicKey: keyPair.publicKey,
    publisherPrivateKey: keyPair.privateKey,
    mainServerUrl,
    publisherAuthToken: publisherToken,
    seedStorageDir: path.join(rootDir, 'seed_storage'),
    seedPeer: peer1.peerServer,
  });

  console.log(`   -> Total chunks: ${publishResult.total_chunks}`);
  console.log(`   -> Patch hash: ${publishResult.patch_hash}`);
  console.log(`   -> Manifest signature: ${publishResult.manifest.signature?.slice(0, 32)}...`);

  // Mirror chunks across Peer 2 to create true multi-peer swarm
  for (const chunk of publishResult.manifest.chunks) {
    const data = await peer1.peerServer.storage.getChunk('vector-cad', '2.0.0', chunk.chunk_id);
    await peer2.peerServer.storeAndAnnounceChunk('vector-cad', '2.0.0', chunk.chunk_id, data, chunk.hash);
  }
  console.log('   -> Chunks announced to DHT by both Peer 1 and Peer 2.');

  // 6. Client Discovers and Updates via P2P
  console.log('\n[6/7] Client Update Execution (Trackerless P2P Download & Atomic Staging)...');
  const clientDir = path.join(rootDir, 'client_install');
  await fs.mkdir(clientDir, { recursive: true });
  const clientAppPath = path.join(clientDir, 'vector_cad');
  await fs.writeFile(clientAppPath, v1Payload);

  const client = new SoftwareUpdateClient({
    softwareId: 'vector-cad',
    installedFilePath: clientAppPath,
    currentVersion: '1.0.0',
    mainServerUrl,
    trustedPublisherPublicKey: keyPair.publicKey,
    cacheDir: path.join(clientDir, 'cache'),
    bootstrapNodes: [bootstrapAddr],
    concurrency: 2,
  });

  const updateResult = await client.update();

  console.log(`   -> Update Success: ${updateResult.success}`);
  console.log(`   -> Final Stage: ${updateResult.current_stage}`);
  console.log(`   -> Active Version: ${client.currentVersion}`);

  const liveContent = await fs.readFile(clientAppPath);
  console.log(`   -> Upgraded File Matches v2 Byte-For-Byte: ${liveContent.equals(v2Payload)}`);

  // 7. Cleanup
  console.log('\n[7/7] Shutting Down Demo Cluster...');
  await peer1.stop();
  await peer2.stop();
  await bootstrapDht.close();
  await new Promise((resolve) => mainServer.close(resolve));
  await fs.rm(rootDir, { recursive: true, force: true });

  console.log('\n========================================================================');
  console.log('             DeSUDN Demonstration Completed Successfully!              ');
  console.log('========================================================================\n');
}

runDemo().catch((err) => {
  console.error('Demo error:', err);
  process.exit(1);
});
