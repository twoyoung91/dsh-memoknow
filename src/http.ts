import type { IncomingMessage, ServerResponse } from 'node:http'
import { MemoKnowApp } from './app.js'
import { MANAGER_HTML } from './manager.js'

const MAX_TRANSPORT_BYTES = 26 * 1024 * 1024

export async function handleNodeRequest(app: MemoKnowApp, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const origin = `http://${request.headers.host ?? 'localhost'}`
  const url = new URL(request.url ?? '/', origin)
  if (url.pathname === '/_dsh/memoknow') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end()
      return
    }
    response.writeHead(200, securityHeaders('text/html; charset=utf-8'))
    response.end(request.method === 'HEAD' ? undefined : MANAGER_HTML)
    return
  }
  const body = await readBody(request)
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  if (body.byteLength >= MAX_TRANSPORT_BYTES) {
    writeWebResponse(response, Response.json({ ok: false, error: { code: 'payload_too_large', message: 'Request body exceeds 26 MiB' } }, { status: 413 }))
    return
  }
  const method = request.method ?? 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD' && body.byteLength > 0) {
    init.body = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
  }
  const result = await app.handle(new Request(url, init))
  await writeWebResponse(response, result)
}

async function readBody(request: IncomingMessage): Promise<Uint8Array> {
  if (request.method === 'GET' || request.method === 'HEAD') return new Uint8Array()
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.byteLength
    if (total > MAX_TRANSPORT_BYTES) return new Uint8Array(total)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

async function writeWebResponse(response: ServerResponse, result: Response): Promise<void> {
  const headers: Record<string, string> = {}
  result.headers.forEach((value, name) => { headers[name] = value })
  Object.assign(headers, securityHeaders(headers['content-type'] ?? 'application/json; charset=utf-8'))
  response.writeHead(result.status, headers)
  response.end(Buffer.from(await result.arrayBuffer()))
}

function securityHeaders(contentType: string): Record<string, string> {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  }
}
