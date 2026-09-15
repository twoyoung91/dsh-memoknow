import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { ConflictError, MemoKnowStore } from '../src/store.js'

const dirs: string[] = []

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), 'memoknow-'))
  dirs.push(dir)
  return { dir, store: new MemoKnowStore(dir) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('MemoKnowStore managed embedding', () => {
  it('enforces a managed API embedding policy over user settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-managed-'))
    dirs.push(dir)
    const store = new MemoKnowStore(dir, {
      managedEmbedding: {
        baseUrl: 'https://embedding.example.test/v1',
        model: 'managed-embedding-v1',
        apiKeyEnv: 'MANAGED_EMBEDDING_API_KEY',
      },
    })

    const initial = store.getSettings()
    expect(initial.management).toEqual({ embedding: 'managed-api' })
    expect(initial.value).toMatchObject({
      embeddingMode: 'api',
      embeddingBaseUrl: 'https://embedding.example.test/v1',
      embeddingModel: 'managed-embedding-v1',
      embeddingApiKeyEnv: 'MANAGED_EMBEDDING_API_KEY',
    })

    const updated = store.updateSettings(initial.revision, {
      ...initial.value,
      embeddingMode: 'fts',
      embeddingBaseUrl: 'https://user.example.test/v1',
      embeddingModel: 'user-model',
      embeddingApiKeyEnv: 'USER_API_KEY',
    })
    expect(updated.management).toEqual({ embedding: 'managed-api' })
    expect(updated.value).toMatchObject({
      embeddingMode: 'api',
      embeddingBaseUrl: 'https://embedding.example.test/v1',
      embeddingModel: 'managed-embedding-v1',
      embeddingApiKeyEnv: 'MANAGED_EMBEDDING_API_KEY',
    })
    store.close()
  })
})

describe('MemoKnowStore memory', () => {
  it('creates, searches, updates, and lifecycle-filters memories', () => {
    const { store } = createStore()
    const memory = store.createMemory({
      kind: 'preference',
      content: 'The user prefers concise release notes.',
      importance: 0.8,
      confidence: 0.9,
      source: { kind: 'user-stated', sessionId: 'session-1' },
    })

    expect(store.search('concise release')).toMatchObject([
      { domain: 'memory', id: memory.id },
    ])

    const changed = store.updateMemory(memory.id, memory.revision, {
      content: 'The user prefers concise changelogs.',
    })
    expect(changed.revision).toBe(2)
    expect(() => store.updateMemory(memory.id, memory.revision, { status: 'archived' }))
      .toThrow(ConflictError)

    store.updateMemory(memory.id, changed.revision, { status: 'archived' })
    expect(store.search('concise')).toEqual([])
    expect(store.search('concise', { includeArchived: true })).toHaveLength(1)
    store.close()
  })

  it('decays retrieval rank without deleting old memories', () => {
    const { store } = createStore()
    const recent = store.createMemory({ kind: 'fact', content: 'Project comet uses SQLite.', importance: 0.5 })
    const old = store.createMemory({ kind: 'fact', content: 'Project comet originally uses SQLite.', importance: 0.5 })
    store.setMemoryUpdatedAtForTest(old.id, '2020-01-01T00:00:00.000Z')

    const hits = store.search('project comet SQLite', { now: new Date('2026-01-01T00:00:00.000Z') })
    expect(hits.map((hit) => hit.id)).toEqual([recent.id, old.id])
    expect(store.getMemory(old.id)).not.toBeNull()
    store.close()
  })

  it('permanently removes a memory when the user forgets it', () => {
    const { dir, store } = createStore()
    const memory = store.createMemory({ kind: 'fact', content: 'The permanent-delete marker is cobalt.' })

    store.removeMemory(memory.id, memory.revision)

    expect(store.getMemory(memory.id)).toBeNull()
    expect(store.listMemories()).toEqual([])
    expect(store.search('permanent delete marker', { includeArchived: true })).toEqual([])
    expect(store.stats().memories).toBe(0)
    store.close()

    const database = new DatabaseSync(join(dir, 'memoknow.sqlite3'))
    expect(database.prepare('SELECT COUNT(*) AS count FROM memories WHERE id = ?').get(memory.id))
      .toMatchObject({ count: 0 })
    database.close()
  })

  it('revision-fences permanent memory removal and rejects forgotten as a lifecycle state', () => {
    const { store } = createStore()
    const memory = store.createMemory({ kind: 'preference', content: 'The user prefers cobalt accents.' })

    expect(() => store.createMemory({ kind: 'fact', content: 'Do not retain this.', status: 'forgotten' })).toThrow(
      'reserved for automatic lifecycle maintenance',
    )
    expect(() => store.removeMemory(memory.id, memory.revision + 1)).toThrow(ConflictError)
    expect(store.getMemory(memory.id)).not.toBeNull()
    expect(() => store.updateMemory(memory.id, memory.revision, { status: 'forgotten' })).toThrow(
      'Permanently remove user-forgotten memories',
    )
    store.close()
  })
})

