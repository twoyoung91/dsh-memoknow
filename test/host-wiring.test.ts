import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.js'

describe('DSH wiring', () => {
  it('rejects an insecure managed embedding endpoint before mounting the plugin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-host-'))
    const context = {
      inject() {},
      effect() {},
      logger: { info() {}, warn() {}, error() {} },
    }
    try {
      expect(() => apply(context as never, {
        dataDir: dir,
        embedding: {
          source: 'managed-api',
          baseUrl: 'http://embedding.example.test/v1',
          model: 'managed-embedding-v1',
          apiKeyEnv: 'MANAGED_EMBEDDING_API_KEY',
        },
      })).toThrow('managed embedding baseUrl must use HTTPS unless it targets loopback')
      expect(() => apply(context as never, {
        dataDir: dir,
        embedding: {
          source: 'managed-api',
          baseUrl: 'ftp://localhost/model',
          model: 'managed-embedding-v1',
        },
      })).toThrow('managed embedding baseUrl must use HTTPS unless it targets loopback')
      expect(() => apply(context as never, {
        dataDir: dir,
        embedding: {
          source: 'managed-api',
          baseUrl: 'https://user:secret@embedding.example.test/v1',
          model: 'managed-embedding-v1',
        },
      })).toThrow('managed embedding baseUrl must not contain credentials')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('registers settings, tools, routes, and automatic memory lifecycle listeners', () => {
    const dir = mkdtempSync(join(tmpdir(), 'memoknow-host-'))
    const tools: unknown[] = []
    const routes: unknown[] = []
    const settingsNamespaces: string[] = []
    const listeners = new Map<string, Array<(payload: unknown) => void>>()
    const cleanups: Array<() => void> = []
    const scope = {
      tools: { register(tool: unknown) { tools.push(tool); return () => { tools.pop() } } },
      webServer: { register(route: unknown) { routes.push(route); return () => { routes.pop() } } },
      settings: { register(namespace: string) { settingsNamespaces.push(namespace) } },
      llm: { async *stream() {} },
      sessionQuery: { async readSession() { return { session: {}, events: [] } } },
      on(name: string, listener: (payload: unknown) => void) {
        const values = listeners.get(name) ?? []
        values.push(listener)
        listeners.set(name, values)
        const cleanup = () => listeners.set(name, (listeners.get(name) ?? []).filter((value) => value !== listener))
        cleanups.push(cleanup)
        return cleanup
      },
      effect(factory: () => (() => void)) { const cleanup = factory(); if (cleanup) cleanups.push(cleanup) },
      logger: { info() {}, warn() {}, error() {} },
    }
    const context = {
      ...scope,
      inject(names: string[], callback: (ctx: typeof scope) => void) { callback(scope) },
    }

    apply(context as never, { dataDir: dir })
    expect(settingsNamespaces).toEqual(['memoknow'])
    expect(tools).toHaveLength(7)
    expect(tools).toContainEqual(expect.objectContaining({ name: 'memoknow_memory_forget' }))
    expect(routes).toHaveLength(2)
    expect(listeners.get('agent/status')).toHaveLength(1)
    expect(listeners.get('agent/disposed')).toHaveLength(1)
    for (const cleanup of cleanups.reverse()) cleanup()
    expect(tools).toHaveLength(0)
    expect(routes).toHaveLength(0)
    expect(listeners.get('agent/status')).toHaveLength(0)
    expect(listeners.get('agent/disposed')).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads the browser artifact through the DSH lazy module format', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
      dsh?: { client?: { immediately?: boolean; inject?: string[] } }
    }
    expect(manifest.dsh?.client?.immediately).toBe(true)
    expect(manifest.dsh?.client?.inject).toContain('@deepseek-ai/dsh-client-ui-settings')
    const source = await readFile(new URL('../client/client.js', import.meta.url), 'utf8')
    let registration: { id: string; factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } } | undefined
    let mountedStyle: { dataset: Record<string, string>; textContent: string; remove: () => void } | undefined
    const sandbox = {
      window: { __ModuleLoader__: { load(value: typeof registration) { registration = value } } },
      document: {
        querySelector() { return mountedStyle },
        createElement() {
          return { dataset: {}, textContent: '', remove() { mountedStyle = undefined } }
        },
        head: { appendChild(style: typeof mountedStyle) { mountedStyle = style } },
      },
      fetch() { return Promise.reject(new Error('not called')) },
    }
    vm.runInNewContext(source, sandbox)
    expect(registration?.id).toBe('@dsh-external/dsh-memoknow')
    const client = registration!.factory((id) => id === 'react' ? {
      createElement(type: unknown, props: unknown, ...children: unknown[]) { return { type, props, children } },
    } : {})
    const injections: string[] = []
    let registeredOptions: Record<string, unknown> | undefined
    let registeredComponent: (() => { type: unknown; props: Record<string, unknown> }) | undefined
    let removeStyles: (() => void) | undefined
    client.apply({
      effect(factory: () => void | (() => void)) { removeStyles = factory() ?? undefined },
      slots: {
        inject(name: string, callback: () => void) { injections.push(name); callback() },
        register(options: Record<string, unknown>, component: typeof registeredComponent) {
          registeredOptions = options
          registeredComponent = component
        },
      },
    })
    expect(injections).toEqual(['settings.section'])
    expect(registeredOptions).toMatchObject({
      name: 'settings.section',
      id: 'dsh-memoknow',
      order: 100,
    })
    expect(registeredOptions?.label).toBeTypeOf('function')
    expect((registeredOptions?.label as () => string)()).toBe('MemoKnow')
    expect(mountedStyle?.textContent).toContain('.dmk-settings-frame')
    expect(registeredComponent?.()).toMatchObject({
      type: 'iframe',
      props: {
        className: 'dmk-settings-frame',
        src: '/_dsh/memoknow?embedded=1',
        title: 'MemoKnow settings',
      },
    })
    removeStyles?.()
    expect(mountedStyle).toBeUndefined()
  })
})
