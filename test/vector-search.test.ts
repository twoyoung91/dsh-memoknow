import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import type { EmbeddingProvider } from '../src/embeddings.js'
import { MemoKnowStore } from '../src/store.js'

const dirs: string[] = []

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake'
  readonly model = 'test-embedding'

  async embed(inputs: string[]): Promise<number[][]> {
    return inputs.map((input) => input.includes('Saturn') || input.includes('ringed planet')
      ? [1, 0, 0, 0]
      : [0, 1, 0, 0])
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('MemoKnow vector search', () => {
  it('indexes chunks in sqlite-vec and retrieves semantic matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-vector-'))
    dirs.push(dir)
    const store = new MemoKnowStore(dir, { embeddingProvider: new FakeEmbeddingProvider() })
    const settings = store.getSettings()
    store.updateSettings(settings.revision, { ...settings.value,
      embeddingMode: 'api',
      embeddingBaseUrl: 'http://127.0.0.1:11434/v1',
      embeddingModel: 'test-embedding',
    })
    const document = store.importKnowledge({
      title: 'Astronomy notes',
      mediaType: 'text/plain',
      content: 'Saturn has a prominent system of icy rings.',
    })

    await store.indexKnowledge(document.id)
    const hits = await store.searchHybrid('ringed planet')

    expect(hits[0]).toMatchObject({ domain: 'knowledge', documentId: document.id })
    expect(store.getKnowledge(document.id)).toMatchObject({ embeddingStatus: 'ready' })
    store.close()
  })

  it('keeps FTS usable when the embedding provider fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-vector-failure-'))
    dirs.push(dir)
    const provider: EmbeddingProvider = {
      id: 'broken', model: 'broken',
      async embed() { throw new Error('provider unavailable') },
    }
    const store = new MemoKnowStore(dir, { embeddingProvider: provider })
    const settings = store.getSettings()
    store.updateSettings(settings.revision, { ...settings.value, embeddingMode: 'api' })
    const document = store.importKnowledge({
      title: 'Fallback', mediaType: 'text/plain', content: 'FTS remains available during outages.',
    })

    await expect(store.indexKnowledge(document.id)).rejects.toThrow('provider unavailable')
    expect(store.search('outages')).toHaveLength(1)
    expect(store.getKnowledge(document.id)).toMatchObject({ embeddingStatus: 'failed' })
    store.close()
  })

  it('keeps separate vector tables for different same-dimension models', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-vector-generations-'))
    dirs.push(dir)
    for (const model of ['model-a', 'model-b']) {
      const provider: EmbeddingProvider = {
        id: 'fake', model,
        async embed(inputs) { return inputs.map(() => [1, 0, 0, 0]) },
      }
      const store = new MemoKnowStore(dir, { embeddingProvider: provider })
      const settings = store.getSettings()
      store.updateSettings(settings.revision, { ...settings.value, embeddingMode: 'api' })
      const document = store.importKnowledge({
        title: model, mediaType: 'text/plain', content: `Content indexed by ${model}.`,
      })
      await store.indexKnowledge(document.id)
      store.close()
    }

    const database = new DatabaseSync(join(dir, 'memoknow.sqlite3'))
    const generations = database.prepare('SELECT vector_table FROM embedding_generations ORDER BY model').all()
    database.close()
    expect(generations).toHaveLength(2)
    expect(new Set(generations.map((row) => row.vector_table)).size).toBe(2)
  })
})
