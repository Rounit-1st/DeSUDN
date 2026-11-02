export interface ChunkMetadata {
  chunk_id: string;
  index: number;
  size: number;
  hash: string; // SHA-256 in hex
  offset: number;
}

export interface UpdateManifest {
  manifest_version: string;
  software_id: string;
  version_id: string;
  base_version: string;
  base_version_hash: string;
  target_version_hash: string;
  patch_hash: string;
  patch_size: number;
  chunk_size: number;
  chunks: ChunkMetadata[];
  created_at: string;
  publisher_id: string;
  publisher_public_key: string;
  signature?: string;
}

export interface SoftwareMetadata {
  id: string;
  name: string;
  description: string;
  publisher_id: string;
  created_at: string;
  latest_version?: string;
}

export interface SoftwareVersionMetadata {
  software_id: string;
  version_id: string;
  base_version?: string;
  target_version_hash: string;
  manifest_url: string;
  created_at: string;
}

export interface PeerInfo {
  peer_id: string;
  host: string;
  port: number; // HTTP Chunk server port
  dht_port?: number;
  last_seen?: number;
}

export type ChunkDownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed';

export interface ChunkProgress {
  chunk_id: string;
  index: number;
  size: number;
  hash: string;
  status: ChunkDownloadStatus;
  peer_id?: string;
  error?: string;
}

export interface DownloadSessionState {
  software_id: string;
  version_id: string;
  base_version: string;
  total_chunks: number;
  completed_chunks: number;
  total_bytes: number;
  downloaded_bytes: number;
  chunks: Record<string, ChunkProgress>;
  is_completed: boolean;
  last_updated: string;
}

export type UpdateApplyStage = 
  | 'idle' 
  | 'checking' 
  | 'manifest_retrieved' 
  | 'downloading' 
  | 'patch_assembled' 
  | 'integrity_verified' 
  | 'staged' 
  | 'backup_created' 
  | 'applied' 
  | 'rolled_back' 
  | 'failed';

export interface UpdateApplyResult {
  success: boolean;
  software_id: string;
  from_version: string;
  to_version: string;
  current_stage: UpdateApplyStage;
  backup_path?: string;
  error?: string;
}
