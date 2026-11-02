# DeSUDN Architecture Overview

**DeSUDN (Decentralized Software Update Distribution Network)** is a peer-to-peer software update distribution system engineered to eliminate centralized bandwidth bottlenecks, prevent single-point-of-failure vulnerabilities, and guarantee cryptographic safety during updates.

```
+-----------------------------------------------------------------------------------------+
|                                     DeSUDN Network                                      |
+-----------------------------------------------------------------------------------------+

  [Publisher]
       |
       |  1. Generate Binary Diff (bsdiff)
       |  2. Fixed-size Chunking (SHA-256)
       |  3. Ed25519 Manifest Signing
       v
  [Main Server] <------------------------+
  (Express / PostgreSQL)                 |
  * Software Registration                | 4. Fetch Version Metadata & Signed Manifest
  * Version Management                   |
  * Signed Manifest Distribution         |
                                         |
  [Client Updater] ----------------------+
       |
       |  5. Query Providers for Chunks (software_id/version_id/chunk_id)
       v
  +-----------------------------------------------------------------------+
  |              Trackerless Distributed Hash Table (DHT)                 |
  |                (Kademlia XOR Distance, UDP dgram, TTL)                |
  |                                                                       |
  |   [Bootstrap Node] <----> [Peer Node 1] <----> [Peer Node 2] <----> ...
  +-----------------------------------------------------------------------+
       |
       |  6. Concurrent HTTP Chunk Streaming (GET /chunks/:s/:v/:c)
       |  7. Immediate SHA-256 Chunk Verification
       v
  [Patch Reassembly & Integrity Verification]
       |
       |  8. Staging in Isolated Directory
       |  9. Backup Creation
       | 10. Atomic File Swap & Verification
       | 11. Rollback if Verification Fails
       v
  [Installed Application Upgraded]
```

---

## Core System Components

### 1. Main Server (`apps/main-server`)
- **Role**: Coordinates metadata, publisher identities, software definitions, and version availability.
- **Key Principle**: The main server **never** stores or serves chunk binary data. It provides lightweight JSON discovery responses and signed manifests.
- **Resilience**: If the main server goes offline after a client retrieves the update manifest, the client can continue discovering peers and downloading chunks via the DHT without disruption.
- **Database**: PostgreSQL with normalized schema (publishers, software, software_versions, patch_metadata, update_manifests, upload_records). Includes automatic in-memory fallback for zero-dependency execution.

### 2. Software Uploader (`apps/uploader`)
- **Role**: Publisher tooling for release creation.
- **Workflow**:
  1. Computes SHA-256 hashes of base binary and target binary.
  2. Generates binary diff using Colin Percival-style `bsdiff` algorithm.
  3. Divides patch into chunks (default 64KB, configurable).
  4. Signs manifest with publisher's Ed25519 private key.
  5. Uploads chunks to seed peer repository.
  6. Announces chunk availability to the DHT swarm.
  7. Publishes version record to Main Server.

### 3. Distributed Hash Table (`packages/dht-discovery`)
- **Role**: Completely decentralized, trackerless peer and chunk provider discovery.
- **Routing**: Kademlia K-buckets using 160-bit node IDs and XOR metric distance.
- **Provider Records**: Maps `hash(software_id/version_id/chunk_id)` to list of active peers (`peer_id`, `host`, `port`).
- **TTL Expiration**: Records automatically expire (configurable TTL) and are evicted to prevent stale peers.
- **Bootstrap Nodes**: Serve as initial DHT entry points for routing table population, **not** centralized trackers.

### 4. P2P Network Chunk Server & Client (`packages/p2p-network`)
- **Peer Server**: Embedded HTTP server (`GET /chunks/:softwareId/:versionId/:chunkId`) serving verified chunks with `Cache-Control: immutable` and `ETag`.
- **Peer Client**: High-performance HTTP client with instant SHA-256 hash validation, timeout handling, and connection reuse.
- **Storage Manager**: Safe storage engine with path traversal sanitization.

### 5. Patch Downloader (`packages/downloader`)
- **State Machine**: `IDLE` -> `DISCOVERING_PEERS` -> `DOWNLOADING` -> `VERIFYING` -> `COMPLETED` / `FAILED`.
- **Concurrency**: Parallel chunk requests up to a configurable limit (`concurrency`).
- **Peer Selection**: Tracks peer failure rates; automatically retries alternate peers if one returns an error or times out.
- **Resumption**: Persists download progress in `.download_state.json`. On process restart, verifies already downloaded chunks on disk and downloads only missing chunks.

### 6. Binary Diff & Patch Engine (`packages/diff-engine`)
- **Diffing**: Suffix matching with sliding window indexing and modular byte difference calculation.
- **Patching**: Reconstructs target binary using control tuples `(diffLen, extraLen, seekOffset)` and zlib block decompression.
- **Self-contained**: 100% pure TypeScript implementation with zero native compile friction.

### 7. Safe Patch Applier & Rollback (`packages/patch-applier`)
- **Transactionality**:
  1. Validates base software matches `base_version_hash`.
  2. Creates complete backup in `.desudn/backups/`.
  3. Prepares staging workspace in `.desudn/staging/`.
  4. Applies patch inside staging workspace.
  5. Verifies staged binary matches `target_version_hash`.
  6. Performs atomic rename swap (`app -> app.old`, `app.staged -> app`).
  7. Verifies live binary.
  8. If any failure occurs, restores backup and records error.
