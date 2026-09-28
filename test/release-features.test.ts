import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { MemoKnowStore } from '../src/store.js'
import { MemoKnowApp } from '../src/app.js'

const fixtures: Array<{ dir: string; store: MemoKnowStore }> = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'memoknow-release-'))
  const store = new MemoKnowStore(dir)
  fixtures.push({ dir, store })
  return { store, app: new MemoKnowApp(store) }
}
afterEach(() => {
  for (const { dir, store } of fixtures.splice(0)) {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('recalls only active unexpired memories while the review library includes every state', async () => {
  const { store, app } = fixture()
  const candidate = store.createMemory({ kind: 'fact', content: 'Cobalt review candidate', status: 'candidate' })
  for (const status of ['active', 'stale', 'archived', 'superseded', 'disputed'] as const) {
    store.createMemory({ kind: 'fact', content: `Cobalt ${status}`, status })
  }
  store.createMemory({ kind: 'fact', content: 'Cobalt expired', expiresAt: '2020-01-01' })
  expect(store.search('Cobalt')).toMatchObject([{ content: 'Cobalt active' }])
  const response = await app.handle(new Request('http://localhost/_dsh/memoknow/api/memories?q=Cobalt&status=candidate'))
  expect(await response.json()).toMatchObject({ value: [{ id: candidate.id, revision: 1 }] })
  store.updateMemory(candidate.id, 1, { status: 'active' })
  expect(store.search('Cobalt')).toHaveLength(2)
  expect(store.search('Cobalt', { includeArchived: true })).toHaveLength(7)
})

it('retains evidence and keeps approved originals until a proposed edit is accepted', () => {
  const { store } = fixture()
  store.captureMemoryTurns('session', 5, [{ turn: 1, endSeq: 5, userText: 'Cobalt uses SQLite', assistantText: '', explicit: false }])
  store.completeMemoryDistillation('session', 5, [{ action: 'create', kind: 'fact', content: 'Cobalt uses SQLite',
    status: 'candidate', importance: 0.5, confidence: 0.8, evidenceTurns: [1] }], { inputTokens: 10, outputTokens: 10 })
  const memory = store.listMemories()[0]!
  expect(memory.source).toMatchObject({ sessionId: 'session', evidenceTurns: [1] })
  const approved = store.updateMemory(memory.id, memory.revision, { status: 'active' })
  store.captureMemoryTurns('session', 10, [{ turn: 2, endSeq: 10, userText: 'Cobalt now uses CSV', assistantText: '', explicit: false }])
  store.completeMemoryDistillation('session', 10, [{ action: 'update', id: approved.id, expectedRevision: approved.revision,
    content: 'Cobalt uses CSV', evidenceTurns: [2] }], { inputTokens: 10, outputTokens: 10 })
  expect(store.getMemory(memory.id)).toMatchObject({ status: 'active', content: 'Cobalt uses SQLite' })
  const proposal = store.listMemories({ status: 'candidate' })[0]!
  expect(proposal).toMatchObject({ content: 'Cobalt uses CSV', source: { evidenceTurns: [2], replaces: { id: memory.id, revision: approved.revision } } })
  const accepted = store.updateMemory(proposal.id, proposal.revision, { status: 'active' })
  expect(store.getMemory(memory.id)?.status).toBe('superseded')
  expect(store.search('Cobalt')).toMatchObject([{ id: proposal.id, content: 'Cobalt uses CSV' }])
  const archived = store.updateMemory(accepted.id, accepted.revision, { status: 'archived' })
  expect(store.updateMemory(archived.id, archived.revision, { status: 'active' }).status).toBe('active')
})

it('dismissing a replacement preserves the original and stale approval cannot supersede later edits', () => {
  const { store } = fixture()
  const original = store.createMemory({ kind: 'fact', content: 'Cobalt uses SQLite' })
  const proposal = store.createMemory({ kind: 'fact', content: 'Cobalt uses CSV', status: 'candidate',
    source: { kind: 'session-distilled', replaces: { id: original.id, revision: original.revision } } })
  const dismissed = store.updateMemory(proposal.id, proposal.revision, { status: 'archived' })
  expect(store.search('Cobalt')).toMatchObject([{ id: original.id }])
  store.updateMemory(original.id, original.revision, { content: 'Cobalt uses JSON' })
  expect(()=>store.updateMemory(proposal.id, dismissed.revision, { status: 'active' })).toThrow('original memory changed')
  expect(store.getMemory(original.id)?.status).toBe('active')
  expect(store.getMemory(proposal.id)?.status).toBe('archived')
  store.removeMemory(original.id, original.revision + 1)
  expect(store.getMemory(proposal.id)).toBeNull()
})

it('searches only knowledge, previews bounded chunks, and rejects stale index repair', async () => {
  const { store, app } = fixture()
  store.createMemory({ kind: 'fact', content: 'Cobalt project' })
  const document = store.importKnowledge({ title: 'Cobalt guide', mediaType: 'text/plain', content: 'Cobalt instructions. '.repeat(100) })
  const get = async (path: string) => (await app.handle(new Request('http://localhost/_dsh/memoknow/api' + path))).json()
  const search = await get('/search?q=Cobalt&domain=knowledge&limit=1')
  expect(search.value).toMatchObject([{ domain: 'knowledge', documentId: document.id }])
  const preview = await get(`/knowledge/${document.id}/chunks?limit=1&offset=1`)
  expect(preview.value).toMatchObject([{ ordinal: 1 }])
  expect(preview.value).toHaveLength(1)
  const repair = await app.handle(new Request(`http://localhost/_dsh/memoknow/api/knowledge/${document.id}/reindex`, {
    method: 'POST', body: JSON.stringify({ expectedRevision: 999 }),
  }))
  expect(repair.status).toBe(409)
})

it('persists revisioned learning controls independently of retrieval settings', async () => {
  const { store, app } = fixture()
  const get = () => app.handle(new Request('http://localhost/_dsh/memoknow/api/learning'))
  const initial = (await (await get()).json()).value
  expect(initial.controls.value).toMatchObject({ paused: false, excludedSessionIds: [], maxSessionTokens: 8000, maxDailyTokens: 30000 })
  const patch = (revision: number, maxDailyTokens = 1000) => app.handle(new Request('http://localhost/_dsh/memoknow/api/learning', {
    method: 'PATCH', body: JSON.stringify({ expectedRevision: revision,
      value: { ...initial.controls.value, paused: true, excludedSessionIds: ['session-1'], maxDailyTokens } }),
  }))
  expect((await patch(initial.controls.revision)).status).toBe(200)
  expect((await patch(initial.controls.revision)).status).toBe(409)
  expect((await patch(initial.controls.revision + 1, -1)).status).toBe(400)
  expect(store.getSettings().revision).toBe(1)
  expect((await (await get()).json()).value.controls.value.paused).toBe(true)
})

it('repairs a failed semantic index without losing keyword search or the original document', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoknow-index-repair-'))
  let fail = true
  const store = new MemoKnowStore(dir, { embeddingProvider: { id: 'test', model: 'test', async embed(texts) {
    if (fail) throw new Error('Synthetic provider unavailable')
    return texts.map(()=>[1, 0, 0])
  } } })
  fixtures.push({ dir, store })
  const settings = store.getSettings()
  store.updateSettings(settings.revision, { ...settings.value, embeddingMode: 'api' })
  const document = store.importKnowledge({ title: 'Cobalt', mediaType: 'text/plain', content: 'Cobalt is searchable.' })
  await expect(store.retryKnowledgeIndex(document.id, document.revision)).rejects.toThrow('Semantic indexing failed')
  expect(store.getKnowledge(document.id)?.embeddingStatus).toBe('failed')
  expect(store.search('Cobalt', { domain: 'knowledge' })).toHaveLength(1)
  fail = false
  const repaired = await store.retryKnowledgeIndex(document.id, document.revision)
  expect(repaired).toMatchObject({ id: document.id, sha256: document.sha256, embeddingStatus: 'ready', embeddingError: null })
  expect(await store.searchHybrid('unrelated', { domain: 'knowledge' })).toMatchObject([{ documentId: document.id }])
  await expect(store.retryKnowledgeIndex(document.id, document.revision)).resolves.toMatchObject({ embeddingStatus: 'ready' })
  const settingsAgain = store.getSettings()
  await expect(store.activateSettings(settingsAgain.revision, settingsAgain.value)).resolves.toBeDefined()
})

it('rejects duplicate retries and cannot write vectors after the document is removed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoknow-index-race-'))
  let release!: () => void
  const store = new MemoKnowStore(dir, { embeddingProvider: { id: 'test', model: 'test', async embed(texts) {
    await new Promise<void>(resolve=>{release=resolve})
    return texts.map(()=>[1, 0, 0])
  } } })
  fixtures.push({ dir, store })
  const settings = store.getSettings()
  store.updateSettings(settings.revision, { ...settings.value, embeddingMode: 'api' })
  const document = store.importKnowledge({ title: 'Cobalt', mediaType: 'text/plain', content: 'Cobalt' })
  const retry = store.retryKnowledgeIndex(document.id, document.revision)
  await expect(store.retryKnowledgeIndex(document.id, document.revision)).rejects.toThrow('changed')
  store.removeKnowledge(document.id, document.revision)
  release()
  await expect(retry).rejects.toThrow('not found')
  expect(store.search('Cobalt')).toEqual([])
})

it('migrates an existing store with safe defaults and retains controls on reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoknow-learning-reopen-'))
  let store = new MemoKnowStore(dir)
  const controls = store.getLearningControls()
  store.updateLearningControls(controls.revision, { ...controls.value, paused: true, excludedSessionIds: ['private'] }, new Date(1000))
  store.close()
  store = new MemoKnowStore(dir)
  fixtures.push({ dir, store })
  expect(store.getLearningControls()).toMatchObject({ revision: 2, value: { paused: true, excludedSessionIds: ['private'] } })
  expect(store.learningWasBlocked('other', 1500, 2000)).toBe(true)
})