describe('MemoKnowStore knowledge', () => {
  it('snapshots, chunks, searches, and safely shares duplicate objects', () => {
    const { dir, store } = createStore()
    const first = store.importKnowledge({
      title: 'Local Architecture',
      mediaType: 'text/markdown',
      content: '# Storage\n\nMemoKnow stores metadata in SQLite and immutable originals on disk.',
      source: { kind: 'pasted' },
    })
    const second = store.importKnowledge({
      title: 'Architecture copy',
      mediaType: 'text/markdown',
      content: '# Storage\n\nMemoKnow stores metadata in SQLite and immutable originals on disk.',
      source: { kind: 'pasted' },
    })

    expect(first.sha256).toBe(second.sha256)
    expect(readFileSync(join(dir, first.objectPath), 'utf8')).toContain('immutable originals')
    expect(store.search('immutable originals')).toMatchObject([
      { domain: 'knowledge', documentId: first.id },
      { domain: 'knowledge', documentId: second.id },
    ])

    store.removeKnowledge(first.id, first.revision)
    expect(readFileSync(join(dir, second.objectPath), 'utf8')).toContain('immutable originals')
    store.close()
  })

  it('removes an unreferenced original and reopens a migrated store', () => {
    const { dir, store } = createStore()
    const document = store.importKnowledge({
      title: 'Disposable', mediaType: 'text/plain', content: 'Unique disposable source text.', source: { kind: 'pasted' },
    })
    const objectPath = join(dir, document.objectPath)
    store.removeKnowledge(document.id, document.revision)
    expect(existsSync(objectPath)).toBe(false)
    store.close()

    const reopened = new MemoKnowStore(dir)
    expect(reopened.stats()).toEqual({ memories: 0, knowledgeDocuments: 0, knowledgeChunks: 0 })
    reopened.close()
  })

  it('caps memory results without applying that preference to knowledge', () => {
    const { store } = createStore()
    for (let index = 0; index < 15; index += 1) {
      store.createMemory({ kind: 'fact', content: `sharedtoken memory ${index}` })
      store.importKnowledge({ title: `Document ${index}`, mediaType: 'text/plain', content: `sharedtoken knowledge ${index}` })
    }

    const hits = store.search('sharedtoken')
    expect(hits.filter((hit) => hit.domain === 'memory')).toHaveLength(12)
    expect(hits.filter((hit) => hit.domain === 'knowledge')).toHaveLength(15)
    store.close()
  })
})

describe('MemoKnowStore settings', () => {
  it('uses revision fencing and never stores a raw API key', () => {
    const { store } = createStore()
    const initial = store.getSettings()
    expect(initial.value).toMatchObject({
      setupComplete: false,
      embeddingMode: 'fts',
      localEmbeddingModel: 'Xenova/multilingual-e5-small',
      memoryHalfLifeDays: 180,
      maxMemoryResults: 12,
    })

    const changed = store.updateSettings(initial.revision, {
      setupComplete: true,
      embeddingMode: 'api',
      embeddingBaseUrl: 'https://example.test/v1',
      embeddingModel: 'example-embedding',
      embeddingApiKeyEnv: 'MY_EMBEDDING_KEY',
    })
    expect(changed.value).not.toHaveProperty('apiKey')
    expect(() => store.updateSettings(initial.revision, changed.value)).toThrow(ConflictError)
    store.close()
  })

  it('requires an endpoint and model for OpenAI-compatible retrieval', () => {
    const { store } = createStore()
    const settings = store.getSettings()
    expect(() => store.updateSettings(settings.revision, {
      ...settings.value, embeddingMode: 'api', embeddingBaseUrl: '', embeddingModel: '',
    })).toThrow('embeddingBaseUrl is required for API mode')
    store.close()
  })

  it('migrates maxSearchResults to the memory-only result limit', () => {
    const { dir, store } = createStore()
    store.close()
    const database = new DatabaseSync(join(dir, 'memoknow.sqlite3'))
    const legacy = {
      setupComplete: true, embeddingMode: 'fts', embeddingBaseUrl: '', embeddingModel: '',
      embeddingApiKeyEnv: 'MEMOKNOW_EMBEDDING_API_KEY', localEmbeddingModel: '',
      memoryHalfLifeDays: 90, maxSearchResults: 7,
    }
    database.prepare('UPDATE settings SET value_json = ? WHERE id = 1').run(JSON.stringify(legacy))
    database.close()

    const reopened = new MemoKnowStore(dir)
    expect(reopened.getSettings().value).toMatchObject({ memoryHalfLifeDays: 90, maxMemoryResults: 7 })
    expect(reopened.getSettings().value).not.toHaveProperty('maxSearchResults')
    reopened.close()
  })
})

