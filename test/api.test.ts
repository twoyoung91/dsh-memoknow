import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoKnowApp } from '../src/app.js'
import { MemoKnowStore } from '../src/store.js'
import type { EmbeddingProvider } from '../src/embeddings.js'

const dirs: string[] = []

function createApp() {
  const dir = mkdtempSync(join(tmpdir(), 'memoknow-api-'))
  dirs.push(dir)
  const store = new MemoKnowStore(dir)
  return { app: new MemoKnowApp(store), store }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('MemoKnow JSON API', () => {
  it('returns dashboard state and creates a memory', async () => {
    const { app, store } = createApp()
    const dashboard = await app.handle(new Request('http://localhost/_dsh/memoknow/api/dashboard'))
    expect(dashboard.status).toBe(200)
    expect(await dashboard.json()).toMatchObject({ ok: true, value: { stats: { memories: 0 } } })

    const created = await app.handle(new Request('http://localhost/_dsh/memoknow/api/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fact', content: 'The local API works.' }),
    }))
    expect(created.status).toBe(201)
    expect(await created.json()).toMatchObject({ ok: true, value: { content: 'The local API works.' } })
    store.close()
  })

  it('reports stale writes as conflicts', async () => {
    const { app, store } = createApp()
    const memory = store.createMemory({ kind: 'fact', content: 'Version one.' })
    store.updateMemory(memory.id, memory.revision, { content: 'Version two.' })

    const response = await app.handle(new Request(`http://localhost/_dsh/memoknow/api/memories/${memory.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, content: 'Lost update.' }),
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'revision_conflict' } })
    store.close()
  })

  it('permanently deletes a user-forgotten memory', async () => {
    const { app, store } = createApp()
    const memory = store.createMemory({ kind: 'fact', content: 'The forget endpoint removes this row.' })

    const response = await app.handle(new Request(`http://localhost/_dsh/memoknow/api/memories/${memory.id}`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: memory.revision }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, value: { removed: true } })
    expect(store.getMemory(memory.id)).toBeNull()
    expect(store.search('forget endpoint', { includeArchived: true })).toEqual([])
    store.close()
  })

  it('rejects oversized bodies and unknown routes', async () => {
    const { app, store } = createApp()
    const oversized = await app.handle(new Request('http://localhost/_dsh/memoknow/api/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(1_100_000) }),
    }))
    expect(oversized.status).toBe(413)

    const unknown = await app.handle(new Request('http://localhost/_dsh/memoknow/api/nope'))
    expect(unknown.status).toBe(404)
    store.close()
  })

  it('rejects cross-origin mutations', async () => {
    const { app, store } = createApp()
    const response = await app.handle(new Request('http://localhost/_dsh/memoknow/api/memories', {
      method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'fact', content: 'Should not be written.' }),
    }))
    expect(response.status).toBe(403)
    expect(store.stats().memories).toBe(0)
    store.close()
  })

  it('imports a CSV file as an immutable searchable document', async () => {
    const { app, store } = createApp()
    const form = new FormData()
    form.set('title', 'People directory')
    form.set('file', new File(['name,role\nAda,Engineer\n'], 'people.csv', { type: 'text/csv' }))

    const response = await app.handle(new Request('http://localhost/_dsh/memoknow/api/knowledge/file', {
      method: 'POST', body: form,
    }))

    expect(response.status).toBe(201)
    expect(await response.json()).toMatchObject({ ok: true, value: { title: 'People directory', mediaType: 'text/csv' } })
    expect(store.search('Engineer')).toMatchObject([{ domain: 'knowledge', title: 'People directory' }])
    store.close()
  })

  it('rejects unsupported file extensions', async () => {
    const { app, store } = createApp()
    const form = new FormData()
    form.set('file', new File(['hello'], 'archive.zip', { type: 'application/zip' }))
    const response = await app.handle(new Request('http://localhost/_dsh/memoknow/api/knowledge/file', {
      method: 'POST', body: form,
    }))
    expect(response.status).toBe(400)
    store.close()
  })

  it('successfully activates all three retrieval modes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-api-modes-'))
    dirs.push(dir)
    const prepared: string[] = []
    const providerFactory = (settings: { embeddingMode: string }): EmbeddingProvider | null => {
      if (settings.embeddingMode === 'fts') return null
      return {
        id: settings.embeddingMode, model: 'test-model',
        async prepare() { prepared.push(settings.embeddingMode) },
        async embed(inputs) { return inputs.map(() => [1, 0, 0, 0]) },
      }
    }
    const store = new MemoKnowStore(dir, { embeddingProviderFactory: providerFactory })
    const app = new MemoKnowApp(store)

    for (const embeddingMode of ['local-cpu', 'api', 'fts'] as const) {
      const current = store.getSettings()
      const response = await app.handle(new Request('http://localhost/_dsh/memoknow/api/settings', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ expectedRevision: current.revision, value: {
          ...current.value, embeddingMode,
          embeddingBaseUrl: 'https://example.test/v1', embeddingModel: 'test-model',
        } }),
      }))
      expect(response.status).toBe(200)
      expect(store.getSettings().value.embeddingMode).toBe(embeddingMode)
    }
    expect(prepared).toEqual(['local-cpu', 'api'])
    store.close()
  })

  it('keeps the previous mode when provider validation fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-api-mode-failure-'))
    dirs.push(dir)
    const store = new MemoKnowStore(dir, { embeddingProviderFactory: (settings) => settings.embeddingMode === 'fts' ? null : ({
      id: 'broken', model: 'broken', async embed() { throw new Error('connection refused') },
    }) })
    const app = new MemoKnowApp(store)
    const current = store.getSettings()
    const response = await app.handle(new Request('http://localhost/_dsh/memoknow/api/settings', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: current.revision, value: {
        ...current.value, embeddingMode: 'api', embeddingBaseUrl: 'https://example.test/v1', embeddingModel: 'broken',
      } }),
    }))

    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'embedding_setup_failed' } })
    expect(store.getSettings().value.embeddingMode).toBe('fts')
    store.close()
  })
})
