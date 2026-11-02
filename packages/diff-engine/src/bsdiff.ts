import * as zlib from 'zlib';
import * as fs from 'fs/promises';
import { PatchApplyError, DeSUDNError } from '@desudn/shared';

const MAGIC = Buffer.from('DESUDIFF1'); // 9 bytes header magic
const BLOCK_SIZE = 8; // 8-byte chunk index for pattern matching

interface ControlTuple {
  diffLen: number;   // bytes to read from diff block and add to oldBuf
  extraLen: number;  // bytes to copy from extra block
  seekOffset: number;// signed offset to move oldBuf position
}

export class BinaryDiffEngine {
  /**
   * Generates a binary diff patch between oldBuffer and newBuffer.
   */
  static generateDiff(oldBuffer: Buffer, newBuffer: Buffer): Buffer {
    const oldSize = oldBuffer.length;
    const newSize = newBuffer.length;

    // Build index for oldBuffer (hash -> positions)
    const index = new Map<number, number[]>();
    for (let i = 0; i <= oldSize - BLOCK_SIZE; i += 2) {
      const key = oldBuffer.readUInt32LE(i);
      const list = index.get(key);
      if (list) {
        if (list.length < 32) { // cap collision list for performance
          list.push(i);
        }
      } else {
        index.set(key, [i]);
      }
    }

    const controlTuples: ControlTuple[] = [];
    const diffChunks: Buffer[] = [];
    const extraChunks: Buffer[] = [];

    let oldPos = 0;
    let newPos = 0;
    let accumulatedExtraStart = 0;

    while (newPos < newSize) {
      let bestMatchOldPos = -1;
      let bestMatchLen = 0;

      if (newPos <= newSize - BLOCK_SIZE) {
        const key = newBuffer.readUInt32LE(newPos);
        const candidates = index.get(key);
        if (candidates) {
          for (const candPos of candidates) {
            let matchLen = 0;
            while (
              candPos + matchLen < oldSize &&
              newPos + matchLen < newSize &&
              oldBuffer[candPos + matchLen] === newBuffer[newPos + matchLen]
            ) {
              matchLen++;
            }
            if (matchLen > bestMatchLen) {
              bestMatchLen = matchLen;
              bestMatchOldPos = candPos;
            }
          }
        }
      }

      // If we found a meaningful match (at least BLOCK_SIZE bytes)
      if (bestMatchLen >= BLOCK_SIZE && bestMatchOldPos !== -1) {
        // First handle any extra bytes accumulated before this match
        const extraLen = newPos - accumulatedExtraStart;
        if (extraLen > 0) {
          extraChunks.push(newBuffer.subarray(accumulatedExtraStart, newPos));
        }

        // Generate diff block for the matched segment
        const diffBuf = Buffer.alloc(bestMatchLen);
        for (let i = 0; i < bestMatchLen; i++) {
          diffBuf[i] = (newBuffer[newPos + i] - oldBuffer[bestMatchOldPos + i]) & 0xff;
        }
        diffChunks.push(diffBuf);

        // Record control entry
        const seekOffset = bestMatchOldPos - oldPos;
        controlTuples.push({
          diffLen: bestMatchLen,
          extraLen,
          seekOffset,
        });

        oldPos = bestMatchOldPos + bestMatchLen;
        newPos += bestMatchLen;
        accumulatedExtraStart = newPos;
      } else {
        // Advance 1 byte and continue accumulating extra
        newPos++;
      }
    }

    // Flush remaining extra bytes
    const remainingExtraLen = newSize - accumulatedExtraStart;
    if (remainingExtraLen > 0) {
      extraChunks.push(newBuffer.subarray(accumulatedExtraStart, newSize));
      controlTuples.push({
        diffLen: 0,
        extraLen: remainingExtraLen,
        seekOffset: 0,
      });
    }

    // Serialize control tuples: each tuple is 4 bytes diffLen, 4 bytes extraLen, 4 bytes seekOffset (12 bytes)
    const ctrlBuffer = Buffer.alloc(controlTuples.length * 12);
    let ctrlOffset = 0;
    for (const tuple of controlTuples) {
      ctrlBuffer.writeUInt32LE(tuple.diffLen, ctrlOffset);
      ctrlBuffer.writeUInt32LE(tuple.extraLen, ctrlOffset + 4);
      ctrlBuffer.writeInt32LE(tuple.seekOffset, ctrlOffset + 8);
      ctrlOffset += 12;
    }

    const diffData = Buffer.concat(diffChunks);
    const extraData = Buffer.concat(extraChunks);

    // Compress blocks with zlib deflate
    const compressedCtrl = zlib.deflateSync(ctrlBuffer);
    const compressedDiff = zlib.deflateSync(diffData);
    const compressedExtra = zlib.deflateSync(extraData);

    // Construct final patch:
    // Magic: 9 bytes
    // ctrlLen (compressed): 4 bytes
    // diffLen (compressed): 4 bytes
    // extraLen (compressed): 4 bytes
    // newSize: 4 bytes
    // oldSize: 4 bytes
    // payload: compressedCtrl + compressedDiff + compressedExtra
    const header = Buffer.alloc(9 + 20);
    MAGIC.copy(header, 0);
    header.writeUInt32LE(compressedCtrl.length, 9);
    header.writeUInt32LE(compressedDiff.length, 13);
    header.writeUInt32LE(compressedExtra.length, 17);
    header.writeUInt32LE(newSize, 21);
    header.writeUInt32LE(oldSize, 25);

    return Buffer.concat([header, compressedCtrl, compressedDiff, compressedExtra]);
  }

