import { describe, expect, it } from 'vitest'
import { chunkText } from '../src/chunking.js'

describe('chunkText', () => {
  it('keeps short documents as one searchable chunk', () => {
    expect(chunkText('Alpha\n\nBeta', { maxChars: 100, overlapChars: 10 })).toEqual([
      { ordinal: 0, content: 'Alpha\n\nBeta', charStart: 0, charEnd: 11 },
    ])
  })

  it('bounds chunks and preserves useful overlap', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}\n\n${'c'.repeat(60)}`
    const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.content.length <= 100)).toBe(true)
    expect(chunks.map((chunk) => chunk.ordinal)).toEqual(chunks.map((_, index) => index))
    expect(chunks[1]!.charStart).toBeLessThan(chunks[0]!.charEnd)
  })

  it('rejects nonsensical limits', () => {
    expect(() => chunkText('text', { maxChars: 32, overlapChars: 32 })).toThrow(/overlap/i)
  })
})
