export const MEMORY_KINDS = ['fact', 'preference', 'decision', 'relationship', 'procedure', 'goal', 'note'] as const
export const MEMORY_STATUSES = ['candidate', 'active', 'stale', 'archived', 'superseded', 'disputed', 'forgotten'] as const
export const EMBEDDING_MODES = ['fts', 'local-cpu', 'api'] as const

export type MemoryKind = typeof MEMORY_KINDS[number]
export type MemoryStatus = typeof MEMORY_STATUSES[number]
export type EmbeddingMode = typeof EMBEDDING_MODES[number]

/** 非敏感的 Host 托管 API 策略；密钥值始终只从命名的环境变量读取。 */
export interface ManagedApiEmbeddingPolicy {
  baseUrl: string
  model: string
  apiKeyEnv: string
}

export interface MemorySource {
  kind: 'user-stated' | 'session-distilled' | 'agent-written' | 'imported'
  sessionId?: string
}

export interface MemoryRecord {
  id: string
  kind: MemoryKind
  content: string
  status: MemoryStatus
  importance: number
  confidence: number
  source: MemorySource
  createdAt: string
  updatedAt: string
  lastConfirmedAt: string | null
  expiresAt: string | null
  revision: number
}

export interface KnowledgeSource {
  kind: 'pasted' | 'file' | 'linked'
  uri?: string
}

export interface KnowledgeDocument {
  id: string
  title: string
  mediaType: 'text/plain' | 'text/markdown' | 'application/msword' | 'application/pdf' | 'text/csv'
    | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  source: KnowledgeSource
  sha256: string
  objectPath: string
  chunkCount: number
  embeddingStatus: 'not_configured' | 'pending' | 'ready' | 'failed'
  embeddingError: string | null
  createdAt: string
  updatedAt: string
  revision: number
}

export interface MemoKnowSettings {
  setupComplete: boolean
  embeddingMode: EmbeddingMode
  embeddingBaseUrl: string
  embeddingModel: string
  embeddingApiKeyEnv: string
  localEmbeddingModel: string
  memoryHalfLifeDays: number
  maxMemoryResults: number
}

export interface RevisionedSettings {
  revision: number
  value: MemoKnowSettings
  updatedAt: string
  management?: { embedding: 'managed-api' }
}

export interface CapturedMemoryTurn {
  sessionId: string
  turn: number
  endSeq: number
  userText: string
  assistantText: string
  explicit: boolean
  capturedAt: string
}

export interface MemoryCaptureState {
  sessionId: string
  capturedThroughSeq: number
  processedThroughSeq: number
  lastTurn: number
  pendingTurns: number
  updatedAt: string
  lastError: string | null
}

export type MemoryDistillationOperation =
  | {
      action: 'create'
      kind: MemoryKind
      content: string
      status: 'candidate' | 'active'
      importance: number
      confidence: number
    }
  | {
      action: 'update'
      id: string
      expectedRevision: number
      kind?: MemoryKind
      content?: string
      status?: MemoryStatus
      importance?: number
      confidence?: number
    }

export interface MemoryDistillationUsage {
  inputTokens: number
  outputTokens: number
}

export interface SearchOptions {
  limit?: number
  includeArchived?: boolean
  now?: Date
}

export type SearchHit =
  | {
      domain: 'memory'
      id: string
      content: string
      kind: MemoryKind
      status: MemoryStatus
      score: number
      updatedAt: string
    }
  | {
      domain: 'knowledge'
      id: string
      documentId: string
      title: string
      content: string
      score: number
      ordinal: number
    }
