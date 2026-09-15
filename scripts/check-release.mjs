import { access, readFile } from 'node:fs/promises'

const required = ['lib/index.mjs', 'lib/index.d.mts', 'lib/client.js', 'cordis.patch.yml', 'README.md', 'LICENSE']
await Promise.all(required.map((path) => access(new URL('../' + path, import.meta.url))))
const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
if (!client.includes("id: '@dsh-external/dsh-memoknow'")) throw new Error('client bundle has the wrong module id')
const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
if (!patch.includes("name: '@dsh-external/dsh-memoknow'")) throw new Error('bundle patch does not mount this package')
console.log('release artifacts verified')