describe('MemoKnowStore automatic memory capture', () => {
  it('captures turns idempotently and commits distilled memories with usage', () => {
    const { store } = createStore()
    const turns = [
      { turn: 1, endSeq: 7, userText: 'I prefer concise release notes.', assistantText: 'Understood.', explicit: false },
      { turn: 2, endSeq: 12, userText: 'Remember that Project Comet uses SQLite.', assistantText: 'I will.', explicit: true },
    ]

    store.captureMemoryTurns('session-1', 12, turns)
    store.captureMemoryTurns('session-1', 12, turns)
    expect(store.listPendingMemoryTurns('session-1')).toHaveLength(2)

    const committed = store.completeMemoryDistillation('session-1', 12, [
      { action: 'create', kind: 'preference', content: 'The user prefers concise release notes.', status: 'candidate', importance: 0.7, confidence: 0.8 },
      { action: 'create', kind: 'fact', content: 'Project Comet uses SQLite.', status: 'active', importance: 0.8, confidence: 1 },
    ], { inputTokens: 240, outputTokens: 60 }, new Date('2026-09-11T10:00:00Z'))

    expect(committed).toMatchObject({ created: 2, updated: 0, skipped: 0 })
    expect(store.listPendingMemoryTurns('session-1')).toEqual([])
    expect(store.getMemoryCaptureState('session-1')).toMatchObject({
      capturedThroughSeq: 12, processedThroughSeq: 12, pendingTurns: 0, lastError: null,
    })
    expect(store.getMemoryDistillationUsage('session-1', new Date('2026-09-11T20:00:00Z')))
      .toEqual({ sessionTokens: 300, dailyTokens: 300 })
    expect(store.listMemories({ limit: 10 }).map(({ status, source }) => ({ status, source }))).toEqual([
      { status: 'active', source: { kind: 'session-distilled', sessionId: 'session-1' } },
      { status: 'candidate', source: { kind: 'session-distilled', sessionId: 'session-1' } },
    ])
    store.close()
  })

  it('rolls back operations, usage, and checkpoints on a revision conflict', () => {
    const { store } = createStore()
    const existing = store.createMemory({ kind: 'fact', content: 'Project Comet uses JSON.' })
    store.captureMemoryTurns('session-2', 5, [
      { turn: 1, endSeq: 5, userText: 'Project Comet now uses SQLite.', assistantText: '', explicit: false },
    ])

    expect(() => store.completeMemoryDistillation('session-2', 5, [
      { action: 'create', kind: 'fact', content: 'This insert must roll back.', status: 'candidate', importance: 0.5, confidence: 0.6 },
      { action: 'update', id: existing.id, expectedRevision: existing.revision + 1, content: 'Project Comet uses SQLite.' },
    ], { inputTokens: 100, outputTokens: 20 }, new Date('2026-09-11T10:00:00Z'))).toThrow(ConflictError)

    expect(store.listMemories({ limit: 10 })).toHaveLength(1)
    expect(store.listPendingMemoryTurns('session-2')).toHaveLength(1)
    expect(store.getMemoryCaptureState('session-2')).toMatchObject({ processedThroughSeq: -1, pendingTurns: 1 })
    expect(store.getMemoryDistillationUsage('session-2', new Date('2026-09-11T20:00:00Z')))
      .toEqual({ sessionTokens: 0, dailyTokens: 0 })
    store.close()
  })
})
