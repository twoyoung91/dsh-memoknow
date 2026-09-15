import { describe, expect, it } from 'vitest'
import { MANAGER_HTML } from '../src/manager.js'

describe('MemoKnow settings UI', () => {
  it('shows exactly the three supported retrieval choices', () => {
    expect(MANAGER_HTML).toContain('<option value="fts">Local FTS</option>')
    expect(MANAGER_HTML).toContain('<option value="local-cpu">Local CPU embedding</option>')
    expect(MANAGER_HTML).toContain('<option value="api">OpenAI-compatible embedding model</option>')
  })

  it('marks API fields for conditional display', () => {
    expect(MANAGER_HTML.match(/<label data-api-setting hidden>/g)).toHaveLength(3)
    expect(MANAGER_HTML).toContain("const apiMode=v.embeddingMode==='api'")
  })

  it('locks embedding controls when the Host reports a managed policy', () => {
    expect(MANAGER_HTML).toContain('data-managed-embedding hidden')
    expect(MANAGER_HTML).toContain("management?.embedding==='managed-api'")
    expect(MANAGER_HTML).toContain('control.disabled=managedEmbedding')
    expect(MANAGER_HTML).toContain('Embedding settings are managed by your organization.')
  })

  it('explains the on-demand CPU download and memory-only defaults', () => {
    expect(MANAGER_HTML).toContain('Xenova/multilingual-e5-small')
    expect(MANAGER_HTML).toContain('downloaded only when you enable this mode')
    expect(MANAGER_HTML).toContain('Maximum memory results')
    expect(MANAGER_HTML).not.toContain('name="maxSearchResults"')
  })

  it('does not dereference settings before the initial dashboard request finishes', () => {
    expect(MANAGER_HTML).toContain('<button class="primary" data-save disabled>')
    expect(MANAGER_HTML).toContain("const current=settingsSnapshot??await api('/settings')")
    expect(MANAGER_HTML).toContain("document.querySelector('[data-save]').disabled=false")
  })

  it('adapts its layout when hosted inside the DSH settings section', () => {
    expect(MANAGER_HTML).toContain("new URLSearchParams(location.search).get('embedded')==='1'")
    expect(MANAGER_HTML).toContain("document.documentElement.classList.add('embedded')")
    expect(MANAGER_HTML).toContain('.embedded .shell')
  })

  it('warns that forgetting permanently deletes the memory', () => {
    expect(MANAGER_HTML).toContain('Permanently forget this memory? This cannot be undone.')
    expect(MANAGER_HTML).not.toContain('It remains as a tombstoned record.')
  })
})
