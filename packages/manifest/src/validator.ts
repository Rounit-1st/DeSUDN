import {
  UpdateManifest,
  canonicalJson,
  verifySignature,
  ManifestValidationError,
  IntegrityCheckError,
} from '@desudn/shared';

export class ManifestValidator {
  /**
   * Validates manifest structure, types, and cryptographic signature.
   */
  static validate(
    manifest: UpdateManifest,
    expectedPublisherPublicKey?: string
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!manifest.software_id) errors.push('Missing software_id');
    if (!manifest.version_id) errors.push('Missing version_id');
    if (!manifest.base_version) errors.push('Missing base_version');
    if (!manifest.patch_hash) errors.push('Missing patch_hash');
    if (!manifest.chunks || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
      errors.push('Manifest contains no chunks');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Verify chunk integrity
    let calculatedTotalSize = 0;
    for (let i = 0; i < manifest.chunks.length; i++) {
      const chunk = manifest.chunks[i];
      if (chunk.index !== i) {
        errors.push(`Chunk index gap: expected ${i}, found ${chunk.index}`);
      }
      if (!chunk.hash || chunk.hash.length !== 64) {
        errors.push(`Invalid chunk hash for index ${i}: ${chunk.hash}`);
      }
      calculatedTotalSize += chunk.size;
    }

    if (calculatedTotalSize !== manifest.patch_size) {
      errors.push(
        `Sum of chunk sizes (${calculatedTotalSize}) does not equal patch_size (${manifest.patch_size})`
      );
    }

    // Check signature if present
    if (manifest.signature) {
      const pubKey = expectedPublisherPublicKey || manifest.publisher_public_key;
      if (!pubKey) {
        errors.push('Manifest has signature but no publisher public key to verify');
      } else {
        const { signature, ...unsignedManifest } = manifest;
        const canonical = canonicalJson(unsignedManifest);
        const signatureValid = verifySignature(canonical, pubKey, manifest.signature);
        if (!signatureValid) {
          errors.push('Cryptographic signature verification failed for publisher');
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Strictly asserts manifest is valid or throws.
   */
  static assertValid(manifest: UpdateManifest, expectedPublisherPublicKey?: string): void {
    const result = this.validate(manifest, expectedPublisherPublicKey);
    if (!result.valid) {
      throw new ManifestValidationError(`Manifest validation failed: ${result.errors.join(', ')}`);
    }
  }
}
