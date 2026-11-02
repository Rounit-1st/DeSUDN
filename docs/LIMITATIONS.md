# Known Limitations & Future Improvements

## 1. NAT Traversal & Direct Peer Connectivity
- **Current Status**: DeSUDN prototype peers communicate via direct IP/port addresses (HTTP / UDP socket connections).
- **Limitation**: Peers situated behind strict symmetric NATs or corporate firewalls cannot directly accept incoming TCP/UDP connections from external peers without port forwarding.
- **Future Improvement**: Implement ICE (Interactive Connectivity Establishment), STUN, and TURN protocols or WebRTC DataChannels to enable seamless NAT punch-through.

## 2. Content-Defined Chunking (CDC)
- **Current Status**: Uses `FixedSizeChunker` (default 64KB chunks), which divides patch binaries into deterministic blocks.
- **Limitation**: If large insertions occur at the beginning of a patch stream, fixed offsets shift, reducing chunk deduplication across intermediate sub-versions.
- **Future Improvement**: Implement FastCDC or Rabin Fingerprinting content-defined chunking (the interface `IChunkerStrategy` is already designed to support pluggable chunker algorithms).

## 3. Bandwidth Throttling & Choking Algorithm
- **Current Status**: Downloader uses a configurable concurrency limit (`concurrency = 4`) and PeerServer caps max active uploads (`maxConcurrentUploads = 32`).
- **Limitation**: Does not implement BitTorrent's tit-for-tat rarest-first piece selection and choking algorithm.
- **Future Improvement**: Implement an endgame mode and rarest-first chunk priority based on availability histograms discovered in the DHT.

## 4. Multi-Platform Native Daemon Packaging
- **Current Status**: Node.js and TypeScript modular monorepo.
- **Future Improvement**: Package peer nodes and client updaters using native compilation (e.g., Node SEA - Single Executable Applications, Rust sidecar, or Go client wrapper) with system tray integration.
