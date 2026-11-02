import * as fs from 'fs/promises';
import * as path from 'path';
import {
  UpdateManifest,
  UpdateApplyResult,
  UpdateApplyStage,
  PatchApplyError,
  RollbackError,
} from '@desudn/shared';
import { BinaryDiffEngine } from '@desudn/diff-engine';
import { IntegrityChecker } from '@desudn/integrity';
import { BackupManager } from './backup-manager.js';

export interface ApplyUpdateOptions {
  softwareId: string;
  installedFilePath: string;
  patchFilePath: string;
  manifest: UpdateManifest;
  workspaceDir: string;
  trustedPublisherPublicKey?: string;
}

export class SafePatchApplier {
  private backupManager: BackupManager;

  constructor(workspaceDir: string) {
    this.backupManager = new BackupManager(path.join(workspaceDir, 'backups'));
  }

  /**
   * Performs an atomic, transactional update with automated staging, verification, and rollback.
   */
  async applyUpdate(options: ApplyUpdateOptions): Promise<UpdateApplyResult> {
    const {
      softwareId,
      installedFilePath,
      patchFilePath,
      manifest,
      workspaceDir,
      trustedPublisherPublicKey,
    } = options;

    let currentStage: UpdateApplyStage = 'checking';
    let backupPath: string | undefined;
    let stagingDir: string | undefined;
    let oldTempLivePath: string | undefined;

    try {
      // 1. Pre-apply integrity verification
      currentStage = 'integrity_verified';
      await IntegrityChecker.verifyAllPreApply(
        installedFilePath,
        patchFilePath,
        manifest,
        trustedPublisherPublicKey
      );

      // 2. Create reliable backup of currently installed software
      currentStage = 'backup_created';
      backupPath = await this.backupManager.createBackup(
        softwareId,
        manifest.base_version,
        installedFilePath
      );

      // 3. Create unique staging area
      currentStage = 'staged';
      const stagingId = `staging_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      stagingDir = path.join(workspaceDir, 'staging', stagingId);
      await fs.mkdir(stagingDir, { recursive: true });

      const stagedBaseFile = path.join(stagingDir, 'base_software.bin');
      const stagedNewFile = path.join(stagingDir, 'patched_software.bin');

      // Copy current live binary to staging
      await fs.copyFile(installedFilePath, stagedBaseFile);

      // 4. Apply binary patch in staging
      await BinaryDiffEngine.applyPatchFiles(stagedBaseFile, patchFilePath, stagedNewFile);

      // 5. Verify the newly generated binary in staging BEFORE touching live software
      await IntegrityChecker.verifyTargetSoftware(stagedNewFile, manifest.target_version_hash);

      // 6. Preserve executable permissions if original file had them
      try {
        const originalStat = await fs.stat(installedFilePath);
        await fs.chmod(stagedNewFile, originalStat.mode);
      } catch {
        // Continue if chmod is not fully supported on some filesystems
      }

      // 7. Atomic Swap:
      // Rename current live binary to .old
      oldTempLivePath = `${installedFilePath}.old_${Date.now()}`;
      await fs.rename(installedFilePath, oldTempLivePath);

      // Move staged new binary into live target location
      try {
        await fs.rename(stagedNewFile, installedFilePath);
      } catch (swapErr: any) {
        // Swap failed: immediately revert .old back to live file!
        await fs.rename(oldTempLivePath, installedFilePath);
        throw new PatchApplyError(`Atomic swap failed: ${swapErr.message}`);
      }

      // 8. Post-verification of live file
      await IntegrityChecker.verifyTargetSoftware(installedFilePath, manifest.target_version_hash);

      // 9. Clean up temporary .old file
      try {
        await fs.unlink(oldTempLivePath);
      } catch {
        // Non-critical
      }

      // 10. Clean up staging directory
      await this.cleanupDirectory(stagingDir);

      currentStage = 'applied';
      return {
        success: true,
        software_id: softwareId,
        from_version: manifest.base_version,
        to_version: manifest.version_id,
        current_stage: currentStage,
        backup_path: backupPath,
      };
    } catch (err: any) {
      // Automatic Rollback
      const failureReason = err.message || 'Unknown error during update application';

      try {
        if (oldTempLivePath) {
          try {
            await fs.rename(oldTempLivePath, installedFilePath);
          } catch {
            // If rename failed, try restore from backup
            if (backupPath) {
              await this.backupManager.restoreBackup(backupPath, installedFilePath);
            }
          }
        } else if (backupPath) {
          // Live file might have been damaged, ensure backup is restored
          const liveExists = await fs.access(installedFilePath).then(() => true).catch(() => false);
          if (!liveExists) {
            await this.backupManager.restoreBackup(backupPath, installedFilePath);
          }
        }
      } catch (rollbackErr: any) {
        throw new RollbackError(
          `Critical rollback failure: ${rollbackErr.message} (Triggered by update error: ${failureReason})`
        );
      }

      // Clean staging
      if (stagingDir) {
        await this.cleanupDirectory(stagingDir);
      }

      return {
        success: false,
        software_id: softwareId,
        from_version: manifest.base_version,
        to_version: manifest.version_id,
        current_stage: 'rolled_back',
        backup_path: backupPath,
        error: failureReason,
      };
    }
  }

  /**
   * Manually roll back software to a specific backup.
   */
  async manualRollback(backupPath: string, installedFilePath: string): Promise<void> {
    await this.backupManager.restoreBackup(backupPath, installedFilePath);
  }

  private async cleanupDirectory(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  }

  getBackupManager(): BackupManager {
    return this.backupManager;
  }
}
