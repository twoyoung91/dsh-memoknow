import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { extractDocument } from '../src/document-extraction.js'

describe('document extraction', () => {
  it('turns CSV rows into self-describing searchable text', async () => {
    const result = await extractDocument({
      fileName: 'people.csv',
      mediaType: 'text/csv',
      bytes: Buffer.from('name,role\nAda,Engineer\nGrace,Admiral\n'),
    })

    expect(result.mediaType).toBe('text/csv')
    expect(result.text).toContain('name: Ada')
    expect(result.text).toContain('role: Admiral')
  })

  it('extracts values and formula results from XLSX while ignoring images', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('Forecast')
    sheet.addRow(['Quarter', 'Revenue'])
    sheet.addRow(['Q1', { formula: '100+50', result: 150 }])
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer())

    const result = await extractDocument({
      fileName: 'forecast.xlsx',
      mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      bytes,
    })

    expect(result.text).toContain('[Sheet: Forecast]')
    expect(result.text).toContain('Quarter: Q1')
    expect(result.text).toContain('Revenue: 150 (formula: 100+50)')
  })

  it('rejects files whose signature does not match their declared format', async () => {
    await expect(extractDocument({
      fileName: 'fake.pdf', mediaType: 'application/pdf', bytes: Buffer.from('not a pdf'),
    })).rejects.toThrow('signature')
  })

  it('extracts text page-by-page from a PDF text layer', async () => {
    const result = await extractDocument({
      fileName: 'notes.pdf', mediaType: 'application/pdf', bytes: makePdf('MemoKnow PDF knowledge'),
    })
    expect(result.text).toContain('[Page 1]')
    expect(result.text).toContain('MemoKnow PDF knowledge')
  })
})

function makePdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body))
    body += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(body)
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}
