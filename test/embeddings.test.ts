import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalCpuEmbeddingProvider, OpenAICompatibleEmbeddingProvider } from '../src/embeddings.js'

afterEach(() => vi.unstubAllGlobals())

describe('OpenAICompatibleEmbeddingProvider', () => {
  it('uses the OpenAI embeddings contract and restores response order', async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [
      { index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] },
    ] }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new OpenAICompatibleEmbeddingProvider(
      'http://127.0.0.1:11434/v1', 'qwen3-embedding:8b', 'development-key',
    )

    await expect(provider.embed(['first', 'second'])).resolves.toEqual([[1, 0], [0, 1]])
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:11434/v1/embeddings', expect.objectContaining({
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer development-key' },
    }))
  })
})

describe('LocalCpuEmbeddingProvider', () => {
  it('downloads lazily and applies the E5 query/document prefixes', async () => {
    const calls: string[][] = []
    const provider = new LocalCpuEmbeddingProvider('C:/memo-model-cache', {
      async load(options) {
        expect(options).toMatchObject({
          model: 'Xenova/multilingual-e5-small',
          revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78',
          dtype: 'int8',
        })
        return async (inputs) => {
          calls.push(inputs)
          return { data: new Float32Array(inputs.flatMap(() => [1, 0, 0, 0])), dims: [inputs.length, 4] }
        }
      },
    })

    expect(calls).toEqual([])
    await provider.prepare()
    await provider.embed(['Saturn'], undefined, 'document')
    await provider.embed(['ringed planet'], undefined, 'query')
    expect(calls).toEqual([['passage: MemoKnow readiness check'], ['passage: Saturn'], ['query: ringed planet']])
  })

  it('allows a failed first download to be retried', async () => {
    let attempts = 0
    const provider = new LocalCpuEmbeddingProvider('C:/memo-model-cache', {
      async load() {
        attempts += 1
        if (attempts === 1) throw new Error('temporary download failure')
        return async (inputs) => ({
          data: new Float32Array(inputs.flatMap(() => [1, 0, 0, 0])), dims: [inputs.length, 4],
        })
      },
    })

    await expect(provider.prepare()).rejects.toThrow('temporary download failure')
    await provider.prepare()
    expect(attempts).toBe(2)
  })
})
