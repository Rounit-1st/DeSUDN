import { PeerInfo } from '@desudn/shared';
import { ProviderRecord } from './types.js';

export const DEFAULT_RECORD_TTL_MS = 10 * 60 * 1000; // 10 minutes default TTL

export class ProviderStore {
  // key (e.g. SHA-1 hash of software_id/version_id/chunk_id) -> Map<peer_id, ProviderRecord>
  private store: Map<string, Map<string, ProviderRecord>> = new Map();
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private readonly defaultTtlMs: number = DEFAULT_RECORD_TTL_MS) {
    this.startCleanupTimer();
  }

  addProvider(key: string, peerInfo: PeerInfo, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    const now = Date.now();
    let records = this.store.get(key);
    if (!records) {
      records = new Map();
      this.store.set(key, records);
    }

    records.set(peerInfo.peer_id, {
      peerInfo,
      announcedAt: now,
      expiresAt: now + ttl,
    });
  }

  getProviders(key: string): PeerInfo[] {
    const records = this.store.get(key);
    if (!records) return [];

    const now = Date.now();
    const activePeers: PeerInfo[] = [];

    for (const [peerId, record] of records.entries()) {
      if (record.expiresAt > now) {
        activePeers.push(record.peerInfo);
      } else {
        records.delete(peerId); // lazy eviction of expired entry
      }
    }

    if (records.size === 0) {
      this.store.delete(key);
    }

    return activePeers;
  }

  removeProvider(key: string, peerId: string): void {
    const records = this.store.get(key);
    if (records) {
      records.delete(peerId);
      if (records.size === 0) {
        this.store.delete(key);
      }
    }
  }

  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;

    for (const [key, records] of this.store.entries()) {
      for (const [peerId, record] of records.entries()) {
        if (record.expiresAt <= now) {
          records.delete(peerId);
          purged++;
        }
      }
      if (records.size === 0) {
        this.store.delete(key);
      }
    }

    return purged;
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.store.clear();
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.purgeExpired();
    }, 60 * 1000);
    // Don't prevent process from exiting
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }
}
