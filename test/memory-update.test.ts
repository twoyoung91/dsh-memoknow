import { describe, expect, it } from 'vitest'
import {
  DshMemoryDistiller,
  extractEligibleTurns,
  parseDistillationOperations,
  selectRelatedMemories,
  type DistillationMemoryContext,
} from '../src/memory-update.js'
import type { MemoryRecord } from '../src/types.js'

function event(type: string, seq: number, data: unknown) {
  return { type, seq, time: 1_000 + seq, data }
}

describe('automatic memory turn extraction', () => {
  it('keeps completed direct-user text and ignores plugin context, noise, and failed turns', () => {
    const extracted = extractEligibleTurns([
      event('turn/start', 0, { turn: 1 }),
      event('user/message', 1, { role: 'user', source: { kind: 'plugin', plugin: 'context' }, content: [{ type: 'text', text: 'Synthetic context' }] }),
      event('user/message', 2, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Thanks!' }] }),
      event('assistant/message', 3, { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'You are welcome.' }] } }),
      event('turn/end', 4, { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', 5, { turn: 2 }),
      event('user/message', 6, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'I prefer release notes with short bullet points.' }] }),
      event('assistant/message', 7, { turn: 2, step: 1, message: { content: [{ type: 'reasoning', text: 'hidden' }, { type: 'text', text: 'I will keep them concise.' }] } }),
      event('turn/end', 8, { turn: 2, reason: { kind: 'completed' } }),
      event('turn/start', 9, { turn: 3 }),
      event('user/message', 10, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'My editor is Vim.' }] }),
      event('turn/end', 11, { turn: 3, reason: { kind: 'error' } }),
    ], -1)

    expect(extracted.capturedThroughSeq).toBe(11)
    expect(extracted.turns).toEqual([{
      turn: 2,
      endSeq: 8,
      userText: 'I prefer release notes with short bullet points.',
      assistantText: 'I will keep them concise.',
      explicit: false,
    }])
  })

  it('recognizes explicit memory requests and rejects credential-like turns', () => {
    const extracted = extractEligibleTurns([
      event('turn/start', 0, { turn: 1 }),
      event('user/message', 1, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Remember that my preferred editor is Vim.' }] }),
      event('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
      event('turn/start', 3, { turn: 2 }),
      event('user/message', 4, { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'My API key is sk-abcdefghijklmnopqrstuvwxyz1234' }] }),
      event('turn/end', 5, { turn: 2, reason: { kind: 'completed' } }),
    ], -1)

    expect(extracted.turns).toHaveLength(1)
    expect(extracted.turns[0]).toMatchObject({ turn: 1, explicit: true })
  })
})

describe('automatic memory operation validation', () => {
  const existing: DistillationMemoryContext[] = [{
    id: 'memory-1', revision: 3, kind: 'fact', status: 'active',
    content: 'Project Comet uses JSON.', importance: 0.6, confidence: 0.8,
  }]

  it('activates only creations backed by an explicit source turn', () => {
    const operations = parseDistillationOperations(JSON.stringify({ operations: [
      { action: 'create', kind: 'preference', content: 'The user prefers Vim.', importance: 0.8, confidence: 0.95, evidenceTurns: [1] },
      { action: 'create', kind: 'fact', content: 'Project Comet uses SQLite.', importance: 0.7, confidence: 0.75, evidenceTurns: [2] },
    ] }), existing, new Set([1]), new Set([1, 2]))

    expect(operations).toMatchObject([
      { action: 'create', status: 'active' },
      { action: 'create', status: 'candidate' },
    ])
  })

  it('rejects updates outside the supplied id/revision boundary and secret-like output', () => {
    expect(() => parseDistillationOperations(JSON.stringify({ operations: [{
      action: 'update', id: 'memory-1', expectedRevision: 2,
      content: 'Project Comet uses SQLite.', evidenceTurns: [2],
    }] }), existing, new Set(), new Set([2]))).toThrow('not an allowed memory revision')

    expect(() => parseDistillationOperations(JSON.stringify({ operations: [{
      action: 'create', kind: 'note', content: 'API key: sk-abcdefghijklmnopqrstuvwxyz1234',
      importance: 0.5, confidence: 0.5, evidenceTurns: [2],
    }] }), existing, new Set(), new Set([2]))).toThrow('secret-like')
  })
})

describe('related memory selection', () => {
  it('returns a bounded overlap-ranked context and excludes forgotten records', () => {
    const base = {
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      lastConfirmedAt: null, expiresAt: null, revision: 1, importance: 0.5, confidence: 1,
      source: { kind: 'agent-written' as const },
    }
    const records: MemoryRecord[] = [
      { ...base, id: '1', kind: 'fact', status: 'active', content: 'Project Comet uses JSON.' },
      { ...base, id: '2', kind: 'preference', status: 'active', content: 'The user likes concise answers.' },
      { ...base, id: '3', kind: 'fact', status: 'forgotten', content: 'Project Comet is secret.' },
    ]

    expect(selectRelatedMemories(records, 'Project Comet now uses SQLite.', 1)).toMatchObject([
      { id: '1', content: 'Project Comet uses JSON.' },
    ])
  })
})

describe('DSH memory distiller', () => {
  it('uses a bounded tool-free request and validates the structured result', async () => {
    let request: Record<string, unknown> | undefined
    const llm = {
      async *stream(options: Record<string, unknown>) {
        request = options
        yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify({ operations: [{
          action: 'create', kind: 'preference', content: 'The user prefers Vim.',
          importance: 0.8, confidence: 0.95, evidenceTurns: [1],
        }] }) } }
        yield { type: 'usage', usage: { inputTokens: 120, outputTokens: 30 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    }
    const distiller = new DshMemoryDistiller(llm)

    const result = await distiller.distill({
      sessionId: 'session-1', route: { provider: 'configured', model: 'economical' },
      turns: [{ turn: 1, endSeq: 4, userText: 'Remember that I prefer Vim.', assistantText: 'Understood.', explicit: true }],
      existing: [],
    })

    expect(result.operations).toMatchObject([{ action: 'create', status: 'active' }])
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
    expect(request).toMatchObject({ provider: 'configured', model: 'economical', maxTokens: 700, sessionId: 'session-1' })
    expect(request).not.toHaveProperty('tools')
    expect(String(request?.system)).toContain('untrusted conversation data')
  })

  it('rejects truncated or non-text model output', async () => {
    const llm = {
      async *stream() {
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'x', arguments: '{}' } }
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      },
    }
    await expect(new DshMemoryDistiller(llm).distill({
      sessionId: 'session-1', route: { provider: 'configured', model: 'economical' },
      turns: [{ turn: 1, endSeq: 4, userText: 'I prefer Vim.', assistantText: '', explicit: false }],
      existing: [],
    })).rejects.toThrow()
  })
})
