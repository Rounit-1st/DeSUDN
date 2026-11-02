export class DhtDistance {
  /**
   * Computes XOR distance between two 160-bit (20 bytes, 40 hex chars) node IDs.
   * Returns a Buffer representing the 20-byte XOR distance.
   */
  static xorDistance(idA: string, idB: string): Buffer {
    const bufA = Buffer.from(idA.padStart(40, '0'), 'hex');
    const bufB = Buffer.from(idB.padStart(40, '0'), 'hex');
    const len = Math.max(bufA.length, bufB.length);
    const result = Buffer.alloc(len);

    for (let i = 0; i < len; i++) {
      const byteA = i < bufA.length ? bufA[i] : 0;
      const byteB = i < bufB.length ? bufB[i] : 0;
      result[i] = byteA ^ byteB;
    }

    return result;
  }

  /**
   * Compares two distances.
   * Returns -1 if distA < distB, 1 if distA > distB, 0 if equal.
   */
  static compareDistances(distA: Buffer, distB: Buffer): number {
    return distA.compare(distB);
  }

  /**
   * Compares distance from targetId: returns < 0 if nodeA is closer than nodeB.
   */
  static compare(targetId: string, nodeAId: string, nodeBId: string): number {
    const distA = this.xorDistance(targetId, nodeAId);
    const distB = this.xorDistance(targetId, nodeBId);
    return this.compareDistances(distA, distB);
  }
}
