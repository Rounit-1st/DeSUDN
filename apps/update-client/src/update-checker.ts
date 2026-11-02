import { UpdateManifest } from '@desudn/shared';

export interface UpdateCheckResult {
  updateAvailable: boolean;
  currentVersion: string;
  latestVersion?: string;
  manifest?: UpdateManifest;
}

export class UpdateChecker {
  /**
   * Contacts main server to check whether a newer version is available.
   */
  static async checkForUpdate(
    mainServerUrl: string,
    softwareId: string,
    currentVersion: string
  ): Promise<UpdateCheckResult> {
    const url = `${mainServerUrl}/api/software/${encodeURIComponent(softwareId)}/latest`;
    const response = await fetch(url);

    if (response.status === 404) {
      return { updateAvailable: false, currentVersion };
    }

    if (!response.ok) {
      throw new Error(`Failed to query update metadata from server: HTTP ${response.status}`);
    }

    const latestInfo: any = await response.json();
    if (latestInfo.version_id === currentVersion) {
      return { updateAvailable: false, currentVersion, latestVersion: latestInfo.version_id };
    }

    // Retrieve signed update manifest
    const manifestUrl = latestInfo.manifest_url.startsWith('http')
      ? latestInfo.manifest_url
      : `${mainServerUrl}${latestInfo.manifest_url}`;

    const manifestRes = await fetch(manifestUrl);
    if (!manifestRes.ok) {
      throw new Error(`Failed to fetch manifest from ${manifestUrl}: HTTP ${manifestRes.status}`);
    }

    const manifest: UpdateManifest = await manifestRes.json();

    return {
      updateAvailable: true,
      currentVersion,
      latestVersion: latestInfo.version_id,
      manifest,
    };
  }
}
