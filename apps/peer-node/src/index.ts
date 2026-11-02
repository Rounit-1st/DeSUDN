import dotenv from 'dotenv';
import { PeerNodeDaemon } from './node.js';

dotenv.config();

const PEER_PORT = parseInt(process.env.PEER_PORT || '5001', 10);
const DHT_PORT = parseInt(process.env.DHT_PORT || '6001', 10);
const HOST = process.env.HOST || '127.0.0.1';
const STORAGE_DIR = process.env.PEER_STORAGE_DIR || './peer_storage';
const BOOTSTRAP_NODES = (process.env.DHT_BOOTSTRAP_NODES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const daemon = new PeerNodeDaemon({
    host: HOST,
    peerPort: PEER_PORT,
    dhtPort: DHT_PORT,
    bootstrapNodes: BOOTSTRAP_NODES,
    storageDir: STORAGE_DIR,
  });

  await daemon.start();

  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });
}

export * from './node.js';

if (require.main === module || process.argv[1]?.includes('peer-node/src/index.ts')) {
  main().catch((err) => {
    console.error('Peer node error:', err);
    process.exit(1);
  });
}
