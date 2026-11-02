# DeSUDN (Decentralized Software Update Distribution Network)

[![Tests](https://img.shields.io/badge/tests-33%20passed-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)]()
[![Node](https://img.shields.io/badge/Node.js-22%2B-green.svg)]()
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)]()

**DeSUDN** is a decentralized, peer-to-peer software update distribution network built with Node.js and TypeScript. It replaces centralized update distribution architectures with a trackerless Kademlia-based Distributed Hash Table (DHT), binary diff patches, concurrent chunk swarming, and transactional atomic update application with automatic rollback.

---

## Key Features

- **Trackerless Peer Discovery (DHT)**: Completely decentralized peer and chunk discovery using a Kademlia-inspired DHT (160-bit XOR metric, K-buckets, TTL-based provider storage). **No centralized tracker server.**
- **Binary Diffing (`bsdiff`)**: Computes compact binary difference patches between arbitrary software versions using suffix sorting and modular byte diffing.
- **Chunked P2P Distribution**: Splits binary patches into cryptographic chunks with SHA-256 integrity verification and parallel multi-peer downloads.
- **Ed25519 Signed Manifests**: Publishers cryptographically sign update manifests; clients enforce publisher authenticity before accepting updates.
- **Central Server Independence**: The system continues downloading and upgrading seamlessly even if the central metadata server goes offline after manifest retrieval.
- **Transactional Staging & Rollback**: Staged application and pre-/post-verification ensure that installed software is never corrupted. Automatically reverts to backup if verification fails.
- **Fault-Tolerant Swarming**: Automatically handles unresponsive peers, detects and rejects corrupted chunks, and resumes interrupted downloads without re-downloading verified chunks.

---

## Repository Structure

```text
desudn/
├── apps/
│   ├── main-server/       # Express + PostgreSQL software registry & signed manifest API
│   ├── uploader/          # Publisher CLI: diffing, chunking, signing, seeding, announcing
│   ├── peer-node/         # Peer node daemon: runs DHT node + Chunk HTTP server + seed/cache manager
│   └── update-client/     # Client updater CLI: update check, DHT discovery, P2P download, safe apply
│
├── packages/
│   ├── shared/            # Shared types, error definitions, Ed25519 crypto, SHA-256 helpers
│   ├── diff-engine/       # Colin Percival-inspired pure TypeScript bsdiff & bspatch engine
│   ├── chunker/           # Fixed-size chunking, chunk hashing, patch reassembler
│   ├── manifest/          # Manifest schema, canonical JSON serializer, Ed25519 signer & validator
│   ├── dht-discovery/     # Kademlia-based DHT (XOR metric, K-buckets, TTL provider store, UDP RPC)
│   ├── p2p-network/       # Peer HTTP chunk server & client, chunk cache manager, DHT announcer
│   ├── downloader/        # Concurrent chunk downloader with state machine, retry, resumption
│   ├── integrity/         # Multi-layer integrity checker (signature, chunks, patch, target binary)
│   └── patch-applier/     # Safe atomic update applier, backup manager, staging, rollback engine
│
├── infrastructure/
│   ├── docker/            # Dockerfiles for main server, peer node, postgres
│   ├── database/          # PostgreSQL migrations (001_initial_schema.sql, 002_seed_data.sql)
│   └── docker-compose.yml # Full multi-container cluster setup
│
├── scripts/
│   └── demo.ts            # Interactive live end-to-end swarm & update demonstration
│
├── tests/
│   └── e2e/               # End-to-end scenarios: multi-peer update, failover, resumption, rollback
│
└── docs/
    ├── ARCHITECTURE.md    # Technical system architecture and data flows
    ├── DHT_DESIGN.md      # In-depth trackerless DHT design vs trackers
    ├── SECURITY.md        # Cryptographic signatures, defenses, and threat model
    ├── API.md             # REST and HTTP Chunk API reference
    └── LIMITATIONS.md     # Known limitations and future roadmap
```

---

## Getting Started

### Prerequisites
- **Node.js**: v20 or higher (v22+ recommended)
- **npm**: v10 or higher
- **Docker & Docker Compose** (optional, for containerized deployment)

### 1. Installation
Clone the repository and install root dependencies:
```bash
git clone https://github.com/your-org/desudn.git
cd desudn
npm install
```

### 2. Environment Setup
Copy the example environment configuration:
```bash
cp .env.example .env
```

---

## Running the Automated Test Suite

Run all unit, integration, and end-to-end tests across the entire monorepo:
```bash
npm test
```

### End-to-End Demonstration Test
Run the comprehensive E2E test verifying:
1. End-to-end update from v1 to v2 across multiple DHT peers.
2. Main server outage resilience after manifest retrieval.
3. Corrupted chunk rejection and peer failover.
4. Download resumption after interruption.
5. Transactional rollback when staged verification fails.

```bash
npm run test:e2e
```

---

## Live Interactive Demonstration

To see the complete swarm in action in under 3 seconds:
```bash
npm run demo
```

What the demo demonstrates:
1. Spawns an in-memory Main Server with publisher authentication.
2. Spawns a trackerless Kademlia DHT bootstrap node and two peer nodes.
3. Generates two binary versions of an application.
4. Generates a binary diff patch, chunks it, signs the manifest with Ed25519, and seeds chunks across the DHT swarm.
5. Launches an update client with v1 installed.
6. Discovers peers via DHT, downloads chunks concurrently from multiple peers, verifies hashes, stages the patch, atomically swaps binaries, and verifies the upgraded binary matches v2 byte-for-byte!

---

## Docker Deployment

To launch the complete DeSUDN network with PostgreSQL, Main Server, DHT Bootstrap node, and two peer nodes:
```bash
docker compose up --build
```

Services started:
- `desudn-postgres`: PostgreSQL database (port 5432) with pre-applied migrations
- `desudn-main-server`: Metadata & Version registry (port 4000)
- `desudn-dht-bootstrap`: Initial DHT entry point (port 6000/udp)
- `desudn-peer-node-1`: Peer 1 chunk server (port 5001, DHT 6001/udp)
- `desudn-peer-node-2`: Peer 2 chunk server (port 5002, DHT 6002/udp)

---

## How It Works

### Publishing an Update
```text
Publisher
   │
   ├─► Read Old Version + New Version
   ├─► BinaryDiffEngine.generateDiff()
   ├─► FixedSizeChunker.chunk()
   ├─► Calculate Chunk SHA-256 Hashes
   ├─► Sign Manifest using Ed25519 Private Key
   ├─► Save Chunks into Initial Seed Peer
   ├─► Announce Chunk & Version Keys to DHT Swarm
   └─► Register Manifest with Main Server
```

### Downloading and Safely Applying an Update
```text
Client
   │
   ├─► Check Update on Main Server
   ├─► Retrieve Signed Update Manifest
   ├─► Verify Manifest Signature using Publisher Public Key
   ├─► Connect to DHT Bootstrap Node
   ├─► Query DHT for Providers of Chunks
   ├─► Download Chunks Concurrently (with retries & peer rotation)
   ├─► Verify Individual Chunk Hashes (reject corrupted data)
   ├─► Assemble Patch & Verify Total Patch Hash
   │
   ▼ Transactional Staging & Rollback:
   ├─► Verify Base Software matches base_version_hash
   ├─► Create Backup of Live Binary
   ├─► Copy Binary to Staging Directory
   ├─► Apply Binary Patch in Staging
   ├─► Verify Staged Binary matches target_version_hash
   ├─► Atomic Swap: live -> live.old, staged -> live
   ├─► Verify Live Target File
   └─► If any step fails: Restore Backup Immediately!
```

---

## Documentation Links

- [Architecture Overview](docs/ARCHITECTURE.md)
- [DHT-Based Trackerless Design](docs/DHT_DESIGN.md)
- [Security Model & Verification](docs/SECURITY.md)
- [API Reference](docs/API.md)
- [Known Limitations & Roadmap](docs/LIMITATIONS.md)

---

## License

Apache License 2.0. See LICENSE for details.
