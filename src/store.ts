import { createHash, randomUUID } from 'node:crypto'
import { existsSync, linkSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import * as sqliteVec from 'sqlite-vec'
import { chunkText } from './chunking.js'
import {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  LocalCpuEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  type EmbeddingProvider,
} from './embeddings.js'
import {
  EMBEDDING_MODES,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type KnowledgeDocument,
  type KnowledgeSource,
  type CapturedMemoryTurn,
  type MemoryCaptureState,
  type MemoryDistillationOperation,
  type MemoryDistillationUsage,
  type MemoKnowSettings,
  type ManagedApiEmbeddingPolicy,
  type MemoryKind,
  type MemoryRecord,
  type MemorySource,
  type MemoryStatus,
  type RevisionedSettings,
  type SearchHit,
  type SearchOptions,
  type LearningControls,
  type RevisionedLearningControls,
} from './types.js'
import { boundedNumber, enumValue, optionalString, requireRecord, requireString, ValidationError } from './validation.js'

const DEFAULT_SETTINGS: MemoKnowSettings = {
  setupComplete: false,
  embeddingMode: 'fts',
  embeddingBaseUrl: 'https://api.openai.com/v1',
  embeddingModel: 'text-embedding-3-small',
  embeddingApiKeyEnv: 'MEMOKNOW_EMBEDDING_API_KEY',
  localEmbeddingModel: DEFAULT_LOCAL_EMBEDDING_MODEL,
  memoryHalfLifeDays: 180,
  maxMemoryResults: 12,
}

const KNOWLEDGE_SEARCH_SAFETY_LIMIT = 100

export type EmbeddingProviderFactory = (settings: MemoKnowSettings) => EmbeddingProvider | null

type SqlRow = Record<string, unknown>

export class ConflictError extends Error {
  readonly code = 'revision_conflict'

  constructor(message = 'The record changed after it was read') {
    super(message)
    this.name = 'ConflictError'
  }
}

export class NotFoundError extends Error {
  readonly code = 'not_found'

  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class EmbeddingSetupError extends Error {
  readonly code = 'embedding_setup_failed'

  constructor(message: string) {
    super(message)
    this.name = 'EmbeddingSetupError'
  }
}

export class MemoKnowStore {
  readonly rootDir: string
  readonly databasePath: string
  private readonly db: DatabaseSync
  private readonly injectedEmbeddingProvider: EmbeddingProvider | undefined
  private readonly embeddingProviderFactory: EmbeddingProviderFactory | undefined
  private readonly embeddingProviders = new Map<string, EmbeddingProvider>()
  private readonly managedEmbedding: ManagedApiEmbeddingPolicy | undefined
  private readonly learningListeners = new Set<() => void>()
  private readonly indexing = new Set<string>()

  constructor(rootDir: string, options: {
    embeddingProvider?: EmbeddingProvider
    embeddingProviderFactory?: EmbeddingProviderFactory
    managedEmbedding?: ManagedApiEmbeddingPolicy
  } = {}) {
    this.rootDir = rootDir
    this.databasePath = join(rootDir, 'memoknow.sqlite3')
    this.managedEmbedding = options.managedEmbedding
    mkdirSync(rootDir, { recursive: true })
    this.injectedEmbeddingProvider = options.embeddingProvider
    this.embeddingProviderFactory = options.embeddingProviderFactory
    this.db = new DatabaseSync(this.databasePath, { allowExtension: true })
    sqliteVec.load(this.db)
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;')
    this.migrate()
  }

  close(): void {
    this.db.close()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        importance REAL NOT NULL,
        confidence REAL NOT NULL,
        source_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_confirmed_at TEXT,
        expires_at TEXT,
        revision INTEGER NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(content, content='memories', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE OF content ON memories BEGIN
        INSERT INTO memory_fts(memory_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO memory_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        media_type TEXT NOT NULL,
        source_json TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        object_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        embedding_status TEXT NOT NULL DEFAULT 'not_configured',
        embedding_error TEXT
      );
      CREATE INDEX IF NOT EXISTS knowledge_sha256_idx ON knowledge_documents(sha256);
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        content TEXT NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(document_id, ordinal)
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(content, content='knowledge_chunks', content_rowid='rowid');
      CREATE TRIGGER IF NOT EXISTS knowledge_chunk_ai AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS knowledge_chunk_ad AFTER DELETE ON knowledge_chunks BEGIN
        INSERT INTO knowledge_fts(knowledge_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TABLE IF NOT EXISTS embedding_generations (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_table TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
        chunk_id TEXT NOT NULL REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        generation_id TEXT NOT NULL REFERENCES embedding_generations(id) ON DELETE CASCADE,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (chunk_id, generation_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        value_json TEXT NOT NULL,
        revision INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_capture_state (
        session_id TEXT PRIMARY KEY,
        captured_through_seq INTEGER NOT NULL,
        processed_through_seq INTEGER NOT NULL,
        last_turn INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS memory_capture_turns (
        session_id TEXT NOT NULL REFERENCES memory_capture_state(session_id) ON DELETE CASCADE,
        turn INTEGER NOT NULL,
        end_seq INTEGER NOT NULL,
        user_text TEXT NOT NULL,
        assistant_text TEXT NOT NULL,
        explicit INTEGER NOT NULL CHECK (explicit IN (0, 1)),
        captured_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn),
        UNIQUE (session_id, end_seq)
      );
      CREATE TABLE IF NOT EXISTS memory_distillation_usage (
        day TEXT NOT NULL,
        session_id TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        calls INTEGER NOT NULL,
        PRIMARY KEY (day, session_id)
      );
      CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS learning_controls (
        id INTEGER PRIMARY KEY CHECK (id = 1), value_json TEXT NOT NULL, revision INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS learning_blocks (
        session_id TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS learning_blocks_session ON learning_blocks(session_id, end_ms);
    `)
    this.addColumnIfMissing('knowledge_documents', 'embedding_status', "TEXT NOT NULL DEFAULT 'not_configured'")
    this.addColumnIfMissing('knowledge_documents', 'embedding_error', 'TEXT')
    const meta = this.db.prepare('SELECT version FROM schema_meta LIMIT 1').get() as SqlRow | undefined
    if (meta === undefined) this.db.prepare('INSERT INTO schema_meta(version) VALUES (?)').run(4)
    else if (Number(meta.version) < 4) this.db.prepare('UPDATE schema_meta SET version = ?').run(4)
    this.db.prepare('INSERT OR IGNORE INTO learning_controls(id, value_json, revision) VALUES (1, ?, 1)')
      .run(JSON.stringify({ paused: false, excludedSessionIds: [], maxSessionTokens: 8_000, maxDailyTokens: 30_000 }))
    const settings = this.db.prepare('SELECT id FROM settings WHERE id = 1').get()
    if (settings === undefined) {
      this.db.prepare('INSERT INTO settings(id, value_json, revision, updated_at) VALUES (1, ?, 1, ?)')
        .run(JSON.stringify(DEFAULT_SETTINGS), new Date().toISOString())
    }
  }

  private addColumnIfMissing(table: string, column: string, declaration: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as SqlRow[]
    if (!columns.some((row) => row.name === column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
  }

  createMemory(input: {
    kind: MemoryKind
    content: string
    status?: MemoryStatus
    importance?: number
    confidence?: number
    source?: MemorySource
    expiresAt?: string | null
  }): MemoryRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    const kind = enumValue(input.kind, 'kind', MEMORY_KINDS)
    const content = requireString(input.content, 'content', 32_000)
    const status = enumValue(input.status, 'status', MEMORY_STATUSES, 'active')
    if (status === 'forgotten') throw new ValidationError('forgotten is reserved for automatic lifecycle maintenance')
    const importance = boundedNumber(input.importance, 'importance', 0.5)
    const confidence = boundedNumber(input.confidence, 'confidence', 1)
    const source = validateMemorySource(input.source ?? { kind: 'agent-written' })
    const expiresAt = validateOptionalDate(input.expiresAt, 'expiresAt')
    this.db.prepare(`INSERT INTO memories
      (id, kind, content, status, importance, confidence, source_json, created_at, updated_at, last_confirmed_at, expires_at, revision)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
      .run(id, kind, content, status, importance, confidence, JSON.stringify(source), now, now, now, expiresAt)
    return this.requireMemory(id)
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as SqlRow | undefined
    return row === undefined ? null : mapMemory(row)
  }

  private requireMemory(id: string): MemoryRecord {
    const record = this.getMemory(id)
    if (record === null) throw new NotFoundError(`Memory ${id} was not found`)
    return record
  }

  listMemories(options: { status?: MemoryStatus; query?: string; limit?: number; offset?: number } = {}): MemoryRecord[] {
    const limit = clampInteger(options.limit ?? 100, 1, 500, 'limit')
    const offset = clampInteger(options.offset ?? 0, 0, 1_000_000, 'offset')
    const conditions: string[] = []
    const params: string[] = []
    if (options.status !== undefined) {
      conditions.push('status = ?')
      params.push(enumValue(options.status, 'status', MEMORY_STATUSES))
    }
    if (options.query?.trim()) {
      conditions.push('rowid IN (SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?)')
      params.push(toFtsQuery(options.query))
    }
    return (this.db.prepare(`SELECT * FROM memories ${conditions.length ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY updated_at DESC, rowid DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as SqlRow[]).map(mapMemory)
  }

  updateMemory(id: string, expectedRevision: number, patch: Partial<Pick<MemoryRecord,
    'kind' | 'content' | 'status' | 'importance' | 'confidence' | 'expiresAt'>>): MemoryRecord {
    const current = this.requireMemory(id)
    if (current.revision !== expectedRevision) throw new ConflictError()
    if (patch.status === 'forgotten') {
      throw new ValidationError('Permanently remove user-forgotten memories with removeMemory')
    }
    const kind = enumValue(patch.kind, 'kind', MEMORY_KINDS, current.kind)
    const content = patch.content === undefined ? current.content : requireString(patch.content, 'content', 32_000)
    const status = enumValue(patch.status, 'status', MEMORY_STATUSES, current.status)
    const importance = boundedNumber(patch.importance, 'importance', current.importance)
    const confidence = boundedNumber(patch.confidence, 'confidence', current.confidence)
    const expiresAt = patch.expiresAt === undefined ? current.expiresAt : validateOptionalDate(patch.expiresAt, 'expiresAt')
    const now = new Date().toISOString()
    const replacement = patch.status === 'active' && current.status !== 'active' ? current.source.replaces : undefined
    if (replacement) this.db.exec('BEGIN IMMEDIATE')
    try {
      if (replacement) {
        const original = this.getMemory(replacement.id)
        if (!original || original.revision !== replacement.revision) {
          throw new ConflictError('The original memory changed. Review it before approving this replacement.')
        }
        this.db.prepare("UPDATE memories SET status = 'superseded', updated_at = ?, revision = revision + 1 WHERE id = ? AND revision = ?")
          .run(now, replacement.id, replacement.revision)
      }
      const source = { ...current.source }
      if (replacement) delete source.replaces
      const result = this.db.prepare(`UPDATE memories SET kind = ?, content = ?, status = ?, importance = ?, confidence = ?,
        expires_at = ?, updated_at = ?, last_confirmed_at = ?, source_json = ?, revision = revision + 1 WHERE id = ? AND revision = ?`)
        .run(kind, content, status, importance, confidence, expiresAt, now,
          patch.status === 'active' ? now : current.lastConfirmedAt, JSON.stringify(source), id, expectedRevision)
      if (Number(result.changes) !== 1) throw new ConflictError()
      if (replacement) this.db.exec('COMMIT')
    } catch (error) {
      if (replacement) this.db.exec('ROLLBACK')
      throw error
    }
    return this.requireMemory(id)
  }

  removeMemory(id: string, expectedRevision: number): void {
    const current = this.requireMemory(id)
    if (current.revision !== expectedRevision) throw new ConflictError()
    const result = this.db.prepare('DELETE FROM memories WHERE id = ? AND revision = ?').run(id, expectedRevision)
    if (Number(result.changes) !== 1) throw new ConflictError()
    this.db.prepare("DELETE FROM memories WHERE status IN ('candidate', 'archived') AND json_extract(source_json, '$.replaces.id') = ?").run(id)
  }

  captureMemoryTurns(sessionIdInput: string, capturedThroughSeq: number, turns: Array<{
    turn: number
    endSeq: number
    userText: string
    assistantText: string
    explicit: boolean
  }>): MemoryCaptureState {
    const sessionId = requireString(sessionIdInput, 'sessionId', 500)
    const throughSeq = nonNegativeInteger(capturedThroughSeq, 'capturedThroughSeq')
    if (!Array.isArray(turns) || turns.length > 100) throw new ValidationError('turns must contain at most 100 entries')
    const admitted = turns.map((turn, index) => ({
      turn: positiveInteger(turn.turn, `turns[${index}].turn`),
      endSeq: nonNegativeInteger(turn.endSeq, `turns[${index}].endSeq`),
      userText: requireString(turn.userText, `turns[${index}].userText`, 20_000),
      assistantText: boundedText(turn.assistantText, `turns[${index}].assistantText`, 20_000),
      explicit: requireBoolean(turn.explicit, `turns[${index}].explicit`),
    }))
    if (admitted.some((turn) => turn.endSeq > throughSeq)) {
      throw new ValidationError('capturedThroughSeq must include every captured turn')
    }
    const now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db.prepare('SELECT captured_through_seq, last_turn FROM memory_capture_state WHERE session_id = ?')
        .get(sessionId) as SqlRow | undefined
      if (existing === undefined) {
        this.db.prepare(`INSERT INTO memory_capture_state
          (session_id, captured_through_seq, processed_through_seq, last_turn, updated_at, last_error)
          VALUES (?, ?, -1, ?, ?, NULL)`).run(sessionId, throughSeq, admitted.at(-1)?.turn ?? 0, now)
      } else if (throughSeq > Number(existing.captured_through_seq)) {
        this.db.prepare(`UPDATE memory_capture_state SET captured_through_seq = ?, last_turn = ?, updated_at = ?
          WHERE session_id = ?`).run(throughSeq, Math.max(Number(existing.last_turn), admitted.at(-1)?.turn ?? 0), now, sessionId)
      }
      const insert = this.db.prepare(`INSERT OR IGNORE INTO memory_capture_turns
        (session_id, turn, end_seq, user_text, assistant_text, explicit, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
      for (const turn of admitted) {
        insert.run(sessionId, turn.turn, turn.endSeq, turn.userText, turn.assistantText, turn.explicit ? 1 : 0, now)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.getMemoryCaptureState(sessionId)!
  }

  getMemoryCaptureState(sessionIdInput: string): MemoryCaptureState | null {
    const sessionId = requireString(sessionIdInput, 'sessionId', 500)
    const row = this.db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM memory_capture_turns t WHERE t.session_id = s.session_id) AS pending_turns
      FROM memory_capture_state s WHERE s.session_id = ?`).get(sessionId) as SqlRow | undefined
    return row === undefined ? null : mapMemoryCaptureState(row)
  }

  listPendingMemoryTurns(sessionIdInput: string, limitInput = 100): CapturedMemoryTurn[] {
    const sessionId = requireString(sessionIdInput, 'sessionId', 500)
    const limit = clampInteger(limitInput, 1, 100, 'limit')
    return (this.db.prepare(`SELECT * FROM memory_capture_turns WHERE session_id = ?
      ORDER BY end_seq ASC LIMIT ?`).all(sessionId, limit) as SqlRow[]).map(mapCapturedMemoryTurn)
  }

  completeMemoryDistillation(sessionIdInput: string, throughSeqInput: number,
    operations: MemoryDistillationOperation[], usage: MemoryDistillationUsage, at = new Date()): {
      created: number
      updated: number
      skipped: number
    } {
    const sessionId = requireString(sessionIdInput, 'sessionId', 500)
    const throughSeq = nonNegativeInteger(throughSeqInput, 'throughSeq')
    if (!Array.isArray(operations) || operations.length > 24) {
      throw new ValidationError('operations must contain at most 24 entries')
    }
    const inputTokens = nonNegativeInteger(usage.inputTokens, 'usage.inputTokens')
    const outputTokens = nonNegativeInteger(usage.outputTokens, 'usage.outputTokens')
    if (Number.isNaN(at.getTime())) throw new ValidationError('at must be a valid date')
    const day = at.toISOString().slice(0, 10)
    let created = 0
    let updated = 0
    let skipped = 0
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const state = this.getMemoryCaptureState(sessionId)
      if (state === null) throw new NotFoundError(`Capture state for ${sessionId} was not found`)
      if (throughSeq > state.capturedThroughSeq) throw new ValidationError('throughSeq exceeds the captured checkpoint')
      for (const operation of operations) {
        if (operation.action === 'create') {
          const duplicate = this.db.prepare(`SELECT id FROM memories
            WHERE lower(trim(content)) = lower(trim(?)) AND status != 'forgotten' LIMIT 1`).get(operation.content)
          if (duplicate !== undefined) {
            skipped += 1
            continue
          }
          this.createMemory({
            kind: operation.kind, content: operation.content, status: operation.status,
            importance: operation.importance, confidence: operation.confidence,
            source: { kind: 'session-distilled', sessionId,
              ...(operation.evidenceTurns === undefined ? {} : { evidenceTurns: operation.evidenceTurns }) },
          })
          created += 1
        } else if (operation.action === 'update') {
          const current = this.requireMemory(operation.id)
          if (current.revision !== operation.expectedRevision) throw new ConflictError()
          const source = validateMemorySource({ kind: 'session-distilled', sessionId,
            ...(operation.evidenceTurns === undefined ? {} : { evidenceTurns: operation.evidenceTurns }),
            replaces: current.status === 'candidate' ? current.source.replaces : { id: current.id, revision: current.revision } })
          const proposed = {
            kind: operation.kind ?? current.kind, content: operation.content ?? current.content,
            status: 'candidate' as const, importance: operation.importance ?? current.importance,
            confidence: operation.confidence ?? current.confidence, expiresAt: current.expiresAt,
          }
          if (current.status === 'candidate') {
            this.updateMemory(operation.id, operation.expectedRevision, proposed)
            this.db.prepare('UPDATE memories SET source_json = ? WHERE id = ?').run(JSON.stringify(source), operation.id)
          } else {
            this.createMemory({ ...proposed, source })
          }
          updated += 1
        } else {
          throw new ValidationError('operation.action must be create or update')
        }
      }
      this.db.prepare('DELETE FROM memory_capture_turns WHERE session_id = ? AND end_seq <= ?').run(sessionId, throughSeq)
      this.db.prepare(`UPDATE memory_capture_state SET
        processed_through_seq = CASE WHEN processed_through_seq > ? THEN processed_through_seq ELSE ? END,
        updated_at = ?, last_error = NULL WHERE session_id = ?`)
        .run(throughSeq, throughSeq, at.toISOString(), sessionId)
      this.recordMemoryUsage(sessionId, { inputTokens, outputTokens }, at)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { created, updated, skipped }
  }

  recordMemoryUsage(sessionId: string, usage: MemoryDistillationUsage, at = new Date()): void {
    const day = at.toISOString().slice(0, 10)
    const inputTokens = nonNegativeInteger(usage.inputTokens, 'inputTokens')
    const outputTokens = nonNegativeInteger(usage.outputTokens, 'outputTokens')
    this.db.prepare(`INSERT INTO memory_distillation_usage(day, session_id, input_tokens, output_tokens, calls)
        VALUES (?, ?, ?, ?, 1) ON CONFLICT(day, session_id) DO UPDATE SET
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        calls = calls + 1`).run(day, sessionId, inputTokens, outputTokens)
  }

  getMemoryDistillationUsage(sessionIdInput: string, at = new Date()): { sessionTokens: number; dailyTokens: number } {
    const sessionId = requireString(sessionIdInput, 'sessionId', 500)
    if (Number.isNaN(at.getTime())) throw new ValidationError('at must be a valid date')
    const day = at.toISOString().slice(0, 10)
    const session = this.db.prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
      FROM memory_distillation_usage WHERE session_id = ?`).get(sessionId) as SqlRow
    const daily = this.db.prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
      FROM memory_distillation_usage WHERE day = ?`).get(day) as SqlRow
    return { sessionTokens: Number(session.tokens), dailyTokens: Number(daily.tokens) }
  }

  recordMemoryDistillationFailure(sessionIdInput: string, error: unknown): void {
    const sessionId = requireString(sessionIdInput, 'sessionId', 500)
    this.db.prepare('UPDATE memory_capture_state SET last_error = ?, updated_at = ? WHERE session_id = ?')
      .run(safeErrorMessage(error), new Date().toISOString(), sessionId)
  }

  getLearningControls(): RevisionedLearningControls {
    const row = this.db.prepare('SELECT * FROM learning_controls WHERE id = 1').get() as SqlRow
    return { revision: Number(row.revision), value: JSON.parse(String(row.value_json)) as LearningControls }
  }

  updateLearningControls(expectedRevision: number, input: unknown, at = new Date()): RevisionedLearningControls {
    const record = requireRecord(input, 'learning controls')
    if (!Array.isArray(record.excludedSessionIds) || record.excludedSessionIds.length > 500) {
      throw new ValidationError('excludedSessionIds must contain at most 500 session IDs')
    }
    const value: LearningControls = {
      paused: requireBoolean(record.paused, 'paused'),
      excludedSessionIds: [...new Set(record.excludedSessionIds.map((id) => requireString(id, 'sessionId', 500)))],
      maxSessionTokens: clampInteger(record.maxSessionTokens as number, 0, 10_000_000, 'maxSessionTokens'),
      maxDailyTokens: clampInteger(record.maxDailyTokens as number, 0, 100_000_000, 'maxDailyTokens'),
    }
    const current = this.getLearningControls()
    if (current.revision !== expectedRevision) throw new ConflictError()
    const before = new Set([...current.value.excludedSessionIds, ...(current.value.paused ? [''] : [])])
    const after = new Set([...value.excludedSessionIds, ...(value.paused ? [''] : [])])
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = this.db.prepare('UPDATE learning_controls SET value_json = ?, revision = revision + 1 WHERE id = 1 AND revision = ?')
        .run(JSON.stringify(value), expectedRevision)
      if (Number(result.changes) !== 1) throw new ConflictError()
      for (const id of after) if (!before.has(id)) {
        this.db.prepare('INSERT INTO learning_blocks(session_id, start_ms) VALUES (?, ?)').run(id, at.getTime())
      }
      for (const id of before) if (!after.has(id)) {
        this.db.prepare('UPDATE learning_blocks SET end_ms = ? WHERE session_id = ? AND end_ms IS NULL').run(at.getTime(), id)
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
    for (const listener of this.learningListeners) listener()
    return this.getLearningControls()
  }

  onLearningControlsChanged(listener: () => void): () => void {
    this.learningListeners.add(listener)
    return () => { this.learningListeners.delete(listener) }
  }

  isLearningEnabled(sessionId: string): boolean {
    const { value } = this.getLearningControls()
    return !value.paused && !value.excludedSessionIds.includes(sessionId)
  }

  learningWasBlocked(sessionId: string, startMs: number, endMs: number): boolean {
    return this.db.prepare(`SELECT 1 FROM learning_blocks WHERE session_id IN ('', ?)
      AND start_ms <= ? AND (end_ms IS NULL OR end_ms >= ?) LIMIT 1`).get(sessionId, endMs, startMs) !== undefined
  }

  learningOverview(offset = 0) {
    const sessions = (this.db.prepare(`SELECT s.*,
      (SELECT COUNT(*) FROM memory_capture_turns t WHERE t.session_id = s.session_id) AS pending_turns,
      (SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM memory_distillation_usage u WHERE u.session_id = s.session_id) AS tokens
      FROM memory_capture_state s ORDER BY updated_at DESC, session_id LIMIT 50 OFFSET ?`)
      .all(clampInteger(offset, 0, 1_000_000, 'offset')) as SqlRow[])
      .map((row) => ({ ...mapMemoryCaptureState(row), tokens: Number(row.tokens) }))
    const counts = this.db.prepare(`SELECT (SELECT COUNT(*) FROM memory_capture_state) AS sessions,
      (SELECT COUNT(*) FROM memory_capture_turns) AS pending`).get() as SqlRow
    const day = new Date().toISOString().slice(0, 10)
    const usage = this.db.prepare(`SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS tokens
      FROM memory_distillation_usage WHERE day = ?`).get(day) as SqlRow
    return { controls: this.getLearningControls(), sessions, totalSessions: Number(counts.sessions),
      pendingTurns: Number(counts.pending), dailyTokens: Number(usage.tokens), day }
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const match = toFtsQuery(query)
    const settings = this.getSettings().value
    const requestedLimit = options.limit === undefined ? undefined : clampInteger(options.limit, 1, 100, 'limit')
    const memoryLimit = Math.min(settings.maxMemoryResults, requestedLimit ?? settings.maxMemoryResults)
    const now = options.now ?? new Date()
    const lifecycle = options.includeArchived === true ? "m.status != 'forgotten'"
      : "m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?)"
    const memoryRows = this.db.prepare(`SELECT m.*, bm25(memory_fts) AS text_rank
      FROM memory_fts JOIN memories m ON m.rowid = memory_fts.rowid
      WHERE memory_fts MATCH ? AND ${lifecycle} ORDER BY text_rank LIMIT ?`)
      .all(match, ...(options.includeArchived === true ? [] : [now.toISOString()]), memoryLimit * 2) as SqlRow[]
    const memoryHits: SearchHit[] = memoryRows.map((row) => {
      const memory = mapMemory(row)
      const ageDays = Math.max(0, (now.getTime() - new Date(memory.updatedAt).getTime()) / 86_400_000)
      const decay = 0.15 + 0.85 * (2 ** (-ageDays / settings.memoryHalfLifeDays))
      const score = textScore(row.text_rank) * (0.5 + memory.importance * 0.3 + memory.confidence * 0.2) * decay
      return { domain: 'memory', id: memory.id, content: memory.content, kind: memory.kind,
        status: memory.status, score, updatedAt: memory.updatedAt }
    })
    const memoryResults = memoryHits.sort((left, right) => right.score - left.score).slice(0, memoryLimit)
    const knowledgeRows = this.db.prepare(`SELECT c.id, c.document_id, c.ordinal, c.content, d.title,
      d.created_at, bm25(knowledge_fts) AS text_rank
      FROM knowledge_fts JOIN knowledge_chunks c ON c.rowid = knowledge_fts.rowid
      JOIN knowledge_documents d ON d.id = c.document_id
      WHERE knowledge_fts MATCH ? ORDER BY d.rowid ASC, c.ordinal ASC LIMIT ?`)
      .all(match, KNOWLEDGE_SEARCH_SAFETY_LIMIT) as SqlRow[]
    const knowledgeHits: SearchHit[] = knowledgeRows.map((row) => ({
      domain: 'knowledge', id: String(row.id), documentId: String(row.document_id), title: String(row.title),
      content: String(row.content), ordinal: Number(row.ordinal), score: textScore(row.text_rank),
    }))
    const combined = [...memoryResults, ...knowledgeHits].filter((hit) => !options.domain || hit.domain === options.domain)
      .sort((left, right) => right.score - left.score)
    return requestedLimit === undefined ? combined : combined.slice(0, requestedLimit)
  }

  importKnowledge(input: {
    title: string
    mediaType: KnowledgeDocument['mediaType']
    content: string
    source?: KnowledgeSource
    originalBytes?: Buffer
  }): KnowledgeDocument {
    const title = requireString(input.title, 'title', 500)
    if (typeof input.content !== 'string' || input.content.trim().length === 0) throw new ValidationError('content must not be empty')
    const originalBytes = input.originalBytes ?? Buffer.from(input.content, 'utf8')
    if (originalBytes.byteLength > 25 * 1024 * 1024) throw new ValidationError('document exceeds 25 MiB')
    const source = validateKnowledgeSource(input.source ?? { kind: 'pasted' })
    const sha256 = createHash('sha256').update(originalBytes).digest('hex')
    const objectName = input.mediaType === 'text/plain' || input.mediaType === 'text/markdown' ? `${sha256}.txt` : sha256
    const objectPath = join('objects', 'sha256', sha256.slice(0, 2), sha256.slice(2, 4), objectName)
    const absolutePath = join(this.rootDir, objectPath)
    if (!existsSync(absolutePath)) {
      mkdirSync(dirname(absolutePath), { recursive: true })
      const temporaryPath = `${absolutePath}.${randomUUID()}.tmp`
      writeFileSync(temporaryPath, originalBytes, { flag: 'wx' })
      try {
        try {
          linkSync(temporaryPath, absolutePath)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        }
      } finally {
        rmSync(temporaryPath, { force: true })
      }
    }
    const chunks = chunkText(input.content)
    const id = randomUUID()
    const now = new Date().toISOString()
    const embeddingStatus = this.embeddingProvider() === null ? 'not_configured' : 'pending'
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`INSERT INTO knowledge_documents
        (id, title, media_type, source_json, sha256, object_path, created_at, updated_at, revision, embedding_status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(id, title, input.mediaType, JSON.stringify(source), sha256, objectPath, now, now, embeddingStatus)
      const statement = this.db.prepare(`INSERT INTO knowledge_chunks
        (id, document_id, ordinal, content, char_start, char_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      for (const chunk of chunks) statement.run(randomUUID(), id, chunk.ordinal, chunk.content, chunk.charStart, chunk.charEnd, now)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return this.requireKnowledge(id)
  }

  async indexKnowledge(documentId: string, signal?: AbortSignal): Promise<void> {
    const provider = this.embeddingProvider()
    if (provider === null) return
    return this.indexKnowledgeWithProvider(documentId, provider, signal)
  }

  listKnowledgeChunks(documentId: string, limit = 20, offset = 0) {
    this.requireKnowledge(documentId)
    return (this.db.prepare('SELECT id, ordinal, content FROM knowledge_chunks WHERE document_id = ? ORDER BY ordinal LIMIT ? OFFSET ?')
      .all(documentId, clampInteger(limit, 1, 50, 'limit'), clampInteger(offset, 0, 1_000_000, 'offset')) as SqlRow[])
      .map((row) => ({ id: String(row.id), ordinal: Number(row.ordinal), content: String(row.content) }))
  }

  async retryKnowledgeIndex(documentId: string, expectedRevision: number, signal?: AbortSignal): Promise<KnowledgeDocument> {
    const document = this.requireKnowledge(documentId)
    if (document.revision !== expectedRevision || this.indexing.has(documentId)) throw new ConflictError()
    if (this.embeddingProvider() === null) throw new ValidationError('Enable an embedding mode before retrying semantic indexing. Keyword search is already available.')
    this.indexing.add(documentId)
    this.db.prepare("UPDATE knowledge_documents SET embedding_status = 'pending', embedding_error = NULL WHERE id = ?").run(documentId)
    try {
      await this.indexKnowledge(documentId, signal)
      return this.requireKnowledge(documentId)
    } catch (error) {
      if (error instanceof NotFoundError) throw error
      throw new EmbeddingSetupError('Semantic indexing failed. Keyword search remains available. Check the provider and retry.')
    } finally { this.indexing.delete(documentId) }
  }

  private async indexKnowledgeWithProvider(documentId: string, provider: EmbeddingProvider, signal?: AbortSignal): Promise<void> {
    this.requireKnowledge(documentId)
    const chunks = this.db.prepare('SELECT rowid, id, content FROM knowledge_chunks WHERE document_id = ? ORDER BY ordinal')
      .all(documentId) as SqlRow[]
    try {
      let dimensions = 0
      let generationId = ''
      let vectorTable = ''
      for (let offset = 0; offset < chunks.length; offset += 16) {
        if (signal?.aborted === true) throw signal.reason ?? new Error('Embedding cancelled')
        const batch = chunks.slice(offset, offset + 16)
        const vectors = await provider.embed(batch.map((row) => String(row.content)), signal, 'document')
        signal?.throwIfAborted()
        this.requireKnowledge(documentId)
        if (vectors.length !== batch.length) throw new Error('Embedding provider returned the wrong vector count')
        if (dimensions === 0) {
          dimensions = vectors[0]?.length ?? 0
          if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > 65_536) throw new Error('Invalid embedding dimensions')
          generationId = createHash('sha256').update(`${provider.id}\0${provider.model}\0${dimensions}`).digest('hex')
          vectorTable = this.ensureVectorGeneration(generationId, provider, dimensions)
        }
        if (vectors.some((vector) => vector.length !== dimensions)) throw new Error('Embedding dimensions changed during indexing')
        // vec0 does not implement SQLite's OR REPLACE conflict behavior.
        const deleteVector = this.db.prepare(`DELETE FROM ${vectorTable} WHERE rowid = ?`)
        const insertVector = this.db.prepare(`INSERT INTO ${vectorTable}(rowid, embedding) VALUES (?, ?)`)
        const insertState = this.db.prepare(`INSERT OR REPLACE INTO knowledge_chunk_embeddings
          (chunk_id, generation_id, content_hash, created_at) VALUES (?, ?, ?, ?)`)
        const now = new Date().toISOString()
        this.db.exec('BEGIN IMMEDIATE')
        try {
          for (let index = 0; index < batch.length; index += 1) {
            const row = batch[index]!
            const vector = vectors[index]!
            const bytes = new Uint8Array(new Float32Array(vector).buffer)
            deleteVector.run(BigInt(String(row.rowid)))
            insertVector.run(BigInt(String(row.rowid)), bytes)
            insertState.run(String(row.id), generationId,
              createHash('sha256').update(String(row.content), 'utf8').digest('hex'), now)
          }
          this.db.exec('COMMIT')
        } catch (error) {
          this.db.exec('ROLLBACK')
          throw error
        }
      }
      this.db.prepare("UPDATE knowledge_documents SET embedding_status = 'ready', embedding_error = NULL WHERE id = ?")
        .run(documentId)
    } catch (error) {
      this.db.prepare("UPDATE knowledge_documents SET embedding_status = 'failed', embedding_error = ? WHERE id = ?")
        .run(safeErrorMessage(error), documentId)
      throw error
    }
  }

  async indexAllKnowledge(signal?: AbortSignal, provider = this.embeddingProvider(), strict = false): Promise<void> {
    if (provider === null) return
    const documents = this.db.prepare('SELECT id FROM knowledge_documents ORDER BY rowid').all() as SqlRow[]
    for (const document of documents) {
      const id = String(document.id)
      this.db.prepare("UPDATE knowledge_documents SET embedding_status = 'pending', embedding_error = NULL WHERE id = ?").run(id)
      try { await this.indexKnowledgeWithProvider(id, provider, signal) } catch (error) {
        if (strict) throw error
      }
    }
  }

  async searchHybrid(query: string, options: SearchOptions = {}, signal?: AbortSignal): Promise<SearchHit[]> {
    const limit = options.limit === undefined ? undefined : clampInteger(options.limit, 1, 100, 'limit')
    const keywordHits = this.search(query, options)
    const provider = this.embeddingProvider()
    if (provider === null || options.domain === 'memory') return limit === undefined ? keywordHits : keywordHits.slice(0, limit)
    try {
      const [queryVector] = await provider.embed([query], signal, 'query')
      if (queryVector === undefined) return limit === undefined ? keywordHits : keywordHits.slice(0, limit)
      const generationId = createHash('sha256').update(`${provider.id}\0${provider.model}\0${queryVector.length}`).digest('hex')
      const generation = this.db.prepare('SELECT vector_table FROM embedding_generations WHERE id = ?').get(generationId) as SqlRow | undefined
      if (generation === undefined) return limit === undefined ? keywordHits : keywordHits.slice(0, limit)
      const table = validateVectorTable(String(generation.vector_table))
      const vectorRows = this.db.prepare(`SELECT rowid, distance FROM ${table}
        WHERE embedding MATCH ? AND k = ? ORDER BY distance`)
        .all(new Uint8Array(new Float32Array(queryVector).buffer), BigInt(limit === undefined
          ? KNOWLEDGE_SEARCH_SAFETY_LIMIT : Math.min(200, limit * 3))) as SqlRow[]
      const combined = new Map<string, SearchHit>()
      for (const hit of keywordHits) combined.set(`${hit.domain}:${hit.id}`, hit)
      const rowIds = vectorRows.map((row) => BigInt(String(row.rowid)))
      const knowledgeRows = rowIds.length === 0 ? [] : this.db.prepare(`SELECT c.rowid, c.id, c.document_id,
          c.ordinal, c.content, d.title FROM knowledge_chunks c
          JOIN knowledge_documents d ON d.id = c.document_id
          WHERE c.rowid IN (${rowIds.map(() => '?').join(', ')})`).all(...rowIds) as SqlRow[]
      const knowledgeByRowId = new Map(knowledgeRows.map((row) => [String(row.rowid), row]))
      for (const vectorRow of vectorRows) {
        const row = knowledgeByRowId.get(String(vectorRow.rowid))
        if (row === undefined) continue
        const id = String(row.id)
        const key = `knowledge:${id}`
        const semanticScore = 1 / (1 + Number(vectorRow.distance))
        const existing = combined.get(key)
        const hit: SearchHit = { domain: 'knowledge', id, documentId: String(row.document_id), title: String(row.title),
          content: String(row.content), ordinal: Number(row.ordinal), score: existing === undefined
            ? semanticScore * 0.9 : Math.max(existing.score, semanticScore) }
        combined.set(key, hit)
      }
      const results = [...combined.values()].sort((left, right) => right.score - left.score)
      return limit === undefined ? results : results.slice(0, limit)
    } catch {
      return limit === undefined ? keywordHits : keywordHits.slice(0, limit)
    }
  }

  private embeddingProvider(settings = this.getSettings().value): EmbeddingProvider | null {
    if (settings.embeddingMode === 'fts') return null
    if (this.injectedEmbeddingProvider !== undefined) return this.injectedEmbeddingProvider
    const key = settings.embeddingMode === 'local-cpu'
      ? `local-cpu:${settings.localEmbeddingModel}`
      : `api:${settings.embeddingBaseUrl}:${settings.embeddingModel}:${settings.embeddingApiKeyEnv}`
    const cached = this.embeddingProviders.get(key)
    if (cached !== undefined) return cached
    const provider = this.embeddingProviderFactory !== undefined
      ? this.embeddingProviderFactory(settings)
      : settings.embeddingMode === 'local-cpu'
        ? new LocalCpuEmbeddingProvider(join(this.rootDir, 'models'))
        : new OpenAICompatibleEmbeddingProvider(settings.embeddingBaseUrl, settings.embeddingModel,
            process.env[settings.embeddingApiKeyEnv] ?? '')
    if (provider !== null) this.embeddingProviders.set(key, provider)
    return provider
  }

  private ensureVectorGeneration(generationId: string, provider: EmbeddingProvider, dimensions: number): string {
    const vectorTable = `knowledge_vec_${dimensions}_${generationId.slice(0, 12)}`
    validateVectorTable(vectorTable)
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${vectorTable} USING vec0(embedding float[${dimensions}] distance_metric=cosine)`)
    this.db.prepare(`INSERT OR IGNORE INTO embedding_generations
      (id, provider, model, dimensions, vector_table, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(generationId, provider.id, provider.model, dimensions, vectorTable, new Date().toISOString())
    return vectorTable
  }

  getKnowledge(id: string): KnowledgeDocument | null {
    const row = this.db.prepare(`SELECT d.*, COUNT(c.id) AS chunk_count FROM knowledge_documents d
      LEFT JOIN knowledge_chunks c ON c.document_id = d.id WHERE d.id = ? GROUP BY d.id`).get(id) as SqlRow | undefined
    return row === undefined ? null : mapKnowledge(row)
  }

  private requireKnowledge(id: string): KnowledgeDocument {
    const document = this.getKnowledge(id)
    if (document === null) throw new NotFoundError(`Knowledge document ${id} was not found`)
    return document
  }

  listKnowledge(options: { limit?: number; offset?: number } = {}): KnowledgeDocument[] {
    const limit = clampInteger(options.limit ?? 100, 1, 500, 'limit')
    const offset = clampInteger(options.offset ?? 0, 0, 1_000_000, 'offset')
    return (this.db.prepare(`SELECT d.*, COUNT(c.id) AS chunk_count FROM knowledge_documents d
      LEFT JOIN knowledge_chunks c ON c.document_id = d.id GROUP BY d.id
      ORDER BY d.created_at DESC, d.rowid DESC LIMIT ? OFFSET ?`).all(limit, offset) as SqlRow[]).map(mapKnowledge)
  }

  removeKnowledge(id: string, expectedRevision: number): void {
    const document = this.requireKnowledge(id)
    if (document.revision !== expectedRevision) throw new ConflictError()
    let removeObject = false
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const vectors = this.db.prepare(`SELECT c.rowid, g.vector_table FROM knowledge_chunks c
        JOIN knowledge_chunk_embeddings e ON e.chunk_id = c.id
        JOIN embedding_generations g ON g.id = e.generation_id WHERE c.document_id = ?`).all(id) as SqlRow[]
      for (const vector of vectors) {
        const table = validateVectorTable(String(vector.vector_table))
        this.db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(BigInt(String(vector.rowid)))
      }
      const result = this.db.prepare('DELETE FROM knowledge_documents WHERE id = ? AND revision = ?').run(id, expectedRevision)
      if (Number(result.changes) !== 1) throw new ConflictError()
      const references = this.db.prepare('SELECT COUNT(*) AS count FROM knowledge_documents WHERE sha256 = ?').get(document.sha256) as SqlRow
      removeObject = Number(references.count) === 0
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    if (removeObject) rmSync(join(this.rootDir, document.objectPath), { force: true })
  }

  getSettings(): RevisionedSettings {
    const row = this.db.prepare('SELECT value_json, revision, updated_at FROM settings WHERE id = 1').get() as SqlRow
    return {
      value: this.effectiveSettings(JSON.parse(String(row.value_json))),
      revision: Number(row.revision),
      updatedAt: String(row.updated_at),
      ...(this.managedEmbedding === undefined ? {} : { management: { embedding: 'managed-api' as const } }),
    }
  }

  updateSettings(expectedRevision: number, input: unknown): RevisionedSettings {
    const value = this.effectiveSettings(input)
    const now = new Date().toISOString()
    const result = this.db.prepare(`UPDATE settings SET value_json = ?, revision = revision + 1, updated_at = ?
      WHERE id = 1 AND revision = ?`).run(JSON.stringify(value), now, expectedRevision)
    if (Number(result.changes) !== 1) throw new ConflictError()
    return this.getSettings()
  }

  async activateSettings(expectedRevision: number, input: unknown, signal?: AbortSignal): Promise<RevisionedSettings> {
    const current = this.getSettings()
    if (current.revision !== expectedRevision) throw new ConflictError()
    const value = this.effectiveSettings(input)
    const provider = this.embeddingProvider(value)
    if (provider !== null) {
      try {
        await provider.prepare?.()
        const probe = await provider.embed(['MemoKnow readiness check'], signal, 'query')
        if (probe.length !== 1 || probe[0] === undefined || probe[0].length === 0) {
          throw new Error('provider returned an empty vector')
        }
        await this.indexAllKnowledge(signal, provider, true)
      } catch (error) {
        throw new EmbeddingSetupError(`Could not enable ${value.embeddingMode} retrieval: ${safeErrorMessage(error)}`)
      }
    }
    return this.updateSettings(expectedRevision, value)
  }

  /** 服务端在验证与持久化前覆盖托管字段，浏览器 PATCH 无法绕过产品策略。 */
  private effectiveSettings(input: unknown): MemoKnowSettings {
    if (this.managedEmbedding === undefined) return validateSettings(input)
    const record = requireRecord(input, 'settings')
    return validateSettings({
      ...record,
      embeddingMode: 'api',
      embeddingBaseUrl: this.managedEmbedding.baseUrl,
      embeddingModel: this.managedEmbedding.model,
      embeddingApiKeyEnv: this.managedEmbedding.apiKeyEnv,
    })
  }

  stats(): { memories: number; knowledgeDocuments: number; knowledgeChunks: number } {
    const row = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM memories WHERE status != 'forgotten') AS memories,
      (SELECT COUNT(*) FROM knowledge_documents) AS knowledge_documents,
      (SELECT COUNT(*) FROM knowledge_chunks) AS knowledge_chunks`).get() as SqlRow
    return { memories: Number(row.memories), knowledgeDocuments: Number(row.knowledge_documents), knowledgeChunks: Number(row.knowledge_chunks) }
  }

  setMemoryUpdatedAtForTest(id: string, timestamp: string): void {
    this.db.prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run(timestamp, id)
  }
}

function mapMemory(row: SqlRow): MemoryRecord {
  return {
    id: String(row.id), kind: row.kind as MemoryKind, content: String(row.content), status: row.status as MemoryStatus,
    importance: Number(row.importance), confidence: Number(row.confidence), source: JSON.parse(String(row.source_json)) as MemorySource,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    lastConfirmedAt: row.last_confirmed_at === null ? null : String(row.last_confirmed_at),
    expiresAt: row.expires_at === null ? null : String(row.expires_at), revision: Number(row.revision),
  }
}

function mapKnowledge(row: SqlRow): KnowledgeDocument {
  return {
    id: String(row.id), title: String(row.title), mediaType: row.media_type as KnowledgeDocument['mediaType'],
    source: JSON.parse(String(row.source_json)) as KnowledgeSource, sha256: String(row.sha256), objectPath: String(row.object_path),
    chunkCount: Number(row.chunk_count), embeddingStatus: String(row.embedding_status) as KnowledgeDocument['embeddingStatus'],
    embeddingError: row.embedding_error === null || row.embedding_error === undefined ? null : String(row.embedding_error),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision),
  }
}

function mapCapturedMemoryTurn(row: SqlRow): CapturedMemoryTurn {
  return {
    sessionId: String(row.session_id), turn: Number(row.turn), endSeq: Number(row.end_seq),
    userText: String(row.user_text), assistantText: String(row.assistant_text),
    explicit: Number(row.explicit) === 1, capturedAt: String(row.captured_at),
  }
}

function mapMemoryCaptureState(row: SqlRow): MemoryCaptureState {
  return {
    sessionId: String(row.session_id), capturedThroughSeq: Number(row.captured_through_seq),
    processedThroughSeq: Number(row.processed_through_seq), lastTurn: Number(row.last_turn),
    pendingTurns: Number(row.pending_turns), updatedAt: String(row.updated_at),
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
  }
}

function validateVectorTable(value: string): string {
  if (!/^knowledge_vec_[1-9][0-9]{0,4}_[a-f0-9]{12}$/.test(value)) throw new Error('Invalid vector table name')
  return value
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Embedding failed'
  return message.slice(0, 500)
}

function toFtsQuery(query: string): string {
  const tokens = requireString(query, 'query', 1_000).normalize('NFKC').match(/[\p{L}\p{N}_-]+/gu) ?? []
  if (tokens.length === 0) throw new ValidationError('query must contain searchable words')
  return tokens.slice(0, 24).map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ')
}

function textScore(rank: unknown): number {
  const numeric = Number(rank)
  return Number.isFinite(numeric) ? 1 + Math.min(1, Math.max(0, -numeric * 100_000)) : 1
}

function clampInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new ValidationError(`${label} must be an integer from ${min} to ${max}`)
  return value
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new ValidationError(`${label} must be a non-negative integer`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new ValidationError(`${label} must be a positive integer`)
  return value
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new ValidationError(`${label} must be a string`)
  if (value.length > maxLength) throw new ValidationError(`${label} must be at most ${maxLength} characters`)
  return value
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(`${label} must be a boolean`)
  return value
}

function validateOptionalDate(value: string | null | undefined, label: string): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new ValidationError(`${label} must be an ISO date-time or null`)
  return new Date(value).toISOString()
}

function validateMemorySource(value: unknown): MemorySource {
  const record = requireRecord(value, 'source')
  const allowed = ['user-stated', 'session-distilled', 'agent-written', 'imported'] as const
  const kind = enumValue(record.kind, 'source.kind', allowed)
  const sessionId = optionalString(record.sessionId, 'source.sessionId', 500)
  const evidenceTurns = record.evidenceTurns
  if (evidenceTurns !== undefined && (!Array.isArray(evidenceTurns) || evidenceTurns.length > 8
    || evidenceTurns.some((turn) => !Number.isSafeInteger(turn) || turn < 1))) {
    throw new ValidationError('source.evidenceTurns must contain at most 8 positive turn numbers')
  }
  const replacement = record.replaces === undefined ? undefined : requireRecord(record.replaces, 'source.replaces')
  const replaces = replacement === undefined ? undefined : {
    id: requireString(replacement.id, 'source.replaces.id', 100),
    revision: positiveInteger(replacement.revision as number, 'source.replaces.revision'),
  }
  return { kind, ...(sessionId === undefined ? {} : { sessionId }), ...(replaces === undefined ? {} : { replaces }),
    ...(evidenceTurns === undefined ? {} : { evidenceTurns: evidenceTurns as number[] }) }
}

function validateKnowledgeSource(value: unknown): KnowledgeSource {
  const record = requireRecord(value, 'source')
  const kind = enumValue(record.kind, 'source.kind', ['pasted', 'file', 'linked'] as const)
  const uri = optionalString(record.uri, 'source.uri', 4_096)
  return uri === undefined ? { kind } : { kind, uri }
}

function validateSettings(value: unknown): MemoKnowSettings {
  const record = requireRecord(value, 'settings')
  if (typeof record.setupComplete !== 'boolean') throw new ValidationError('setupComplete must be a boolean')
  const embeddingMode = enumValue(record.embeddingMode, 'embeddingMode', EMBEDDING_MODES)
  const embeddingBaseUrl = optionalString(record.embeddingBaseUrl, 'embeddingBaseUrl', 2_048) ?? ''
  const embeddingModel = optionalString(record.embeddingModel, 'embeddingModel', 500) ?? ''
  if (embeddingMode === 'api' && embeddingBaseUrl === '') {
    throw new ValidationError('embeddingBaseUrl is required for API mode')
  }
  if (embeddingBaseUrl !== '') {
    let url: URL
    try { url = new URL(embeddingBaseUrl) } catch { throw new ValidationError('embeddingBaseUrl must be an absolute URL') }
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
      throw new ValidationError('embeddingBaseUrl must use HTTPS unless it targets loopback')
    }
  }
  if (embeddingMode === 'api' && embeddingModel === '') throw new ValidationError('embeddingModel is required for API mode')
  const embeddingApiKeyEnv = optionalString(record.embeddingApiKeyEnv, 'embeddingApiKeyEnv', 200) ?? 'MEMOKNOW_EMBEDDING_API_KEY'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(embeddingApiKeyEnv)) throw new ValidationError('embeddingApiKeyEnv must be an environment variable name')
  const localEmbeddingModel = optionalString(record.localEmbeddingModel, 'localEmbeddingModel', 1_000)
    || DEFAULT_LOCAL_EMBEDDING_MODEL
  if (embeddingMode === 'local-cpu' && localEmbeddingModel !== DEFAULT_LOCAL_EMBEDDING_MODEL) {
    throw new ValidationError(`localEmbeddingModel must be ${DEFAULT_LOCAL_EMBEDDING_MODEL}`)
  }
  const memoryHalfLifeDays = boundedNumber(record.memoryHalfLifeDays, 'memoryHalfLifeDays', 180, 1, 3_650)
  const maxMemoryResults = boundedNumber(record.maxMemoryResults ?? record.maxSearchResults,
    'maxMemoryResults', 12, 1, 100)
  return { setupComplete: record.setupComplete, embeddingMode, embeddingBaseUrl, embeddingModel,
    embeddingApiKeyEnv, localEmbeddingModel, memoryHalfLifeDays, maxMemoryResults }
}
