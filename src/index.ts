import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ObjectValueSchemaSpec, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { MemoKnowApp } from './app.js'
import { handleNodeRequest } from './http.js'
import { DshMemoryDistiller, MemoryUpdateCoordinator, type MemoryUpdateAgent, type SessionEventLike } from './memory-update.js'
import { MemoKnowStore } from './store.js'
import type { MemoryKind, MemoryStatus } from './types.js'
import { parseManagedEmbeddingPolicy } from './managed-embedding.js'

export { MemoKnowApp } from './app.js'
export { chunkText } from './chunking.js'
export { extractDocument, mediaTypeForFileName, SUPPORTED_DOCUMENT_TYPES } from './document-extraction.js'
export {
  DEFAULT_LOCAL_EMBEDDING_MODEL,
  DEFAULT_LOCAL_EMBEDDING_REVISION,
  LocalCpuEmbeddingProvider,
  OpenAICompatibleEmbeddingProvider,
  type EmbeddingProvider,
} from './embeddings.js'
export { handleNodeRequest } from './http.js'
export { DshMemoryDistiller, MemoryUpdateCoordinator } from './memory-update.js'
export { ConflictError, MemoKnowStore, NotFoundError } from './store.js'
export * from './types.js'
export { ValidationError } from './validation.js'

export const name = 'dsh-memoknow'
export const Config = z.object({
  dataDir: z.string().default(''),
  embedding: z.object({
    source: z.union(['user', 'managed-api'] as const).default('user'),
    baseUrl: z.string().default(''),
    model: z.string().default(''),
    apiKeyEnv: z.string().default('MEMOKNOW_EMBEDDING_API_KEY'),
  }),
})

export interface Config {
  dataDir?: string
  embedding?:
    | { source?: 'user' }
    | { source: 'managed-api'; baseUrl: string; model: string; apiKeyEnv?: string }
}

const Settings = z.object({})

interface SettingsContext {
  settings: { register(namespace: string, schema: unknown): unknown }
}

interface ToolsContext {
  tools: { register(definition: unknown): () => void }
}

interface WebContext {
  webServer: {
    register(route: {
      kind: 'exact' | 'prefix'
      path: string
      handler: Parameters<typeof handleNodeRequest>[1] extends never ? never : (request: any, response: any) => Promise<void>
    }): () => void
  }
}

interface MemoryRuntimeContext {
  llm: { stream(options: Record<string, unknown>): AsyncIterable<unknown> }
  sessionQuery: {
    readSession(sessionId: string): Promise<{
      session: { origin?: string; delegationDepth?: number }
      events: SessionEventLike[]
    }>
  }
  on(name: 'agent/status', listener: (payload: { agent: MemoryUpdateAgent; status: string }) => void): () => void
  on(name: 'agent/disposed', listener: (payload: { agent: MemoryUpdateAgent }) => void): () => void
  effect(factory: () => (() => void | Promise<void>), label?: string): void
  logger: { warn(message: string, ...args: unknown[]): void }
}

