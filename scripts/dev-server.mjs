import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { handleNodeRequest, MemoKnowApp, MemoKnowStore } from '../lib/index.mjs'

const store = new MemoKnowStore(resolve('.memoknow'))
const app = new MemoKnowApp(store)
const server = createServer((request, response) => {
  void handleNodeRequest(app, request, response).catch((error) => {
    console.error(error)
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})
server.listen(4179, '127.0.0.1', () => console.log('MemoKnow preview: http://127.0.0.1:4179/_dsh/memoknow'))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => { store.close(); process.exit(0) }))
}