  /**
   * Applies a binary diff patch to oldBuffer, returning the reconstructed newBuffer.
   */
  static applyPatch(oldBuffer: Buffer, patchBuffer: Buffer): Buffer {
    if (patchBuffer.length < 29) {
      throw new PatchApplyError('Invalid patch file: corrupted or too short');
    }

    // Check magic
    if (!patchBuffer.subarray(0, 9).equals(MAGIC)) {
      throw new PatchApplyError('Invalid patch magic header: format not recognized');
    }

    const ctrlLen = patchBuffer.readUInt32LE(9);
    const diffLen = patchBuffer.readUInt32LE(13);
    const extraLen = patchBuffer.readUInt32LE(17);
    const newSize = patchBuffer.readUInt32LE(21);
    const expectedOldSize = patchBuffer.readUInt32LE(25);

    if (oldBuffer.length !== expectedOldSize) {
      throw new PatchApplyError(
        `Base software size mismatch: expected ${expectedOldSize} bytes, got ${oldBuffer.length} bytes`
      );
    }

    const totalExpectedLen = 29 + ctrlLen + diffLen + extraLen;
    if (patchBuffer.length < totalExpectedLen) {
      throw new PatchApplyError('Patch buffer is truncated or corrupted');
    }

    let offset = 29;
    const compressedCtrl = patchBuffer.subarray(offset, offset + ctrlLen);
    offset += ctrlLen;
    const compressedDiff = patchBuffer.subarray(offset, offset + diffLen);
    offset += diffLen;
    const compressedExtra = patchBuffer.subarray(offset, offset + extraLen);

    let ctrlData: Buffer;
    let diffData: Buffer;
    let extraData: Buffer;
    try {
      ctrlData = zlib.inflateSync(compressedCtrl);
      diffData = zlib.inflateSync(compressedDiff);
      extraData = zlib.inflateSync(compressedExtra);
    } catch (err: any) {
      throw new PatchApplyError(`Failed to decompress patch data: ${err.message}`);
    }

    const newBuffer = Buffer.alloc(newSize);
    let oldPos = 0;
    let newPos = 0;
    let diffPos = 0;
    let extraPos = 0;

    const numTuples = Math.floor(ctrlData.length / 12);
    for (let i = 0; i < numTuples; i++) {
      const tupleOffset = i * 12;
      const tDiffLen = ctrlData.readUInt32LE(tupleOffset);
      const tExtraLen = ctrlData.readUInt32LE(tupleOffset + 4);
      const tSeekOffset = ctrlData.readInt32LE(tupleOffset + 8);

      // 1. Process extra bytes (if any preceded the diff)
      if (tExtraLen > 0) {
        if (extraPos + tExtraLen > extraData.length || newPos + tExtraLen > newSize) {
          throw new PatchApplyError('Corrupted patch: extra block out of bounds');
        }
        extraData.copy(newBuffer, newPos, extraPos, extraPos + tExtraLen);
        newPos += tExtraLen;
        extraPos += tExtraLen;
      }

      // 2. Adjust oldPos by seekOffset
      oldPos += tSeekOffset;

      // 3. Process diff bytes
      if (tDiffLen > 0) {
        if (
          oldPos + tDiffLen > oldBuffer.length ||
          diffPos + tDiffLen > diffData.length ||
          newPos + tDiffLen > newSize ||
          oldPos < 0
        ) {
          throw new PatchApplyError('Corrupted patch: diff block out of bounds');
        }

        for (let j = 0; j < tDiffLen; j++) {
          newBuffer[newPos + j] = (oldBuffer[oldPos + j] + diffData[diffPos + j]) & 0xff;
        }
        newPos += tDiffLen;
        diffPos += tDiffLen;
        oldPos += tDiffLen;
      }
    }

    if (newPos !== newSize) {
      throw new PatchApplyError(
        `Patch application incomplete: expected ${newSize} bytes, assembled ${newPos} bytes`
      );
    }

    return newBuffer;
  }

  /**
   * Generates diff directly between two files on disk.
   */
  static async generateDiffFiles(oldPath: string, newPath: string, patchPath: string): Promise<Buffer> {
    const oldBuffer = await fs.readFile(oldPath);
    const newBuffer = await fs.readFile(newPath);
    const patchBuffer = this.generateDiff(oldBuffer, newBuffer);
    await fs.writeFile(patchPath, patchBuffer);
    return patchBuffer;
  }

  /**
   * Applies patch to an old file on disk, writing output to newPath.
   */
  static async applyPatchFiles(oldPath: string, patchPath: string, newPath: string): Promise<Buffer> {
    const oldBuffer = await fs.readFile(oldPath);
    const patchBuffer = await fs.readFile(patchPath);
    const newBuffer = this.applyPatch(oldBuffer, patchBuffer);
    await fs.writeFile(newPath, newBuffer);
    return newBuffer;
  }
}