export function apply(ctx: Context, config: Config = {}): void {
  const rootDir = resolveDataDir(config.dataDir)
  const managedEmbedding = parseManagedEmbeddingPolicy(config.embedding)
  const store = new MemoKnowStore(rootDir, managedEmbedding === undefined ? {} : { managedEmbedding })
  const app = new MemoKnowApp(store)
  ctx.effect(() => () => store.close(), 'dsh-memoknow: close local store')

  // The Plugins configuration tab only dispatches cards whose key matches a
  // live Host settings namespace. MemoKnow stores its own setup state locally,
  // so this empty namespace is the presence contract for its management card.
  ctx.inject(['settings'], (settingsContext) => {
    const target = settingsContext as unknown as SettingsContext
    target.settings.register('memoknow', Settings)
  })

  ctx.inject(['tools'], (toolsContext) => {
    const target = toolsContext as unknown as ToolsContext
    const disposers = toolDefinitions(store).map((tool) => target.tools.register(tool))
    toolsContext.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-memoknow: tools')
  })

  ctx.inject(['webServer'], (webContext) => {
    const target = webContext as unknown as WebContext
    const disposeManager = target.webServer.register({
      kind: 'exact',
      path: '/_dsh/memoknow',
      handler: (request, response) => handleNodeRequest(app, request, response),
    })
    const disposeApi = target.webServer.register({
      kind: 'prefix',
      path: '/_dsh/memoknow/api',
      handler: (request, response) => handleNodeRequest(app, request, response),
    })
    webContext.effect(() => () => { disposeApi(); disposeManager() }, 'dsh-memoknow: web routes')
  })

  ctx.inject(['agents', 'llm', 'sessionQuery'], (memoryContext) => {
    const target = memoryContext as unknown as MemoryRuntimeContext
    const coordinator = new MemoryUpdateCoordinator({
      store,
      sessionQuery: target.sessionQuery,
      distiller: new DshMemoryDistiller(target.llm),
      logger: target.logger,
    })
    target.on('agent/status', ({ agent, status }) => {
      if (status === 'idle') void coordinator.onAgentIdle(agent)
    })
    target.on('agent/disposed', ({ agent }) => coordinator.onAgentDisposed(agent.session.id))
    target.effect(() => () => coordinator.dispose(), 'dsh-memoknow: automatic memory updates')
  })

  ctx.logger.info('dsh-memoknow ready (dataDir=%s)', rootDir)
}

function resolveDataDir(configured: string | undefined): string {
  const value = configured?.trim()
  if (value !== undefined && value !== '') return isAbsolute(value) ? value : resolve(value)
  const harnessHome = process.env.DSH_HOME?.trim()
  return join(harnessHome && harnessHome !== '' ? harnessHome : join(homedir(), '.dsh'), 'memoknow')
}

