import { describe, it, expect, afterAll } from 'vitest';
import { DhtNode, DhtDistance, RoutingTable, ProviderStore } from '../src/index.js';
import { PeerInfo } from '@desudn/shared';

describe('DHT Discovery Module', () => {
  it('should compute XOR distances correctly', () => {
    const idA = '0000000000000000000000000000000000000001';
    const idB = '0000000000000000000000000000000000000002';
    const idC = '0000000000000000000000000000000000000003';

    // dist(A, B) = 1 ^ 2 = 3
    // dist(A, C) = 1 ^ 3 = 2
    // C is closer to A than B is to A
    const distAB = DhtDistance.xorDistance(idA, idB);
    const distAC = DhtDistance.xorDistance(idA, idC);

    expect(DhtDistance.compareDistances(distAC, distAB)).toBe(-1);
    expect(DhtDistance.compare(idA, idC, idB)).toBe(-1);
  });

  it('should manage routing table and find closest nodes', () => {
    const localId = '1000000000000000000000000000000000000000';
    const rt = new RoutingTable(localId);

    const node1 = { nodeId: '2000000000000000000000000000000000000000', host: '127.0.0.1', port: 1001 };
    const node2 = { nodeId: '1000000000000000000000000000000000000001', host: '127.0.0.1', port: 1002 };
    const node3 = { nodeId: '9000000000000000000000000000000000000000', host: '127.0.0.1', port: 1003 };

    rt.addNode(node1);
    rt.addNode(node2);
    rt.addNode(node3);

    expect(rt.size()).toBe(3);

    const closest = rt.findClosest(localId, 2);
    expect(closest.length).toBe(2);
    expect(closest[0].nodeId).toBe(node2.nodeId); // Closest to localId
  });

  it('should store and expire provider records based on TTL', async () => {
    const store = new ProviderStore(50); // 50ms TTL
    const peer: PeerInfo = { peer_id: 'p1', host: '127.0.0.1', port: 8080 };

    store.addProvider('key-test', peer);
    expect(store.getProviders('key-test')).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(store.getProviders('key-test')).toHaveLength(0);
    store.destroy();
  });

  describe('DHT Node Network Discovery', () => {
    let bootstrapNode: DhtNode;
    let nodeA: DhtNode;
    let nodeB: DhtNode;

    afterAll(async () => {
      await nodeB?.close();
      await nodeA?.close();
      await bootstrapNode?.close();
    });

    it('should start nodes and bootstrap discovery', async () => {
      bootstrapNode = new DhtNode({ host: '127.0.0.1', port: 16100 });
      await bootstrapNode.start();

      nodeA = new DhtNode({ host: '127.0.0.1', port: 16101 });
      await nodeA.start();

      nodeB = new DhtNode({ host: '127.0.0.1', port: 16102 });
      await nodeB.start();

      // Bootstrap nodeA and nodeB with bootstrapNode
      await nodeA.bootstrap(['127.0.0.1:16100']);
      await nodeB.bootstrap(['127.0.0.1:16100']);

      const pingA = await nodeA.ping('127.0.0.1', 16100);
      expect(pingA).toBe(true);
    });

    it('should announce and find providers through the DHT', async () => {
      const peerAInfo: PeerInfo = {
        peer_id: 'peer-alpha',
        host: '127.0.0.1',
        port: 9001,
      };

      const chunkKey = 'app1/2.0.0/chunk-001';

      // Node A announces it has the chunk
      await nodeA.announceProvider(chunkKey, peerAInfo);

      // Node B queries DHT for providers of that chunk
      const providers = await nodeB.findProviders(chunkKey);

      expect(providers.length).toBeGreaterThan(0);
      expect(providers.some((p) => p.peer_id === 'peer-alpha')).toBe(true);
    });
  });
});
