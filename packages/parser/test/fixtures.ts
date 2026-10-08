import ExcelJS from "exceljs"
import { strToU8, zipSync } from "fflate"

const CONTENT_TYPES_DOCX =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
	'<Default Extension="xml" ContentType="application/xml"/>' +
	'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
	'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
	"</Types>"

const ROOT_RELS_DOCX =
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
	'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
	"</Relationships>"

/** Minimal OOXML wordprocessing package: one `<w:p>` per paragraph. */
export function buildDocx(paragraphs: string[]): Uint8Array {
	const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")
	return zipSync({
		"[Content_Types].xml": strToU8(CONTENT_TYPES_DOCX),
		"_rels/.rels": strToU8(ROOT_RELS_DOCX),
		"word/document.xml": strToU8(
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
				'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
				`<w:body>${body}</w:body></w:document>`,
		),
	})
}

const slideXml = (texts: string[]) =>
	'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
	'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"' +
	' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>' +
	texts.map((t) => `<p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp>`).join("") +
	"</p:spTree></p:cSld></p:sld>"

/**
 * Minimal presentation package. Keys are the raw part names so a test can put
 * `slide10` beside `slide2` and prove the parser sorts numerically, not lexically.
 */
export function buildPptx(slides: { part: number; texts: string[] }[]): Uint8Array {
	const entries: Record<string, Uint8Array> = {}
	for (const slide of slides) {
		entries[`ppt/slides/slide${slide.part}.xml`] = strToU8(slideXml(slide.texts))
	}
	return zipSync(entries)
}

/** Real workbook bytes, written by ExcelJS from arrays of arrays. Writing is async, so callers await it. */
export async function buildXlsx(sheets: { name: string; rows: (string | number)[][] }[]): Promise<Uint8Array> {
	const workbook = new ExcelJS.Workbook()
	for (const sheet of sheets) {
		const worksheet = workbook.addWorksheet(sheet.name)
		for (const row of sheet.rows) worksheet.addRow(row)
	}
	return new Uint8Array(await workbook.xlsx.writeBuffer())
}

/** Minimal single-column PDF: one page per entry in `lines`, each drawn with Helvetica. */
export function buildPdf(lines: string[]): Uint8Array {
	const pageCount = lines.length
	// Objects 1 and 2 are the catalog and the page tree; pages take 3 … 3+n-1.
	const contentFirst = 3 + pageCount
	const fontObj = contentFirst + pageCount
	const kids = Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ")

	const objects: string[] = ["<</Type/Catalog/Pages 2 0 R>>", `<</Type/Pages/Kids[${kids}]/Count ${pageCount}>>`]
	for (let i = 0; i < pageCount; i++) {
		objects.push(
			`<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents ${contentFirst + i} 0 R` +
				`/Resources<</Font<</F1 ${fontObj} 0 R>>>>>>`,
		)
	}
	for (const line of lines) {
		const stream = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET\n`
		objects.push(`<</Length ${stream.length}>>stream\n${stream}endstream`)
	}
	objects.push("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>")

	let pdf = "%PDF-1.4\n"
	const offsets: number[] = []
	objects.forEach((body, i) => {
		offsets.push(pdf.length)
		pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
	})
	const startxref = pdf.length
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
	for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`
	pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`

	return new Uint8Array(Buffer.from(pdf, "latin1"))
}
