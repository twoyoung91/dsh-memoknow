import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryUpdateCoordinator, type MemoryDistillationRequest } from '../src/memory-update.js'
import { MemoKnowStore } from '../src/store.js'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function store(): MemoKnowStore {
  const directory = mkdtempSync(join(tmpdir(), 'memoknow-coordinator-'))
  directories.push(directory)
  return new MemoKnowStore(directory)
}

function events(texts: string[]) {
  return texts.flatMap((text, index) => {
    const turn = index + 1
    const seq = index * 3
    return [
      { type: 'turn/start', seq, time: seq, data: { turn } },
      { type: 'user/message', seq: seq + 1, time: seq + 1,
        data: { source: { kind: 'user' }, content: [{ type: 'text', text }] } },
      { type: 'turn/end', seq: seq + 2, time: seq + 2, data: { turn, reason: { kind: 'completed' } } },
    ]
  })
}

function agent(id = 'session-1') {
  return {
    session: {
      id,
      firstLiveSeq: 0,
      requestHeader: () => ({ config: { provider: 'configured', model: 'economical' } }),
    },
    options: {},
  }
}

describe('memory update coordinator', () => {
  it('preserves completed turns when unrelated controls change while the session is read', async () => {
    const database = store()
    const coordinator = new MemoryUpdateCoordinator({ store: database,
      sessionQuery: { async readSession() {
        const controls = database.getLearningControls()
        database.updateLearningControls(controls.revision, { ...controls.value, maxDailyTokens: 0, excludedSessionIds: ['other-session'] })
        return { session: {}, events: events(['Please remember cobalt.']) }
      } },
      distiller: { async distill() { throw new Error('Budget is zero') } },
    })
    await coordinator.onAgentIdle(agent())
    expect(database.listPendingMemoryTurns('session-1')).toMatchObject([{ userText: 'Please remember cobalt.' }])
    await coordinator.dispose()
    database.close()
  })

  it('does not backfill turns from a pause window even if no idle event ran during the pause', async () => {
    const database = store()
    let controls = database.getLearningControls()
    controls = database.updateLearningControls(controls.revision, { ...controls.value, paused: true }, new Date(1000))
    database.updateLearningControls(controls.revision, { ...controls.value, paused: false }, new Date(2000))
    let calls = 0
    const coordinator = new MemoryUpdateCoordinator({ store: database,
      sessionQuery: { async readSession() { return { session: {}, events: events(['Please remember cobalt.']).map(event=>({...event,time:1500+event.seq})) } } },
      distiller: { async distill() { calls++;return { operations: [], usage: { inputTokens: 1, outputTokens: 1 } } } },
    })
    await coordinator.onAgentIdle(agent())
    expect(database.getMemoryCaptureState('session-1')).toMatchObject({ capturedThroughSeq: 2, pendingTurns: 0 })
    expect(calls).toBe(0)
    await coordinator.dispose()
    database.close()
  })
  it('skips paused turns permanently and reads changed budgets without a restart', async () => {
    const database = store()
    const texts = ['Please remember my private cobalt preference.']
    let snapshot = events(texts).map((event) => ({ ...event, time: Date.now() + event.seq }))
    let calls = 0
    const coordinator = new MemoryUpdateCoordinator({ store: database,
      sessionQuery: { async readSession() { return { session: {}, events: snapshot } } },
      distiller: { async distill() { calls++; return { operations: [], usage: { inputTokens: 1, outputTokens: 1 } } } },
    })
    let controls = database.getLearningControls()
    controls = database.updateLearningControls(controls.revision, { ...controls.value, paused: true })
    await coordinator.onAgentIdle(agent())
    expect(database.listPendingMemoryTurns('session-1')).toEqual([])
    expect(calls).toBe(0)
    controls = database.updateLearningControls(controls.revision, { ...controls.value, paused: false, maxDailyTokens: 0 })
    snapshot = events([...texts, 'Please remember my public amber preference.']).map((event) => ({ ...event, time: Date.now() + 100 + event.seq }))
    await coordinator.onAgentIdle(agent())
    expect(database.listPendingMemoryTurns('session-1')).toMatchObject([{ turn: 2 }])
    expect(calls).toBe(0)
    database.updateLearningControls(controls.revision, { ...controls.value, maxDailyTokens: 30000 })
    await coordinator.whenIdle('session-1')
    expect(calls).toBe(1)
    await coordinator.dispose()
    database.close()
  })

  it('discards an in-flight result when a session is excluded', async () => {
    const database = store()
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    const coordinator = new MemoryUpdateCoordinator({ store: database,
      sessionQuery: { async readSession() { return { session: {}, events: events(['Please remember cobalt.']) } } },
      distiller: { async distill() {
        started()
        await new Promise<void>((resolve) => { release = resolve })
        return { operations: [{ action: 'create' as const, kind: 'fact' as const, content: 'Cobalt', status: 'active' as const,
          importance: 1, confidence: 1 }], usage: { inputTokens: 1, outputTokens: 1 } }
      } },
    })
    const work = coordinator.onAgentIdle(agent())
    await ready
    const controls = database.getLearningControls()
    database.updateLearningControls(controls.revision, { ...controls.value, excludedSessionIds: ['session-1'] })
    release()
    await work
    expect(database.listMemories()).toEqual([])
    expect(database.listPendingMemoryTurns('session-1')).toHaveLength(1)
    await coordinator.dispose()
    database.close()
  })
  it('captures a root-session delta, debounces ordinary turns, and processes a durable batch', async () => {
    const database = store()
    const scheduled: Array<() => void> = []
    const calls: MemoryDistillationRequest[] = []
    const coordinator = new MemoryUpdateCoordinator({
      store: database,
      sessionQuery: { async readSession() {
        return { session: { origin: 'user', delegationDepth: 0 }, events: events(['I prefer concise release notes.']) }
      } },
      distiller: { async distill(request) {
        calls.push(request)
        return { operations: [{ action: 'create', kind: 'preference', content: 'The user prefers concise release notes.',
          status: 'candidate', importance: 0.7, confidence: 0.9 }], usage: { inputTokens: 80, outputTokens: 20 } }
      } },
      schedule(callback) { scheduled.push(callback); return () => undefined },
    })

    await coordinator.onAgentIdle(agent())
    expect(database.getMemoryCaptureState('session-1')).toMatchObject({ capturedThroughSeq: 2, pendingTurns: 1 })
    expect(calls).toHaveLength(0)
    expect(scheduled).toHaveLength(1)

    scheduled.shift()!()
    await coordinator.whenIdle('session-1')
    expect(calls).toHaveLength(1)
    expect(database.listMemories()).toMatchObject([{ content: 'The user prefers concise release notes.', status: 'candidate' }])
    expect(database.getMemoryCaptureState('session-1')).toMatchObject({ processedThroughSeq: 2, pendingTurns: 0, lastError: null })
    await coordinator.dispose()
    database.close()
  })

  it('processes explicit requests and five-turn batches immediately without waiting for the timer', async () => {
    for (const texts of [
      ['Please remember that I use Vim.'],
      ['My editor is Vim.', 'My shell is fish.', 'I use Linux.', 'I prefer pnpm.', 'My notes use Markdown.'],
    ]) {
      const database = store()
      let calls = 0
      const coordinator = new MemoryUpdateCoordinator({
        store: database,
        sessionQuery: { async readSession() { return { session: {}, events: events(texts) } } },
        distiller: { async distill() { calls += 1; return { operations: [], usage: { inputTokens: 1, outputTokens: 1 } } } },
        schedule() { throw new Error('immediate batches must not schedule a debounce timer') },
      })
      await coordinator.onAgentIdle(agent(`session-${texts.length}`))
      expect(calls).toBe(1)
      await coordinator.dispose()
      database.close()
    }
  })

  it('ignores subagent sessions and keeps pending turns when the token budget is exhausted', async () => {
    const database = store()
    let snapshot = { session: { origin: 'subagent', delegationDepth: 1 }, events: events(['I prefer Vim.']) }
    let calls = 0
    const coordinator = new MemoryUpdateCoordinator({
      store: database,
      sessionQuery: { async readSession() { return snapshot } },
      distiller: { async distill() { calls += 1; return { operations: [], usage: { inputTokens: 1, outputTokens: 1 } } } },
      maxSessionTokens: 0,
    })
    await coordinator.onAgentIdle(agent())
    expect(database.getMemoryCaptureState('session-1')).toBeNull()

    snapshot = { session: { origin: 'user', delegationDepth: 0 }, events: events(['Please remember that I use Vim.']) }
    await coordinator.onAgentIdle(agent())
    expect(calls).toBe(0)
    expect(database.getMemoryCaptureState('session-1')).toMatchObject({ pendingTurns: 1 })
    expect(database.getMemoryCaptureState('session-1')?.lastError).toContain('token budget')
    await coordinator.dispose()
    database.close()
  })
})
