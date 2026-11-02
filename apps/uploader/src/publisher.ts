import * as fs from 'fs/promises';
import {
  UpdateManifest,
  sha256File,
  sha256,
} from '@desudn/shared';
import { BinaryDiffEngine } from '@desudn/diff-engine';
import { FixedSizeChunker, DEFAULT_CHUNK_SIZE } from '@desudn/chunker';
import { ManifestBuilder } from '@desudn/manifest';
import { DhtNode } from '@desudn/dht-discovery';
import { ChunkStorageManager, PeerServer } from '@desudn/p2p-network';

export interface PublishUpdateOptions {
  softwareId: string;
  versionId: string;
  baseVersionId: string;
  oldBinaryPath: string;
  newBinaryPath: string;
  chunkSize?: number;
  publisherId: string;
  publisherPublicKey: string;
  publisherPrivateKey: string;
  mainServerUrl: string;
  publisherAuthToken: string;
  seedStorageDir: string;
  seedPeer?: PeerServer;
  dhtNode?: DhtNode;
}

export interface PublishResult {
  software_id: string;
  version_id: string;
  base_version: string;
  patch_size: number;
  total_chunks: number;
  patch_hash: string;
  manifest: UpdateManifest;
}

export class SoftwareUploader {
  static async publish(options: PublishUpdateOptions): Promise<PublishResult> {
    const {
      softwareId,
      versionId,
      baseVersionId,
      oldBinaryPath,
      newBinaryPath,
      chunkSize = DEFAULT_CHUNK_SIZE,
      publisherId,
      publisherPublicKey,
      publisherPrivateKey,
      mainServerUrl,
      publisherAuthToken,
      seedStorageDir,
      seedPeer,
      dhtNode,
    } = options;

    console.log(`[Uploader] Starting publish workflow for ${softwareId} (${baseVersionId} -> ${versionId})`);

    // 1. Read binaries and calculate base & target hashes
    const oldBuffer = await fs.readFile(oldBinaryPath);
    const newBuffer = await fs.readFile(newBinaryPath);
    const baseVersionHash = sha256(oldBuffer);
    const targetVersionHash = sha256(newBuffer);

    console.log(`[Uploader] Base hash: ${baseVersionHash.slice(0, 16)}...`);
    console.log(`[Uploader] Target hash: ${targetVersionHash.slice(0, 16)}...`);

    // 2. Generate binary diff
    console.log('[Uploader] Generating binary diff...');
    const patchBuffer = BinaryDiffEngine.generateDiff(oldBuffer, newBuffer);
    console.log(`[Uploader] Binary diff generated: ${patchBuffer.length} bytes (vs new binary ${newBuffer.length} bytes)`);

    // 3. Chunk the patch
    console.log(`[Uploader] Splitting patch into chunks of size ${chunkSize} bytes...`);
    const chunker = new FixedSizeChunker(chunkSize);
    const chunkResult = chunker.chunk(patchBuffer, softwareId, versionId);
    console.log(`[Uploader] Created ${chunkResult.chunks.length} chunks.`);

    // 4. Generate signed update manifest
    console.log('[Uploader] Generating and signing update manifest...');
    const manifest = ManifestBuilder.create({
      software_id: softwareId,
      version_id: versionId,
      base_version: baseVersionId,
      base_version_hash: baseVersionHash,
      target_version_hash: targetVersionHash,
      patch_hash: chunkResult.patchHash,
      patch_size: chunkResult.patchSize,
      chunk_size: chunkResult.chunkSize,
      chunks: chunkResult.chunks.map((c) => c.metadata),
      publisher_id: publisherId,
      publisher_public_key: publisherPublicKey,
      publisher_private_key: publisherPrivateKey,
    });

    // 5. Store chunks in initial seed storage
    console.log(`[Uploader] Saving chunks to initial seed peer storage (${seedStorageDir})...`);
    const storage = new ChunkStorageManager(seedStorageDir);
    for (const chunk of chunkResult.chunks) {
      if (seedPeer) {
        await seedPeer.storeAndAnnounceChunk(
          softwareId,
          versionId,
          chunk.metadata.chunk_id,
          chunk.data,
          chunk.metadata.hash
        );
      } else {
        await storage.saveChunk(
          softwareId,
          versionId,
          chunk.metadata.chunk_id,
          chunk.data,
          chunk.metadata.hash
        );
      }
    }

    // 6. Announce chunks to DHT if standalone dhtNode provided
    if (dhtNode && !seedPeer) {
      console.log('[Uploader] Announcing chunk availability to DHT...');
      for (const chunk of chunkResult.chunks) {
        const chunkKey = `desudn:${softwareId}:${versionId}:chunk:${chunk.metadata.chunk_id}`;
        // Self announcement
        await dhtNode.announceProvider(chunkKey, {
          peer_id: dhtNode.nodeId,
          host: dhtNode.host,
          port: dhtNode.port,
        });
      }
    }

    // 7. Publish update metadata and signed manifest to Main Server
    console.log(`[Uploader] Registering update manifest with main server (${mainServerUrl})...`);
    const response = await fetch(`${mainServerUrl}/api/software/${softwareId}/versions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherAuthToken}`,
      },
      body: JSON.stringify({
        manifest,
        is_latest: true,
      }),
    });

    if (!response.ok) {
      const errBody: any = await response.json().catch(() => ({}));
      throw new Error(
        `Main server rejected update publication (HTTP ${response.status}): ${errBody.error || response.statusText}`
      );
    }

    console.log(`[Uploader] Update ${softwareId} version ${versionId} successfully published!`);

    return {
      software_id: softwareId,
      version_id: versionId,
      base_version: baseVersionId,
      patch_size: chunkResult.patchSize,
      total_chunks: chunkResult.chunks.length,
      patch_hash: chunkResult.patchHash,
      manifest,
    };
  }
}
