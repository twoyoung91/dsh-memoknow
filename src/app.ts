import { ConflictError, EmbeddingSetupError, MemoKnowStore, NotFoundError } from './store.js'
import { extractDocument, mediaTypeForFileName } from './document-extraction.js'
import type { KnowledgeSource, MemoryKind, MemorySource, MemoryStatus } from './types.js'
import { requireRecord, ValidationError } from './validation.js'

const API_PREFIX = '/_dsh/memoknow/api'
const MAX_JSON_BYTES = 1024 * 1024

export class MemoKnowApp {
  constructor(readonly store: MemoKnowStore) {}

  async handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (!url.pathname.startsWith(API_PREFIX)) return failure(404, 'not_found', 'Route not found')
      if (isMutation(request.method)) ensureSameOrigin(request, url)
      const path = url.pathname.slice(API_PREFIX.length) || '/'

      if (path === '/dashboard' && request.method === 'GET') {
        return success({ stats: this.store.stats(), settings: this.store.getSettings() })
      }
      if (path === '/search' && request.method === 'GET') {
        const limit = parseInteger(url.searchParams.get('limit'), undefined)
        return success(await this.store.searchHybrid(url.searchParams.get('q') ?? '', {
          ...(limit === undefined ? {} : { limit }), includeArchived: url.searchParams.get('includeArchived') === 'true',
        }))
      }
      if (path === '/memories' && request.method === 'GET') {
        const status = url.searchParams.get('status') ?? undefined
        const limit = parseInteger(url.searchParams.get('limit'), 100)
        const offset = parseInteger(url.searchParams.get('offset'), 0)
        return success(this.store.listMemories({
          ...(status === undefined ? {} : { status: status as MemoryStatus }),
          ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }),
        }))
      }
      if (path === '/memories' && request.method === 'POST') {
        const body = await readJson(request)
        return success(this.store.createMemory({
          kind: body.kind as MemoryKind,
          content: String(body.content ?? ''),
          ...(body.status === undefined ? {} : { status: body.status as MemoryStatus }),
          ...(body.importance === undefined ? {} : { importance: Number(body.importance) }),
          ...(body.confidence === undefined ? {} : { confidence: Number(body.confidence) }),
          ...(body.source === undefined ? {} : { source: body.source as MemorySource }),
          ...(body.expiresAt === undefined ? {} : { expiresAt: body.expiresAt as string | null }),
        }), 201)
      }
      const memoryMatch = path.match(/^\/memories\/([0-9a-f-]+)$/i)
      if (memoryMatch !== null && request.method === 'GET') {
        const memory = this.store.getMemory(memoryMatch[1]!)
        if (memory === null) throw new NotFoundError('Memory not found')
        return success(memory)
      }
      if (memoryMatch !== null && request.method === 'PATCH') {
        const body = await readJson(request)
        const expectedRevision = requireRevision(body.expectedRevision)
        const { expectedRevision: _ignored, ...changes } = body
        return success(this.store.updateMemory(memoryMatch[1]!, expectedRevision, changes))
      }
      if (memoryMatch !== null && request.method === 'DELETE') {
        const body = await readJson(request)
        this.store.removeMemory(memoryMatch[1]!, requireRevision(body.expectedRevision))
        return success({ removed: true })
      }

      if (path === '/knowledge' && request.method === 'GET') {
        const limit = parseInteger(url.searchParams.get('limit'), 100)
        const offset = parseInteger(url.searchParams.get('offset'), 0)
        return success(this.store.listKnowledge({
          ...(limit === undefined ? {} : { limit }), ...(offset === undefined ? {} : { offset }),
        }))
      }
      if (path === '/knowledge' && request.method === 'POST') {
        const body = await readJson(request)
        const document = this.store.importKnowledge({
          title: String(body.title ?? ''),
          mediaType: body.mediaType as 'text/plain' | 'text/markdown',
          content: String(body.content ?? ''),
          ...(body.source === undefined ? {} : { source: body.source as KnowledgeSource }),
        })
        await indexWithoutLosingImport(this.store, document.id)
        return success(this.store.getKnowledge(document.id), 201)
      }
      if (path === '/knowledge/file' && request.method === 'POST') {
        if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
          throw new ValidationError('File import requires multipart form data')
        }
        const form = await request.formData()
        const value = form.get('file')
        if (!(value instanceof File)) throw new ValidationError('A document file is required')
        if (value.size > 25 * 1024 * 1024) throw new PayloadTooLargeError('Document exceeds 25 MiB')
        const bytes = Buffer.from(await value.arrayBuffer())
        const mediaType = mediaTypeForFileName(value.name)
        const extracted = await extractDocument({ fileName: value.name, mediaType, bytes })
        const requestedTitle = form.get('title')
        const title = typeof requestedTitle === 'string' && requestedTitle.trim() !== '' ? requestedTitle : value.name
        const document = this.store.importKnowledge({
          title, mediaType, content: extracted.text, originalBytes: bytes,
          source: { kind: 'file', uri: value.name },
        })
        await indexWithoutLosingImport(this.store, document.id)
        return success(this.store.getKnowledge(document.id), 201)
      }
      const knowledgeMatch = path.match(/^\/knowledge\/([0-9a-f-]+)$/i)
      if (knowledgeMatch !== null && request.method === 'GET') {
        const document = this.store.getKnowledge(knowledgeMatch[1]!)
        if (document === null) throw new NotFoundError('Knowledge document not found')
        return success(document)
      }
      if (knowledgeMatch !== null && request.method === 'DELETE') {
        const body = await readJson(request)
        this.store.removeKnowledge(knowledgeMatch[1]!, requireRevision(body.expectedRevision))
        return success({ removed: true })
      }

      if (path === '/settings' && request.method === 'GET') return success(this.store.getSettings())
      if (path === '/settings' && request.method === 'PATCH') {
        const body = await readJson(request)
        return success(await this.store.activateSettings(requireRevision(body.expectedRevision), body.value, request.signal))
      }
      return failure(404, 'not_found', 'Route not found')
    } catch (error) {
      if (error instanceof PayloadTooLargeError) return failure(413, error.code, error.message)
      if (error instanceof ConflictError) return failure(409, error.code, error.message)
      if (error instanceof NotFoundError) return failure(404, error.code, error.message)
      if (error instanceof EmbeddingSetupError) return failure(502, error.code, error.message)
      if (error instanceof ValidationError || error instanceof SyntaxError) {
        return failure(400, 'validation_error', error.message)
      }
      if (error instanceof CrossOriginError) return failure(403, error.code, error.message)
      return failure(500, 'internal_error', 'MemoKnow could not complete the request')
    }
  }
}

