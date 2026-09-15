import { parse } from 'csv-parse/sync'
import ExcelJS from 'exceljs'
import mammoth from 'mammoth'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import WordExtractor from 'word-extractor'
import { extname } from 'node:path'
import { ValidationError } from './validation.js'

export const SUPPORTED_DOCUMENT_TYPES = {
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export type SupportedDocumentMediaType = typeof SUPPORTED_DOCUMENT_TYPES[keyof typeof SUPPORTED_DOCUMENT_TYPES]

export interface ExtractedDocument {
  mediaType: SupportedDocumentMediaType
  text: string
  warnings: string[]
}

export function mediaTypeForFileName(fileName: string): SupportedDocumentMediaType {
  const extension = extname(fileName).toLowerCase() as keyof typeof SUPPORTED_DOCUMENT_TYPES
  const mediaType = SUPPORTED_DOCUMENT_TYPES[extension]
  if (mediaType === undefined) throw new ValidationError('Supported files are DOC, DOCX, PDF, CSV, and XLSX')
  return mediaType
}

export async function extractDocument(input: {
  fileName: string
  mediaType: SupportedDocumentMediaType
  bytes: Buffer
}): Promise<ExtractedDocument> {
  if (input.bytes.byteLength === 0) throw new ValidationError('Document is empty')
  validateSignature(input.mediaType, input.bytes)
  let text: string
  const warnings: string[] = []
  switch (input.mediaType) {
    case 'application/pdf':
      text = await extractPdf(input.bytes)
      break
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      const result = await mammoth.extractRawText({ buffer: input.bytes })
      text = result.value
      warnings.push(...result.messages.map((message) => message.message))
      break
    }
    case 'application/msword': {
      const result = await new WordExtractor().extract(input.bytes)
      text = [result.getBody(), result.getFootnotes(), result.getEndnotes(), result.getTextboxes()]
        .filter((part) => part.trim() !== '').join('\n\n')
      break
    }
    case 'text/csv':
      text = extractCsv(input.bytes)
      break
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      text = await extractXlsx(input.bytes)
      break
  }
  const normalized = text.replace(/\u0000/g, '').replace(/\r\n/g, '\n').trim()
  if (normalized === '') throw new ValidationError('Document contains no extractable text')
  return { mediaType: input.mediaType, text: normalized, warnings }
}

function validateSignature(mediaType: SupportedDocumentMediaType, bytes: Buffer): void {
  const isZip = bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
  const isOle = bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))
  if (mediaType === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new ValidationError('PDF signature does not match the declared format')
  }
  if ((mediaType.endsWith('wordprocessingml.document') || mediaType.endsWith('spreadsheetml.sheet')) && !isZip) {
    throw new ValidationError('Office document signature does not match the declared format')
  }
  if (mediaType === 'application/msword' && !isOle) {
    throw new ValidationError('Word document signature does not match the declared format')
  }
}

async function extractPdf(bytes: Buffer): Promise<string> {
  const task = getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, stopAtErrors: true })
  const pdf = await task.promise
  if (pdf.numPages > 2_000) throw new ValidationError('PDF exceeds the 2,000 page limit')
  const pages: string[] = []
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let pageText = ''
      for (const item of content.items) {
        if (!('str' in item)) continue
        pageText += item.str
        pageText += item.hasEOL ? '\n' : ' '
      }
      if (pageText.trim() !== '') pages.push(`[Page ${pageNumber}]\n${pageText.trim()}`)
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return pages.join('\n\n')
}

function extractCsv(bytes: Buffer): string {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new ValidationError('CSV must be UTF-8 encoded')
  }
  const rows = parse(source, {
    bom: true, skip_empty_lines: true, max_record_size: 1_000_000, to: 100_001,
  }) as unknown[][]
  if (rows.length === 0) return ''
  if (rows.length > 100_000) throw new ValidationError('CSV exceeds the 100,000 row limit')
  const headers = rows[0]!.map((value, index) => cellText(value) || `Column ${index + 1}`)
  if (headers.length > 256) throw new ValidationError('CSV exceeds the 256 column limit')
  if (rows.length === 1) return `[Headers] ${headers.join(' | ')}`
  return rows.slice(1).map((row, rowIndex) => {
    const cells = headers.map((header, columnIndex) => `${header}: ${cellText(row[columnIndex])}`)
    return `[Row ${rowIndex + 2}] ${cells.join(' | ')}`
  }).join('\n')
}

async function extractXlsx(bytes: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer)
  if (workbook.worksheets.length > 100) throw new ValidationError('Workbook exceeds the 100 sheet limit')
  const sections: string[] = []
  let totalRows = 0
  for (const sheet of workbook.worksheets) {
    if (sheet.actualColumnCount > 256) throw new ValidationError(`Sheet ${sheet.name} exceeds the 256 column limit`)
    const rows: string[] = [`[Sheet: ${sheet.name}]`]
    let headers: string[] = []
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      totalRows += 1
      if (totalRows > 100_000) throw new ValidationError('Workbook exceeds the 100,000 row limit')
      const values: string[] = []
      for (let column = 1; column <= Math.max(row.cellCount, headers.length); column += 1) {
        values.push(excelCellText(row.getCell(column)))
      }
      if (headers.length === 0) {
        headers = values.map((value, index) => value || `Column ${index + 1}`)
        rows.push(`[Row ${rowNumber}] ${headers.join(' | ')}`)
      } else {
        rows.push(`[Row ${rowNumber}] ${headers.map((header, index) => `${header}: ${values[index] ?? ''}`).join(' | ')}`)
      }
    })
    if (rows.length > 1) sections.push(rows.join('\n'))
  }
  return sections.join('\n\n')
}

function excelCellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value !== null && typeof value === 'object' && 'formula' in value) {
    const formulaValue = value as { formula: string; result?: unknown }
    return `${cellText(formulaValue.result)} (formula: ${formulaValue.formula})`
  }
  return cell.text || cellText(value)
}

function cellText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value).replace(/\s+/g, ' ').trim()
}
