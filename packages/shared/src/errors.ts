export class DeSUDNError extends Error {
  constructor(message: string, public code: string = 'DESUDN_ERROR') {
    super(message);
    this.name = 'DeSUDNError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ManifestValidationError extends DeSUDNError {
  constructor(message: string) {
    super(message, 'MANIFEST_VALIDATION_ERROR');
    this.name = 'ManifestValidationError';
  }
}

export class IntegrityCheckError extends DeSUDNError {
  constructor(message: string) {
    super(message, 'INTEGRITY_CHECK_ERROR');
    this.name = 'IntegrityCheckError';
  }
}

export class ChunkNotFoundError extends DeSUDNError {
  constructor(chunkId: string) {
    super(`Chunk not found: ${chunkId}`, 'CHUNK_NOT_FOUND');
    this.name = 'ChunkNotFoundError';
  }
}

export class PatchApplyError extends DeSUDNError {
  constructor(message: string) {
    super(message, 'PATCH_APPLY_ERROR');
    this.name = 'PatchApplyError';
  }
}

export class RollbackError extends DeSUDNError {
  constructor(message: string) {
    super(message, 'ROLLBACK_ERROR');
    this.name = 'RollbackError';
  }
}
