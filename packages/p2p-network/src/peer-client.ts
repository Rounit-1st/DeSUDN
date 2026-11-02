import * as http from 'http';
import { PeerInfo, sha256, IntegrityCheckError, ChunkNotFoundError } from '@desudn/shared';

export class PeerClient {
  /**
   * Downloads a single chunk from a peer and verifies its SHA-256 hash.
   */
  static async downloadChunk(
    peer: PeerInfo,
    softwareId: string,
    versionId: string,
    chunkId: string,
    expectedHash: string,
    timeoutMs: number = 5000
  ): Promise<Buffer> {
    const url = `http://${peer.host}:${peer.port}/chunks/${encodeURIComponent(softwareId)}/${encodeURIComponent(versionId)}/${encodeURIComponent(chunkId)}`;

    return new Promise((resolve, reject) => {
      const req = http.get(url, (res) => {
        if (res.statusCode === 404) {
          res.resume(); // consume response data to free memory
          return reject(new ChunkNotFoundError(chunkId));
        }

        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Peer returned HTTP ${res.statusCode} for chunk ${chunkId}`));
        }

        const chunks: Buffer[] = [];
        res.on('data', (d) => chunks.push(d));

        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const actualHash = sha256(buffer);

          if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
            return reject(
              new IntegrityCheckError(
                `Corrupted chunk ${chunkId} received from peer ${peer.peer_id}: hash mismatch (expected ${expectedHash}, got ${actualHash})`
              )
            );
          }

          resolve(buffer);
        });

        res.on('error', (err) => reject(err));
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`Timeout downloading chunk ${chunkId} from peer ${peer.peer_id}`));
      });

      req.on('error', (err) => reject(err));
    });
  }

  /**
   * Pings a peer's HTTP status endpoint.
   */
  static async checkPeerStatus(peer: PeerInfo, timeoutMs: number = 2000): Promise<boolean> {
    const url = `http://${peer.host}:${peer.port}/status`;
    return new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
    });
  }
}
