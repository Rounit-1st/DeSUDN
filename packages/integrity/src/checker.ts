import * as fs from 'fs/promises';
import {
  UpdateManifest,
  sha256,
  sha256File,
  IntegrityCheckError,
} from '@desudn/shared';
import { ManifestValidator } from '@desudn/manifest';

export class IntegrityChecker {
  /**
   * Verifies manifest schema and publisher cryptographic signature.
   */
  static verifyManifest(manifest: UpdateManifest, trustedPublisherPublicKey?: string): void {
    ManifestValidator.assertValid(manifest, trustedPublisherPublicKey);
  }

  /**
   * Verifies that the currently installed software matches the base version expected by the patch.
   */
  static async verifyBaseSoftware(
    installedSoftwarePath: string,
    expectedBaseHash: string
  ): Promise<boolean> {
    try {
      const actualHash = await sha256File(installedSoftwarePath);
      if (actualHash.toLowerCase() !== expectedBaseHash.toLowerCase()) {
        throw new IntegrityCheckError(
          `Installed software hash mismatch! Expected ${expectedBaseHash}, found ${actualHash}`
        );
      }
      return true;
    } catch (err: any) {
      if (err instanceof IntegrityCheckError) throw err;
      throw new IntegrityCheckError(
        `Failed to access or hash installed base software at ${installedSoftwarePath}: ${err.message}`
      );
    }
  }

  /**
   * Verifies the reassembled patch file matches the manifest's patch_hash.
   */
  static async verifyPatch(
    patchPathOrBuffer: string | Buffer,
    expectedPatchHash: string
  ): Promise<boolean> {
    const actualHash = Buffer.isBuffer(patchPathOrBuffer)
      ? sha256(patchPathOrBuffer)
      : await sha256File(patchPathOrBuffer);

    if (actualHash.toLowerCase() !== expectedPatchHash.toLowerCase()) {
      throw new IntegrityCheckError(
        `Patch file hash mismatch! Expected ${expectedPatchHash}, found ${actualHash}`
      );
    }
    return true;
  }

  /**
   * Verifies the resulting patched software matches the manifest's target_version_hash.
   */
  static async verifyTargetSoftware(
    targetSoftwarePath: string,
    expectedTargetHash: string
  ): Promise<boolean> {
    const actualHash = await sha256File(targetSoftwarePath);
    if (actualHash.toLowerCase() !== expectedTargetHash.toLowerCase()) {
      throw new IntegrityCheckError(
        `Patched software target hash mismatch! Expected ${expectedTargetHash}, found ${actualHash}`
      );
    }
    return true;
  }

  /**
   * Comprehensive pre-apply check:
   * 1. Manifest signature and structure
   * 2. Installed base software matches expected base hash
   * 3. Downloaded patch file matches expected patch hash
   */
  static async verifyAllPreApply(
    installedSoftwarePath: string,
    patchPath: string,
    manifest: UpdateManifest,
    trustedPublisherPublicKey?: string
  ): Promise<void> {
    this.verifyManifest(manifest, trustedPublisherPublicKey);
    await this.verifyBaseSoftware(installedSoftwarePath, manifest.base_version_hash);
    await this.verifyPatch(patchPath, manifest.patch_hash);
  }
}
