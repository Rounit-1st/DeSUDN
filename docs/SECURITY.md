# DeSUDN Security Architecture

Security is integrated into every layer of DeSUDN: from publisher identity to network chunk verification and atomic rollback.

---

## 1. Threat Model & Mitigations

| Threat | Attack Vector | DeSUDN Mitigation |
| :--- | :--- | :--- |
| **Tampered / Corrupted Chunks** | Man-in-the-middle or rogue peer alters chunk data | Immediate SHA-256 validation of every chunk upon download; corrupted chunks are instantly discarded. |
| **Malicious Update Manifest** | Attacker publishes fake update with malware | Ed25519 asymmetric signatures over canonical manifest JSON; rejected if publisher public key does not match. |
| **Path Traversal Attacks** | Malicious `software_id`, `version_id`, or `chunk_id` with `../` | Strict regex validation (`^[a-zA-Z0-9_\-\.]+$`) and path resolution assertion against base storage root. |
| **Installed Software Corruption** | Power outage or patch error mid-upgrade | Atomic staging directory application: patch is applied and verified on a copy before live replacement. Automatic rollback restores original backup on failure. |
| **Version Downgrade / Mismatch** | Patch applied to unexpected software version | Pre-check verifies SHA-256 of currently installed software against `manifest.base_version_hash`. |
| **Denial of Service / Swarm Poisoning** | Rogue peer advertises missing chunks | Downloader tracks peer failure scores; penalizes and rotates away from non-responsive or malicious peers. |

---

## 2. Multi-Layer Cryptographic Verification

```
+-------------------------------------------------------------------+
| 1. Manifest Cryptographic Verification                            |
|    - Verify Ed25519 signature over canonical JSON                 |
|    - Asserts publisher authorization                              |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| 2. Base Software Compatibility Verification                       |
|    - Computes SHA-256 of installed software                       |
|    - Asserts matches manifest.base_version_hash                   |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| 3. Individual Chunk Verification                                  |
|    - Computes SHA-256 of each downloaded chunk                    |
|    - Asserts matches chunk.hash in manifest                       |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| 4. Reassembled Patch Verification                                 |
|    - Computes SHA-256 of assembled patch                          |
|    - Asserts matches manifest.patch_hash                          |
+-------------------------------------------------------------------+
                                 |
                                 v
+-------------------------------------------------------------------+
| 5. Staged Target Binary Verification                              |
|    - Applies patch inside isolated staging directory              |
|    - Computes SHA-256 of staged new binary                        |
|    - Asserts matches manifest.target_version_hash                 |
|    - ONLY then proceeds to atomic swap                            |
+-------------------------------------------------------------------+
```

---

## 3. Publisher Identity and Ed25519 Signatures

### Key Generation
Publishers generate an Ed25519 key pair (256-bit elliptic curve key):
- The public key is registered with the publisher account on the main server.
- The private key remains exclusively in the publisher's secure environment.

### Deterministic Canonical JSON Signing
To avoid signature discrepancies caused by JSON key ordering or whitespace:
1. Manifest object keys are sorted lexicographically at every depth.
2. Canonical string is hashed and signed with Ed25519:
   ```ts
   const canonicalString = canonicalJson(unsignedManifest);
   const signature = crypto.sign(null, Buffer.from(canonicalString), privateKeyPem);
   ```
3. Clients verify the signature using the publisher's registered public key before accepting the update.

---

## 4. Transactional Update & Rollback Mechanism

### Never Overwrite Live Binary Before Verification
1. **Backup Phase**: Full copy of current software is stored in `.desudn/backups/<software_id>/<version>_<timestamp>/`.
2. **Staging Phase**: A temporary directory `.desudn/staging/<id>` is created. The current binary is copied here and patched.
3. **Verification Phase**: Staged binary SHA-256 is verified against `target_version_hash`.
4. **Atomic Swap**:
   - `rename(installedPath, installedPath.old)`
   - `rename(stagedPatchedPath, installedPath)`
   - Live binary hash re-verified.
   - Clean up `installedPath.old`.
5. **Rollback Trigger**:
   If any error occurs during patch application, hash verification, or swap:
   - Live file is restored immediately from `installedPath.old` or the verified backup.
   - Staging directory is cleaned.
   - Error is logged and returned in `UpdateApplyResult`.
