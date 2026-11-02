import { DhtNodeInfo } from './types.js';
import { DhtDistance } from './distance.js';

export const K_BUCKET_SIZE = 8;

export class KBucket {
  public nodes: DhtNodeInfo[] = [];

  constructor(public readonly minDistance: number, public readonly maxDistance: number) {}

  add(node: DhtNodeInfo): boolean {
    const existingIndex = this.nodes.findIndex((n) => n.nodeId === node.nodeId);
    if (existingIndex !== -1) {
      // Move to end (most recently seen)
      this.nodes.splice(existingIndex, 1);
      this.nodes.push(node);
      return true;
    }

    if (this.nodes.length < K_BUCKET_SIZE) {
      this.nodes.push(node);
      return true;
    }

    return false; // bucket full
  }

  remove(nodeId: string): boolean {
    const index = this.nodes.findIndex((n) => n.nodeId === nodeId);
    if (index !== -1) {
      this.nodes.splice(index, 1);
      return true;
    }
    return false;
  }
}

export class RoutingTable {
  private buckets: KBucket[] = [];
  private allNodes: Map<string, DhtNodeInfo> = new Map();

  constructor(public readonly localNodeId: string) {
    // Start with 1 bucket covering the whole distance range
    this.buckets.push(new KBucket(0, 160));
  }

  addNode(node: DhtNodeInfo): void {
    if (node.nodeId === this.localNodeId) return;
    this.allNodes.set(node.nodeId, node);
    this.buckets[0].add(node);
  }

  removeNode(nodeId: string): void {
    this.allNodes.delete(nodeId);
    for (const b of this.buckets) {
      b.remove(nodeId);
    }
  }

  getNode(nodeId: string): DhtNodeInfo | undefined {
    return this.allNodes.get(nodeId);
  }

  getAllNodes(): DhtNodeInfo[] {
    return Array.from(this.allNodes.values());
  }

  /**
   * Finds the k closest nodes to the target ID based on XOR metric.
   */
  findClosest(targetId: string, count: number = K_BUCKET_SIZE): DhtNodeInfo[] {
    const nodes = Array.from(this.allNodes.values());
    nodes.sort((a, b) => DhtDistance.compare(targetId, a.nodeId, b.nodeId));
    return nodes.slice(0, count);
  }

  size(): number {
    return this.allNodes.size;
  }
}
