import { PeerInfo } from '@desudn/shared';

export interface DhtNodeInfo {
  nodeId: string; // 160-bit hex string
  host: string;
  port: number;   // DHT UDP port
}

export type DhtMessageType =
  | 'PING'
  | 'PONG'
  | 'FIND_NODE'
  | 'NODES_FOUND'
  | 'ANNOUNCE_PROVIDER'
  | 'ANNOUNCE_ACK'
  | 'GET_PROVIDERS'
  | 'PROVIDERS_FOUND';

export interface DhtMessage {
  msgId: string;
  type: DhtMessageType;
  sender: DhtNodeInfo;
  payload?: any;
}

export interface ProviderRecord {
  peerInfo: PeerInfo;
  announcedAt: number;
  expiresAt: number;
}