function toolDefinitions(store: MemoKnowStore): unknown[] {
  const outputText = (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
  return [
    defineTool({
      name: 'memoknow_remember',
      description: 'Store one durable user fact, preference, decision, procedure, goal, relationship, or note in local personal memory. Do not store credentials or transient details.',
      parameters: {
        kind: { type: 'string', required: true, description: 'fact, preference, decision, relationship, procedure, goal, or note' },
        content: { type: 'string', required: true, description: 'One concise durable statement.' },
        importance: { type: 'number', description: 'Retrieval importance from 0 to 1.' },
        confidence: { type: 'number', description: 'Confidence from 0 to 1.' },
      },
      output: {
        schema: recordSchema({
          id: { type: 'string', required: true }, content: { type: 'string', required: true },
          status: { type: 'string', required: true }, revision: { type: 'number', required: true },
        }),
        render: outputText,
      },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        const memory = store.createMemory({
          kind: args.kind as MemoryKind,
          content: args.content,
          ...(args.importance === undefined ? {} : { importance: args.importance }),
          ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
          source: { kind: 'agent-written' },
        })
        return { id: memory.id, content: memory.content, status: memory.status, revision: memory.revision }
      },
    }),
    defineTool({
      name: 'memoknow_search',
      description: 'Search local personal memory and imported knowledge. Use this before answering when prior preferences, decisions, project facts, or user documents may matter.',
      parameters: {
        query: { type: 'string', required: true, description: 'Specific words or concepts to retrieve.' },
        limit: { type: 'number', description: 'Maximum results, from 1 to 100.' },
      },
      output: {
        schema: recordSchema({
          hits: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
            domain: { type: 'string', required: true }, id: { type: 'string', required: true },
            title: { type: 'string', required: true }, content: { type: 'string', required: true }, score: { type: 'number', required: true },
          } } },
        }),
        render: outputText,
      },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        const hits = (await store.searchHybrid(args.query, args.limit === undefined ? {} : { limit: Math.trunc(args.limit) }, exec.signal))
          .map((hit) => ({ domain: hit.domain, id: hit.id, title: hit.domain === 'knowledge' ? hit.title : hit.kind,
            content: hit.content, score: hit.score }))
        return { hits }
      },
    }),
    defineTool({
      name: 'memoknow_memory_list',
      description: 'List recently updated local memory records, including their ids, states, and revisions for management.',
      parameters: { limit: { type: 'number', description: 'Maximum records, from 1 to 500.' } },
      output: {
        schema: recordSchema({ memories: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
          id: { type: 'string', required: true }, kind: { type: 'string', required: true }, content: { type: 'string', required: true },
          status: { type: 'string', required: true }, revision: { type: 'number', required: true },
        } } } }), render: outputText,
      },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        return { memories: store.listMemories(args.limit === undefined ? {} : { limit: Math.trunc(args.limit) })
          .map(({ id, kind, content, status, revision }) => ({ id, kind, content, status, revision })) }
      },
    }),
    defineTool({
      name: 'memoknow_memory_update',
      description: 'Edit or change the lifecycle state of one local memory. Supply the revision returned by search or list to prevent lost updates.',
      parameters: {
        id: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true },
        content: { type: 'string' }, status: { type: 'string', description: 'candidate, active, stale, archived, superseded, or disputed' },
        importance: { type: 'number' }, confidence: { type: 'number' },
      },
      output: {
        schema: recordSchema({ id: { type: 'string', required: true }, content: { type: 'string', required: true },
          status: { type: 'string', required: true }, revision: { type: 'number', required: true } }), render: outputText,
      },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        const memory = store.updateMemory(args.id, Math.trunc(args.expectedRevision), {
          ...(args.content === undefined ? {} : { content: args.content }),
          ...(args.status === undefined ? {} : { status: args.status as MemoryStatus }),
          ...(args.importance === undefined ? {} : { importance: args.importance }),
          ...(args.confidence === undefined ? {} : { confidence: args.confidence }),
        })
        return { id: memory.id, content: memory.content, status: memory.status, revision: memory.revision }
      },
    }),
    defineTool({
      name: 'memoknow_memory_forget',
      description: 'Permanently delete one local memory at the user\'s request. No memory tombstone or recoverable copy is retained. The original DSH chat session is not deleted.',
      parameters: { id: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true } },
      output: { schema: recordSchema({ removed: { type: 'boolean', required: true } }), render: outputText },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        store.removeMemory(args.id, Math.trunc(args.expectedRevision))
        return { removed: true }
      },
    }),
    defineTool({
      name: 'memoknow_knowledge_import',
      description: 'Import user-provided plain text or Markdown as local knowledge. The exact original is stored once by content hash and a searchable chunk index is created.',
      parameters: {
        title: { type: 'string', required: true }, content: { type: 'string', required: true },
        mediaType: { type: 'string', description: 'text/plain or text/markdown; defaults to text/markdown.' },
        sourceUri: { type: 'string', description: 'Optional provenance label or path.' },
      },
      output: {
        schema: recordSchema({ id: { type: 'string', required: true }, title: { type: 'string', required: true },
          sha256: { type: 'string', required: true }, chunkCount: { type: 'number', required: true }, revision: { type: 'number', required: true } }),
        render: outputText,
      },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        const document = store.importKnowledge({ title: args.title, content: args.content,
          mediaType: args.mediaType === 'text/plain' ? 'text/plain' : 'text/markdown',
          source: args.sourceUri === undefined ? { kind: 'pasted' } : { kind: 'file', uri: args.sourceUri } })
        try { await store.indexKnowledge(document.id, exec.signal) } catch { /* FTS remains usable. */ }
        const indexed = store.getKnowledge(document.id)!
        return { id: indexed.id, title: indexed.title, sha256: indexed.sha256, chunkCount: indexed.chunkCount, revision: indexed.revision }
      },
    }),
    defineTool({
      name: 'memoknow_knowledge_remove',
      description: 'Remove one imported knowledge document and its search chunks. A shared content-addressed original is retained while another document references it.',
      parameters: { id: { type: 'string', required: true }, expectedRevision: { type: 'number', required: true } },
      output: { schema: recordSchema({ removed: { type: 'boolean', required: true } }), render: outputText },
      async execute(args, exec) {
        throwIfAborted(exec.signal)
        store.removeKnowledge(args.id, Math.trunc(args.expectedRevision))
        return { removed: true }
      },
    }),
  ]
}

function recordSchema<const P extends ParameterSchemaSpec>(properties: P): ObjectValueSchemaSpec & { properties: P } {
  return { type: 'object', additionalProperties: false, properties }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Operation aborted')
}