async function indexWithoutLosingImport(store: MemoKnowStore, documentId: string): Promise<void> {
  try { await store.indexKnowledge(documentId) } catch { /* FTS remains available and status records the failure. */ }
}

class PayloadTooLargeError extends Error { readonly code = 'payload_too_large' }
class CrossOriginError extends Error { readonly code = 'cross_origin_denied' }

function success(value: unknown, status = 200): Response {
  return Response.json({ ok: true, value }, { status, headers: { 'cache-control': 'no-store' } })
}

function failure(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, { status, headers: { 'cache-control': 'no-store' } })
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > MAX_JSON_BYTES) throw new PayloadTooLargeError('JSON body exceeds 1 MiB')
  const text = await request.text()
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) throw new PayloadTooLargeError('JSON body exceeds 1 MiB')
  if (text.length === 0) throw new ValidationError('JSON body is required')
  return requireRecord(JSON.parse(text), 'body')
}

function requireRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1) throw new ValidationError('expectedRevision must be a positive integer')
  return Number(value)
}

function parseInteger(value: string | null, fallback: number | undefined): number | undefined {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new ValidationError('query parameter must be an integer')
  return parsed
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function ensureSameOrigin(request: Request, url: URL): void {
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new CrossOriginError('Cross-site mutations are not allowed')
  const origin = request.headers.get('origin')
  if (origin !== null && origin !== url.origin) throw new CrossOriginError('Cross-origin mutations are not allowed')
}
