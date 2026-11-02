import * as path from 'path';
import {
  UpdateManifest,
  UpdateApplyResult,
  PeerInfo,
} from '@desudn/shared';
import { DhtNode } from '@desudn/dht-discovery';
import { PatchDownloader } from '@desudn/downloader';
import { IntegrityChecker } from '@desudn/integrity';
import { SafePatchApplier } from '@desudn/patch-applier';
import { UpdateChecker, UpdateCheckResult } from './update-checker.js';

export interface UpdateClientOptions {
  softwareId: string;
  installedFilePath: string;
  currentVersion: string;
  mainServerUrl: string;
  trustedPublisherPublicKey?: string;
  cacheDir?: string;
  bootstrapNodes?: string[];
  directPeers?: PeerInfo[];
  concurrency?: number;
}

export class SoftwareUpdateClient {
  public readonly softwareId: string;
  public readonly installedFilePath: string;
  public currentVersion: string;
  private mainServerUrl: string;
  private trustedPublisherPublicKey?: string;
  private cacheDir: string;
  private bootstrapNodes: string[];
  private directPeers: PeerInfo[];
  private concurrency: number;
  private dhtNode?: DhtNode;

  constructor(options: UpdateClientOptions) {
    this.softwareId = options.softwareId;
    this.installedFilePath = path.resolve(options.installedFilePath);
    this.currentVersion = options.currentVersion;
    this.mainServerUrl = options.mainServerUrl;
    this.trustedPublisherPublicKey = options.trustedPublisherPublicKey;
    this.cacheDir = options.cacheDir || path.resolve('./.desudn/client_cache');
    this.bootstrapNodes = options.bootstrapNodes || [];
    this.directPeers = options.directPeers || [];
    this.concurrency = options.concurrency || 4;
  }

  /**
   * Step 1-3: Check whether an update is available on the main server.
   */
  async checkUpdate(): Promise<UpdateCheckResult> {
    return UpdateChecker.checkForUpdate(this.mainServerUrl, this.softwareId, this.currentVersion);
  }

  /**
   * Complete update execution workflow:
   * 1. Check for update and obtain metadata/manifest from main server
   * 2. Verify manifest cryptographic signature
   * 3. Start DHT node and discover chunk providers
   * 4. Concurrently download chunks from peers
   * 5. Verify chunk hashes & reassemble patch
   * 6. Transactionally apply patch with backup & rollback
   */
  async update(): Promise<UpdateApplyResult> {
    console.log(`[Client] Checking for updates on ${this.softwareId} (current: ${this.currentVersion})...`);
    const checkResult = await this.checkUpdate();

    if (!checkResult.updateAvailable || !checkResult.manifest) {
      console.log(`[Client] Software is already up to date (${this.currentVersion}).`);
      return {
        success: true,
        software_id: this.softwareId,
        from_version: this.currentVersion,
        to_version: this.currentVersion,
        current_stage: 'idle',
      };
    }

    const manifest = checkResult.manifest;
    console.log(
      `[Client] New update found: version ${manifest.version_id} (requires base version ${manifest.base_version})`
    );

    return this.applyManifestUpdate(manifest);
  }

  /**
   * Applies an update given an already-obtained manifest.
   * Useful when main server is down after manifest retrieval!
   */
  async applyManifestUpdate(manifest: UpdateManifest): Promise<UpdateApplyResult> {
    // 1. Verify manifest signature
    console.log('[Client] Verifying manifest signature and structure...');
    IntegrityChecker.verifyManifest(manifest, this.trustedPublisherPublicKey);

    // 2. Initialize DHT Node for peer discovery
    this.dhtNode = new DhtNode({
      host: '127.0.0.1',
      port: 0, // dynamic port
    });
    await this.dhtNode.start();

    if (this.bootstrapNodes.length > 0) {
      console.log('[Client] Bootstrapping DHT discovery with nodes:', this.bootstrapNodes);
      await this.dhtNode.bootstrap(this.bootstrapNodes);
    }

    try {
      // 3. Download patch chunks from P2P network
      console.log(`[Client] Initiating P2P patch download (${manifest.chunks.length} chunks)...`);
      const downloader = new PatchDownloader({
        manifest,
        cacheDir: this.cacheDir,
        dhtNode: this.dhtNode,
        directPeers: this.directPeers,
        concurrency: this.concurrency,
      });

      downloader.on('progress', (p) => {
        console.log(`[Client] Download progress: ${p.completedChunks}/${p.totalChunks} chunks (${p.percent}%)`);
      });

      const patchPath = await downloader.download();
      console.log(`[Client] Patch downloaded and verified successfully: ${patchPath}`);

      // 4. Safely apply patch with backup, staging, and rollback
      console.log('[Client] Staging and applying patch atomically...');
      const applier = new SafePatchApplier(this.cacheDir);
      const result = await applier.applyUpdate({
        softwareId: this.softwareId,
        installedFilePath: this.installedFilePath,
        patchFilePath: patchPath,
        manifest,
        workspaceDir: this.cacheDir,
        trustedPublisherPublicKey: this.trustedPublisherPublicKey,
      });

      if (result.success) {
        this.currentVersion = manifest.version_id;
        console.log(`[Client] Update applied successfully! Software is now at version ${this.currentVersion}.`);
      } else {
        console.error(`[Client] Update failed and was rolled back: ${result.error}`);
      }

      return result;
    } finally {
      if (this.dhtNode) {
        await this.dhtNode.close();
      }
    }
  }
}
