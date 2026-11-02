-- Migration: 001_initial_schema.sql
-- DeSUDN PostgreSQL Normalized Schema

CREATE TABLE IF NOT EXISTS publishers (
    id VARCHAR(64) PRIMARY KEY,
    username VARCHAR(64) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    public_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS software (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    publisher_id VARCHAR(64) NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS software_versions (
    id SERIAL PRIMARY KEY,
    software_id VARCHAR(64) NOT NULL REFERENCES software(id) ON DELETE CASCADE,
    version_id VARCHAR(64) NOT NULL,
    base_version VARCHAR(64),
    target_version_hash VARCHAR(64) NOT NULL,
    is_latest BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_software_version UNIQUE (software_id, version_id)
);

CREATE TABLE IF NOT EXISTS patch_metadata (
    id SERIAL PRIMARY KEY,
    software_id VARCHAR(64) NOT NULL REFERENCES software(id) ON DELETE CASCADE,
    version_id VARCHAR(64) NOT NULL,
    base_version VARCHAR(64) NOT NULL,
    patch_hash VARCHAR(64) NOT NULL,
    patch_size BIGINT NOT NULL,
    chunk_size INT NOT NULL,
    total_chunks INT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_patch_meta UNIQUE (software_id, version_id, base_version)
);

CREATE TABLE IF NOT EXISTS update_manifests (
    id SERIAL PRIMARY KEY,
    software_id VARCHAR(64) NOT NULL REFERENCES software(id) ON DELETE CASCADE,
    version_id VARCHAR(64) NOT NULL,
    base_version VARCHAR(64) NOT NULL,
    manifest_json JSONB NOT NULL,
    signature TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_update_manifest UNIQUE (software_id, version_id, base_version)
);

CREATE TABLE IF NOT EXISTS upload_records (
    id SERIAL PRIMARY KEY,
    software_id VARCHAR(64) NOT NULL REFERENCES software(id) ON DELETE CASCADE,
    version_id VARCHAR(64) NOT NULL,
    publisher_id VARCHAR(64) NOT NULL REFERENCES publishers(id) ON DELETE RESTRICT,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexing for performance
CREATE INDEX IF NOT EXISTS idx_software_versions_latest ON software_versions(software_id, is_latest);
CREATE INDEX IF NOT EXISTS idx_update_manifests_lookup ON update_manifests(software_id, version_id);
