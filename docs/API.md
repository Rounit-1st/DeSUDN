# DeSUDN API Specification

## 1. Main Server REST API

Base URL: `http://localhost:4000/api`

### Authentication Endpoints

#### `POST /auth/register`
Registers a new publisher account.
- **Request Body**:
  ```json
  {
    "id": "pub-01",
    "username": "publisher_name",
    "password": "strongPassword123",
    "public_key": "-----BEGIN PUBLIC KEY-----\n..."
  }
  ```
- **Response**: `201 Created`
  ```json
  {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "publisher": { "id": "pub-01", "username": "publisher_name", "publicKey": "..." }
  }
  ```

#### `POST /auth/login`
Authenticates an existing publisher.
- **Request Body**:
  ```json
  {
    "username": "publisher_name",
    "password": "strongPassword123"
  }
  ```
- **Response**: `200 OK` (returns JWT token and publisher record).

---

### Software Management Endpoints

#### `POST /software`
Registers a new software product under the authenticated publisher.
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "id": "desktop-editor",
    "name": "Desktop Editor",
    "description": "High performance text editor"
  }
  ```
- **Response**: `201 Created`

#### `POST /software/:softwareId/versions`
Publishes a new software version with signed update manifest.
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "manifest": {
      "manifest_version": "1.0.0",
      "software_id": "desktop-editor",
      "version_id": "2.0.0",
      "base_version": "1.0.0",
      "base_version_hash": "a1b2...",
      "target_version_hash": "c3d4...",
      "patch_hash": "e5f6...",
      "patch_size": 245000,
      "chunk_size": 65536,
      "chunks": [ ... ],
      "publisher_id": "pub-01",
      "publisher_public_key": "...",
      "signature": "..."
    },
    "is_latest": true
  }
  ```
- **Response**: `201 Created`

#### `GET /software/:softwareId/latest`
Retrieves information about the latest available version.
- **Response**: `200 OK`
  ```json
  {
    "software_id": "desktop-editor",
    "version_id": "2.0.0",
    "base_version": "1.0.0",
    "target_version_hash": "c3d4...",
    "manifest_url": "/api/software/desktop-editor/versions/2.0.0/manifest",
    "metadata_url": "/api/software/desktop-editor/versions/2.0.0/metadata"
  }
  ```

#### `GET /software/:softwareId/versions/:versionId`
Retrieves information for a specific version.
- **Response**: `200 OK`

#### `GET /software/:softwareId/versions/:versionId/manifest`
Retrieves the signed update manifest JSON.
- **Response**: `200 OK` (application/json containing full signed `UpdateManifest`).

#### `GET /software/:softwareId/versions/:versionId/metadata`
Retrieves patch summary metadata (patch hash, size, chunk count).
- **Response**: `200 OK`

---

## 2. Peer HTTP Chunk Server API

Base URL: `http://<peer_ip>:<peer_port>`

#### `GET /status`
Returns peer status and active upload connections.
- **Response**: `200 OK`
  ```json
  {
    "status": "ok",
    "peer_id": "peer-alpha-seed",
    "host": "127.0.0.1",
    "port": 5001,
    "active_uploads": 2
  }
  ```

#### `GET /chunks/:softwareId/:versionId/:chunkId`
Streams binary chunk data.
- **Response Headers**:
  - `Content-Type: application/octet-stream`
  - `Content-Length: <size>`
  - `ETag: "<sha256_hash>"`
  - `Cache-Control: public, max-age=31536000, immutable`
- **Response Body**: Raw binary octets of the requested chunk.
- **Status Codes**:
  - `200 OK`: Chunk found and streamed.
  - `404 Not Found`: Chunk not present on this peer.
  - `503 Service Unavailable`: Peer active uploads exceed concurrency limit.
