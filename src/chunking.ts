import { ValidationError } from './validation.js'

export interface TextChunk {
  ordinal: number
  content: string
  charStart: number
  charEnd: number
}

export function chunkText(
  source: string,
  options: { maxChars?: number; overlapChars?: number } = {},
): TextChunk[] {
  const maxChars = options.maxChars ?? 1_200
  const overlapChars = options.overlapChars ?? 160
  if (!Number.isInteger(maxChars) || maxChars < 32) throw new ValidationError('maxChars must be an integer of at least 32')
  if (!Number.isInteger(overlapChars) || overlapChars < 0 || overlapChars >= maxChars) {
    throw new ValidationError('overlapChars must be a non-negative integer smaller than maxChars')
  }
  const text = source.replace(/\r\n/g, '\n').trim()
  if (text.length === 0) return []

  const chunks: TextChunk[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n\n', end)
      const line = text.lastIndexOf('\n', end)
      const sentence = Math.max(text.lastIndexOf('. ', end), text.lastIndexOf('! ', end), text.lastIndexOf('? ', end))
      const boundary = Math.max(paragraph >= start + maxChars / 2 ? paragraph + 2 : -1,
        line >= start + maxChars / 2 ? line + 1 : -1,
        sentence >= start + maxChars / 2 ? sentence + 2 : -1)
      if (boundary > start) end = boundary
    }
    const raw = text.slice(start, end)
    const leading = raw.length - raw.trimStart().length
    const content = raw.trim()
    if (content.length > 0) {
      const charStart = start + leading
      chunks.push({ ordinal: chunks.length, content, charStart, charEnd: charStart + content.length })
    }
    if (end >= text.length) break
    const next = Math.max(start + 1, end - overlapChars)
    start = next
  }
  return chunks
}
