import { IDatabase } from './interface.js';

export class MemoryDatabase implements IDatabase {
  public publishers = new Map<string, any>();
  public software = new Map<string, any>();
  public software_versions: any[] = [];
  public patch_metadata: any[] = [];
  public update_manifests: any[] = [];
  public upload_records: any[] = [];

  constructor() {
    // Seed default admin publisher
    this.publishers.set('pub-demo-01', {
      id: 'pub-demo-01',
      username: 'admin',
      password_hash: '$2a$10$vI8aWBnW3fID.ZQ4/zo1G.q1pB6/hR23xX9Jz1i8X0fX8LhTnmf9G',
      public_key: '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAx5s2bY62V792s/6P5V4e9j4v2Y0N/b2L4U2h+z9b7L4=\n-----END PUBLIC KEY-----',
      created_at: new Date().toISOString(),
    });
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const trimmed = sql.trim().toUpperCase();
    // console.log('MemoryDB query:', trimmed, params);

    // 1. SELECT FROM publishers WHERE username = $1
    if (trimmed.startsWith('SELECT') && sql.includes('FROM publishers WHERE username = $1')) {
      const username = params[0];
      const match = Array.from(this.publishers.values()).find((p) => p.username === username);
      return (match ? [match] : []) as T[];
    }

    // 2. SELECT FROM publishers WHERE id = $1
    if (trimmed.startsWith('SELECT') && sql.includes('FROM publishers WHERE id = $1')) {
      const id = params[0];
      const match = this.publishers.get(id);
      return (match ? [match] : []) as T[];
    }

    // 3. INSERT INTO publishers
    if (trimmed.startsWith('INSERT INTO PUBLISHERS')) {
      const [id, username, password_hash, public_key] = params;
      const rec = { id, username, password_hash, public_key, created_at: new Date().toISOString() };
      this.publishers.set(id, rec);
      return [rec] as T[];
    }

    // 4. SELECT FROM software WHERE id = $1
    if (trimmed.startsWith('SELECT') && sql.includes('FROM software WHERE id = $1')) {
      const id = params[0];
      const match = this.software.get(id);
      return (match ? [match] : []) as T[];
    }

    // 5. INSERT INTO software (must match exact word or check software_versions first)
    if (trimmed.startsWith('INSERT INTO SOFTWARE ') || trimmed.startsWith('INSERT INTO SOFTWARE(')) {
      const [id, name, description, publisher_id] = params;
      const rec = { id, name, description, publisher_id, created_at: new Date().toISOString() };
      this.software.set(id, rec);
      return [rec] as T[];
    }

    // 6. UPDATE software_versions SET is_latest = FALSE WHERE software_id = $1
    if (trimmed.startsWith('UPDATE SOFTWARE_VERSIONS SET IS_LATEST = FALSE')) {
      const [software_id] = params;
      for (const v of this.software_versions) {
        if (v.software_id === software_id) {
          v.is_latest = false;
        }
      }
      return [] as T[];
    }

    // 7. INSERT INTO software_versions
    if (trimmed.startsWith('INSERT INTO SOFTWARE_VERSIONS')) {
      const [software_id, version_id, base_version, target_version_hash, is_latest] = params;
      const rec = {
        id: this.software_versions.length + 1,
        software_id,
        version_id,
        base_version,
        target_version_hash,
        is_latest: Boolean(is_latest),
        created_at: new Date().toISOString(),
      };
      // Replace existing or push
      const idx = this.software_versions.findIndex(
        (v) => v.software_id === software_id && v.version_id === version_id
      );
      if (idx !== -1) {
        this.software_versions[idx] = rec;
      } else {
        this.software_versions.push(rec);
      }
      return [rec] as T[];
    }

    // 8. INSERT INTO patch_metadata
    if (trimmed.startsWith('INSERT INTO PATCH_METADATA')) {
      const [software_id, version_id, base_version, patch_hash, patch_size, chunk_size, total_chunks] = params;
      const rec = {
        id: this.patch_metadata.length + 1,
        software_id,
        version_id,
        base_version,
        patch_hash,
        patch_size,
        chunk_size,
        total_chunks,
        created_at: new Date().toISOString(),
      };
      this.patch_metadata.push(rec);
      return [rec] as T[];
    }

    // 9. INSERT INTO update_manifests
    if (trimmed.startsWith('INSERT INTO UPDATE_MANIFESTS')) {
      const [software_id, version_id, base_version, manifest_json, signature] = params;
      const rec = {
        id: this.update_manifests.length + 1,
        software_id,
        version_id,
        base_version,
        manifest_json: typeof manifest_json === 'string' ? JSON.parse(manifest_json) : manifest_json,
        signature,
        created_at: new Date().toISOString(),
      };
      this.update_manifests.push(rec);
      return [rec] as T[];
    }

    // 10. SELECT latest version
    if (trimmed.startsWith('SELECT') && sql.includes('FROM software_versions') && sql.includes('is_latest = true')) {
      const [software_id] = params;
      const match = this.software_versions.find(
        (v) => v.software_id === software_id && v.is_latest === true
      );
      return (match ? [match] : []) as T[];
    }

    // 11. SELECT specific version
    if (trimmed.startsWith('SELECT') && sql.includes('FROM software_versions WHERE software_id = $1 AND version_id = $2')) {
      const [software_id, version_id] = params;
      const match = this.software_versions.find(
        (v) => v.software_id === software_id && v.version_id === version_id
      );
      return (match ? [match] : []) as T[];
    }

    // 12. SELECT manifest
    if (trimmed.startsWith('SELECT') && sql.includes('FROM update_manifests WHERE software_id = $1 AND version_id = $2')) {
      const [software_id, version_id] = params;
      const match = this.update_manifests.find(
        (m) => m.software_id === software_id && m.version_id === version_id
      );
      return (match ? [match] : []) as T[];
    }

    // 13. SELECT metadata
    if (trimmed.startsWith('SELECT') && sql.includes('FROM patch_metadata WHERE software_id = $1 AND version_id = $2')) {
      const [software_id, version_id] = params;
      const match = this.patch_metadata.find(
        (p) => p.software_id === software_id && p.version_id === version_id
      );
      return (match ? [match] : []) as T[];
    }

    // Default fallback
    return [] as T[];
  }

  async close(): Promise<void> {
    // No-op for in-memory database
  }
}
