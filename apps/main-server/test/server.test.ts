import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import { createApp } from '../src/app.js';
import { MemoryDatabase } from '../src/db/memory.js';
import { ManifestBuilder } from '@desudn/manifest';
import { generateEd25519KeyPair } from '@desudn/shared';

describe('Main Server Metadata & Auth API', () => {
  let server: http.Server;
  let baseUrl: string;
  let publisherToken: string;
  const { publicKey, privateKey } = generateEd25519KeyPair();

  beforeAll(async () => {
    const db = new MemoryDatabase();
    const app = createApp(db);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('should register a new publisher and receive JWT', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'pub-test-01',
        username: 'alice',
        password: 'securePassword123!',
        public_key: publicKey,
      }),
    });

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.token).toBeDefined();
    expect(body.publisher.id).toBe('pub-test-01');
    publisherToken = body.token;
  });

  it('should register a new software product under the publisher', async () => {
    const res = await fetch(`${baseUrl}/api/software`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({
        id: 'awesome-tool',
        name: 'Awesome Tool CLI',
        description: 'P2P update test application',
      }),
    });

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.id).toBe('awesome-tool');
  });

  it('should reject unauthenticated requests to register software', async () => {
    const res = await fetch(`${baseUrl}/api/software`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'unauthorized-app',
        name: 'Hack',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('should publish a version with a valid signed manifest', async () => {
    const manifest = ManifestBuilder.create({
      software_id: 'awesome-tool',
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
      publisher_id: 'pub-test-01',
      publisher_public_key: publicKey,
      publisher_private_key: privateKey,
    });

    const res = await fetch(`${baseUrl}/api/software/awesome-tool/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({
        manifest,
        is_latest: true,
      }),
    });

    expect(res.status).toBe(201);
    const body: any = await res.json();
    expect(body.version_id).toBe('2.0.0');
  });

  it('should retrieve latest version, manifest, and metadata', async () => {
    // 1. Latest
    const latestRes = await fetch(`${baseUrl}/api/software/awesome-tool/latest`);
    expect(latestRes.status).toBe(200);
    const latestBody: any = await latestRes.json();
    expect(latestBody.version_id).toBe('2.0.0');

    // 2. Manifest
    const manifestRes = await fetch(`${baseUrl}/api/software/awesome-tool/versions/2.0.0/manifest`);
    expect(manifestRes.status).toBe(200);
    const manifestBody: any = await manifestRes.json();
    expect(manifestBody.software_id).toBe('awesome-tool');
    expect(manifestBody.signature).toBeDefined();

    // 3. Metadata
    const metaRes = await fetch(`${baseUrl}/api/software/awesome-tool/versions/2.0.0/metadata`);
    expect(metaRes.status).toBe(200);
    const metaBody: any = await metaRes.json();
    expect(metaBody.patch_hash).toBe('c'.repeat(64));
    expect(metaBody.total_chunks).toBe(1);
  });
});
