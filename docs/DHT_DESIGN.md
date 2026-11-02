# DHT-Based Trackerless Design in DeSUDN

A fundamental architectural constraint of DeSUDN is the **complete absence of a centralized tracker server**.

Traditional BitTorrent networks originally relied on HTTP or UDP trackers to maintain a central directory of which peers held which torrents. If the tracker failed or was blocked, peer discovery collapsed. DeSUDN eliminates this dependency by employing a **Distributed Hash Table (DHT)** inspired by the Kademlia protocol and BitTorrent Mainline DHT (BEP 0005).

---

## 1. Tracker vs. DHT vs. Bootstrap Nodes

| Feature | Centralized Tracker | DeSUDN DHT | Bootstrap Node |
| :--- | :--- | :--- | :--- |
| **State Storage** | Single server holds full swarm list | Distributed across all DHT nodes | Holds only a routing table of neighbors |
| **Failure Mode** | Network-wide outage if tracker fails | Decentralized; remains functional if nodes leave | Node only used on first join; cluster self-heals |
| **Scalability** | Tracker CPU/network bandwidth bottleneck | O(log N) lookup overhead across swarm | Minimal bandwidth, receives PING/FIND_NODE |
| **Censorship / Choke** | High vulnerability | Extremely resilient | Anyone can run alternative bootstrap nodes |

### Bootstrap Nodes Are Not Trackers
A bootstrap node in DeSUDN:
1. Does **not** maintain lists of all downloaders.
2. Does **not** coordinate who downloads what chunk.
3. Simply answers: *"Here are the $k$ closest DHT nodes I know about in the network."*
Once a peer learns about neighbors, it interacts directly with other peers in the DHT routing table. Any peer node can serve as a bootstrap node.

---

## 2. Kademlia Routing and XOR Metric

### 160-bit Identifier Space
Every node in the DHT is assigned a 160-bit node ID (20 bytes, represented as a 40-character hexadecimal string):

$$\text{NodeID} = \text{randomBytes}(20)$$

### XOR Distance Metric
The distance $d(x, y)$ between two identifiers $x$ and $y$ is defined as their bitwise exclusive OR (XOR):

$$d(x, y) = x \oplus y$$

Properties of XOR distance:
1. $d(x, y) = 0 \iff x = y$
2. $d(x, y) = d(y, x)$ (symmetry)
3. $d(x, z) \le d(x, y) \oplus d(y, z)$ (triangle inequality)

### K-Buckets Routing Table
Each node maintains a routing table organized into buckets of size $k$ (default $k = 8$). Each bucket holds nodes at a specific distance range from the local node ID.
- When new nodes send messages (`PING`, `FIND_NODE`, `ANNOUNCE_PROVIDER`), their info is added to the appropriate bucket.
- Recently seen nodes are moved to the tail; unresponsive nodes are evicted upon timeout.

---

## 3. Provider Records and DHT Keys

### Chunk Provider Key Derivation
Keys in the DHT are derived from the software update hierarchy:
```
Specific Chunk Key: desudn:<software_id>:<version_id>:chunk:<chunk_id>
Version Swarm Key:  desudn:<software_id>:<version_id>
```

The string key is hashed with SHA-1 to map into the 160-bit DHT address space:
```ts
const targetId = crypto.createHash('sha1').update(keyString).digest('hex');
```

### Storing Availability, Not Binary Data
The DHT **never** stores the binary chunk data. It stores **Provider Records**:
```json
{
  "peer_id": "peer-alpha-seed",
  "host": "192.168.1.15",
  "port": 5001,
  "announcedAt": 1772520000000,
  "expiresAt": 1772520600000
}
```

### TTL (Time-To-Live) and Eviction
- Every provider announcement carries an expiration time (default 10 minutes).
- Nodes periodically purge expired records (`purgeExpired()`).
- Stale or departed peers automatically disappear from provider lookups without central coordination.

---

## 4. RPC Protocol Messages

DeSUDN DHT uses lightweight UDP messages (`dgram`):

1. **`PING` / `PONG`**:
   - Tests liveness of a node and keeps routing table entries fresh.
2. **`FIND_NODE` / `NODES_FOUND`**:
   - Queries a node for the $k$ closest nodes to a specified target ID.
3. **`ANNOUNCE_PROVIDER` / `ANNOUNCE_ACK`**:
   - Informs a node that the sender possesses chunks for a specific key.
4. **`GET_PROVIDERS` / `PROVIDERS_FOUND`**:
   - Queries a node for peers that possess a specific chunk or version.
   - Returns known active providers and closer neighbor nodes for iterative lookup.

---

## 5. Main Server Independence

Once the update client has fetched the signed manifest, the main server can be shut down completely:
1. The manifest contains the expected chunk hashes and publisher Ed25519 signature.
2. The client discovers chunk providers via the DHT without contacting the main server.
3. Chunks are downloaded and verified peer-to-peer.
4. Updates are staged and applied atomically.
5. The system remains fully operational under centralized infrastructure failure.
