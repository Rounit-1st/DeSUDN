import e from "express";
import fs from "fs/promises";

interface VersionInfo {
    version_id: string;
    torrent_file: string;
    signature: string;
}

const cache = new Map<string, VersionInfo>();

let cacheLoaded = false;

async function getVersionInfo(
    softwareId: string
): Promise<VersionInfo | undefined> {

    // Load data.json only on the first request
    if (!cacheLoaded) {
        const data = await fs.readFile("./db.json", "utf-8");

        const dataJson: Record<string, VersionInfo> = JSON.parse(data);

        for (const [softwareId, versionInfo] of Object.entries(dataJson)) {
            cache.set(softwareId, versionInfo);
        }

        cacheLoaded = true;
    }

    // Now this is a RAM lookup
    return cache.get(softwareId);
}

export { getVersionInfo,  type VersionInfo };