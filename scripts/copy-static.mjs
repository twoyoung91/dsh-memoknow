import { copyFile, mkdir } from 'node:fs/promises'

await mkdir(new URL('../lib/', import.meta.url), { recursive: true })
await copyFile(new URL('../client/client.js', import.meta.url), new URL('../lib/client.js', import.meta.url))
