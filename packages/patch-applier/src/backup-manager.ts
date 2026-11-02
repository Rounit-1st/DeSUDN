import * as fs from 'fs/promises';
import * as path from 'path';

export interface BackupRecord {
  softwareId: string;
  version: string;
  backupPath: string;
  createdAt: string;
}

export class BackupManager {
  constructor(private readonly backupsDir: string) {}

  async createBackup(
    softwareId: string,
    currentVersion: string,
    installedFilePath: string
  ): Promise<string> {
    const timestamp = Date.now();
    const backupSubdir = path.join(this.backupsDir, softwareId, `${currentVersion}_${timestamp}`);
    await fs.mkdir(backupSubdir, { recursive: true });

    const fileName = path.basename(installedFilePath);
    const backupFilePath = path.join(backupSubdir, fileName);

    await fs.copyFile(installedFilePath, backupFilePath);

    // Save metadata
    const meta: BackupRecord = {
      softwareId,
      version: currentVersion,
      backupPath: backupFilePath,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(backupSubdir, 'backup_info.json'), JSON.stringify(meta, null, 2));

    return backupFilePath;
  }

  async restoreBackup(backupFilePath: string, targetLivePath: string): Promise<void> {
    await fs.copyFile(backupFilePath, targetLivePath);
  }

  async listBackups(softwareId: string): Promise<BackupRecord[]> {
    const dir = path.join(this.backupsDir, softwareId);
    try {
      const entries = await fs.readdir(dir);
      const records: BackupRecord[] = [];
      for (const entry of entries) {
        try {
          const metaPath = path.join(dir, entry, 'backup_info.json');
          const data = await fs.readFile(metaPath, 'utf-8');
          records.push(JSON.parse(data));
        } catch {
          // ignore corrupted record
        }
      }
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }
}
