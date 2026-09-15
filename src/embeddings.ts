import { ValidationError } from './validation.js'

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small'
export const DEFAULT_LOCAL_EMBEDDING_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
export type EmbeddingPurpose = 'document' | 'query'

export interface EmbeddingProvider {
  readonly id: string
  readonly model: string
  prepare?(): Promise<void>
  embed(inputs: string[], signal?: AbortSignal, purpose?: EmbeddingPurpose): Promise<number[][]>
}

export class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly id: string
  readonly model: string
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(baseUrl: string, model: string, apiKey = '') {
    const url = new URL(baseUrl)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname))) {
      throw new ValidationError('Embedding API URL must use HTTPS unless it targets loopback')
    }
    if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      throw new ValidationError('Embedding API URL must not contain credentials, a query, or a fragment')
    }
    const normalizedBase = url.toString().replace(/\/$/, '')
    this.endpoint = `${normalizedBase}/embeddings`
    this.id = `openai-compatible:${url.origin}${url.pathname.replace(/\/$/, '')}`
    this.model = model.trim()
    this.apiKey = apiKey.trim()
    if (this.model === '') throw new ValidationError('An embedding model is required')
  }

  async embed(inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    if (inputs.length === 0) return []
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey === '' ? {} : { authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({ model: this.model, input: inputs, encoding_format: 'float' }),
      ...(signal === undefined ? {} : { signal }),
    })
    if (!response.ok) throw new Error(`Embedding API request failed (${response.status})`)
    const body = await response.json() as { data?: unknown }
    if (!Array.isArray(body.data) || body.data.length !== inputs.length) {
      throw new Error('Embedding API returned an invalid result count')
    }
    const vectors: number[][] = new Array(inputs.length)
    for (const value of body.data) {
      if (value === null || typeof value !== 'object') throw new Error('Embedding API returned an invalid result')
      const item = value as { index?: unknown; embedding?: unknown }
      if (!Number.isInteger(item.index) || Number(item.index) < 0 || Number(item.index) >= inputs.length
        || vectors[Number(item.index)] !== undefined) throw new Error('Embedding API returned an invalid result index')
      vectors[Number(item.index)] = validateVector(item.embedding)
    }
    const dimensions = vectors[0]?.length ?? 0
    if (dimensions === 0 || vectors.some((vector) => vector === undefined || vector.length !== dimensions)) {
      throw new Error('Embedding API returned inconsistent embedding dimensions')
    }
    return vectors
  }
}

interface FeatureTensor {
  data: ArrayLike<number>
  dims: number[]
}

type FeatureExtractor = (inputs: string[], options?: { pooling: 'mean'; normalize: true }) => Promise<FeatureTensor>

export interface LocalCpuPipelineLoader {
  load(options: { model: string; revision: string; cacheDir: string; dtype: 'int8' }): Promise<FeatureExtractor>
}

const transformersLoader: LocalCpuPipelineLoader = {
  async load(options) {
    const { env, pipeline } = await import('@huggingface/transformers')
    env.cacheDir = options.cacheDir
    const extractor = await pipeline('feature-extraction', options.model, {
      dtype: options.dtype,
      revision: options.revision,
    })
    return async (inputs, runOptions) => extractor(inputs, runOptions) as Promise<FeatureTensor>
  },
}

export class LocalCpuEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-cpu:transformers-js:int8'
  readonly model = `${DEFAULT_LOCAL_EMBEDDING_MODEL}@${DEFAULT_LOCAL_EMBEDDING_REVISION}:int8`
  private extractorPromise: Promise<FeatureExtractor> | null = null
  private preparationPromise: Promise<void> | null = null

  constructor(private readonly cacheDir: string, private readonly loader: LocalCpuPipelineLoader = transformersLoader) {}

  prepare(): Promise<void> {
    if (this.preparationPromise === null) {
      const attempt = this.loadAndProbe()
      this.preparationPromise = attempt
      void attempt.catch(() => {
        if (this.preparationPromise === attempt) this.preparationPromise = null
        this.extractorPromise = null
      })
    }
    return this.preparationPromise
  }

  async embed(inputs: string[], signal?: AbortSignal, purpose: EmbeddingPurpose = 'document'): Promise<number[][]> {
    if (inputs.length === 0) return []
    throwIfAborted(signal)
    const extractor = await this.extractor()
    throwIfAborted(signal)
    const prefix = purpose === 'query' ? 'query: ' : 'passage: '
    const tensor = await extractor(inputs.map((input) => `${prefix}${input}`), { pooling: 'mean', normalize: true })
    throwIfAborted(signal)
    return tensorToVectors(tensor, inputs.length)
  }

  private extractor(): Promise<FeatureExtractor> {
    this.extractorPromise ??= this.loader.load({
      model: DEFAULT_LOCAL_EMBEDDING_MODEL,
      revision: DEFAULT_LOCAL_EMBEDDING_REVISION,
      cacheDir: this.cacheDir,
      dtype: 'int8',
    })
    return this.extractorPromise
  }

  private async loadAndProbe(): Promise<void> {
    await this.embed(['MemoKnow readiness check'], undefined, 'document')
  }
}

function tensorToVectors(tensor: FeatureTensor, count: number): number[][] {
  const dimensions = tensor.dims.length === 2 && tensor.dims[0] === count ? tensor.dims[1] ?? 0 : 0
  if (!Number.isInteger(dimensions) || dimensions < 1 || tensor.data.length !== count * dimensions) {
    throw new Error('Local embedding model returned an invalid tensor shape')
  }
  const vectors: number[][] = []
  for (let row = 0; row < count; row += 1) {
    const vector = Array.from({ length: dimensions }, (_, column) => Number(tensor.data[row * dimensions + column]))
    if (vector.some((value) => !Number.isFinite(value))) throw new Error('Local embedding model returned invalid values')
    vectors.push(vector)
  }
  return vectors
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason instanceof Error ? signal.reason : new Error('Embedding cancelled')
}

function validateVector(value: unknown): number[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'number' || !Number.isFinite(item))) {
    throw new Error('Embedding API returned an invalid embedding vector')
  }
  return value as number[]
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
}
