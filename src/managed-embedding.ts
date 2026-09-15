import type { ManagedApiEmbeddingPolicy } from './types.js'
import { enumValue, requireRecord, requireString, ValidationError } from './validation.js'

/** 将 Host 配置收窄为经过边界校验的托管 embedding 策略。 */
export function parseManagedEmbeddingPolicy(input: unknown): ManagedApiEmbeddingPolicy | undefined {
  if (input === undefined) return undefined
  const record = requireRecord(input, 'embedding configuration')
  const source = enumValue(record.source, 'embedding source', ['user', 'managed-api'] as const, 'user')
  if (source === 'user') return undefined

  const baseUrl = requireString(record.baseUrl, 'managed embedding baseUrl', 2_048)
  let url: URL
  try { url = new URL(baseUrl) } catch { throw new ValidationError('managed embedding baseUrl must be an absolute URL') }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new ValidationError('managed embedding baseUrl must use HTTPS unless it targets loopback')
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    throw new ValidationError('managed embedding baseUrl must not contain credentials, query, or fragment')
  }
  const model = requireString(record.model, 'managed embedding model', 500)
  const apiKeyEnv = record.apiKeyEnv === undefined
    ? 'MEMOKNOW_EMBEDDING_API_KEY'
    : requireString(record.apiKeyEnv, 'managed embedding apiKeyEnv', 200)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(apiKeyEnv)) {
    throw new ValidationError('managed embedding apiKeyEnv must be an environment variable name')
  }
  return Object.freeze({ baseUrl, model, apiKeyEnv })
}
