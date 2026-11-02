import * as crypto from 'crypto';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';

export function sha256(data: Buffer | string): string {
  const hash = crypto.createHash('sha256');
  hash.update(data);
  return hash.digest('hex');
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  await pipeline(stream, hash);
  return hash.digest('hex');
}

export function generateEd25519KeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

export function canonicalJson(data: any): string {
  if (data === null || typeof data !== 'object') {
    return JSON.stringify(data);
  }
  if (Array.isArray(data)) {
    return '[' + data.map((item) => canonicalJson(item)).join(',') + ']';
  }
  const keys = Object.keys(data).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(data[key])}`);
  return '{' + entries.join(',') + '}';
}

export function signData(data: Buffer | string, privateKeyPem: string): string {
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
  const signature = crypto.sign(null, buffer, privateKeyPem);
  return signature.toString('hex');
}

export function verifySignature(
  data: Buffer | string,
  publicKeyPem: string,
  signatureHex: string
): boolean {
  try {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf-8');
    const signature = Buffer.from(signatureHex, 'hex');
    return crypto.verify(null, buffer, publicKeyPem, signature);
  } catch {
    return false;
  }
}

/**
 * Derives a consistent DHT key string for software/version/chunk.
 */
export function buildDhtKey(softwareId: string, versionId: string, chunkId?: string): string {
  if (chunkId) {
    return `desudn:${softwareId}:${versionId}:chunk:${chunkId}`;
  }
  return `desudn:${softwareId}:${versionId}`;
}

/**
 * Returns a 160-bit SHA-1 hash (in hex) of a string key, matching standard Kademlia ID size (20 bytes).
 */
export function hashDhtKey(key: string): string {
  return crypto.createHash('sha1').update(key).digest('hex');
}
