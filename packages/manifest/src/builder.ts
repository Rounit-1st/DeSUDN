import {
  UpdateManifest,
  ChunkMetadata,
  canonicalJson,
  signData,
  ManifestValidationError,
} from '@desudn/shared';

export interface CreateManifestParams {
  software_id: string;
  version_id: string;
  base_version: string;
  base_version_hash: string;
  target_version_hash: string;
  patch_hash: string;
  patch_size: number;
  chunk_size: number;
  chunks: ChunkMetadata[];
  publisher_id: string;
  publisher_public_key: string;
  publisher_private_key?: string;
}

export class ManifestBuilder {
  /**
   * Builds and signs an update manifest.
   */
  static create(params: CreateManifestParams): UpdateManifest {
    if (!params.software_id || !params.version_id || !params.base_version) {
      throw new ManifestValidationError('software_id, version_id, and base_version are required');
    }
    if (!params.chunks || params.chunks.length === 0) {
      throw new ManifestValidationError('Manifest must contain at least one chunk');
    }

    const manifest: UpdateManifest = {
      manifest_version: '1.0.0',
      software_id: params.software_id,
      version_id: params.version_id,
      base_version: params.base_version,
      base_version_hash: params.base_version_hash,
      target_version_hash: params.target_version_hash,
      patch_hash: params.patch_hash,
      patch_size: params.patch_size,
      chunk_size: params.chunk_size,
      chunks: params.chunks,
      created_at: new Date().toISOString(),
      publisher_id: params.publisher_id,
      publisher_public_key: params.publisher_public_key,
    };

    if (params.publisher_private_key) {
      manifest.signature = this.signManifest(manifest, params.publisher_private_key);
    }

    return manifest;
  }

  /**
   * Calculates the canonical signature for a manifest.
   */
  static signManifest(manifest: UpdateManifest, privateKeyPem: string): string {
    const { signature, ...unsignedManifest } = manifest;
    const canonicalString = canonicalJson(unsignedManifest);
    return signData(canonicalString, privateKeyPem);
  }
}
