import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import ExcelJS from "exceljs"

const out = join(dirname(fileURLToPath(import.meta.url)), "out")
mkdirSync(out, { recursive: true })

/**
 * A real PDF, built by hand so the repository carries no binaries. The xref table must name the
 * byte offset of every object, so the objects are assembled first and measured as they go.
 */
const buildPdf = (pages) => {
	const objects = []
	const kids = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ")

	objects.push("<< /Type /Catalog /Pages 2 0 R >>")
	objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`)
	objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

	for (const text of pages) {
		const streamIndex = objects.length + 2
		objects.push(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamIndex} 0 R >>`,
		)
		const stream = `BT /F1 18 Tf 72 700 Td (${text.replace(/([()\\])/g, "\\$1")}) Tj ET`
		objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
	}

	let pdf = "%PDF-1.4\n"
	const offsets = []
	objects.forEach((body, index) => {
		offsets.push(pdf.length)
		pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
	})

	const xrefAt = pdf.length
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
	for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`

	return Buffer.from(pdf, "latin1")
}

const crc32 = (bytes) => {
	let crc = 0xffffffff
	for (const byte of bytes) {
		crc ^= byte
		for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
	}
	return (crc ^ 0xffffffff) >>> 0
}

const buildStoredZip = (entries) => {
	const local = []
	const central = []
	let offset = 0
	for (const [name, value] of Object.entries(entries)) {
		const nameBytes = Buffer.from(name)
		const data = Buffer.from(value)
		const checksum = crc32(data)
		const localHeader = Buffer.alloc(30)
		localHeader.writeUInt32LE(0x04034b50, 0)
		localHeader.writeUInt16LE(20, 4)
		localHeader.writeUInt32LE(0, 6)
		localHeader.writeUInt16LE(0, 8)
		localHeader.writeUInt32LE(checksum, 14)
		localHeader.writeUInt32LE(data.length, 18)
		localHeader.writeUInt32LE(data.length, 22)
		localHeader.writeUInt16LE(nameBytes.length, 26)
		local.push(localHeader, nameBytes, data)

		const centralHeader = Buffer.alloc(46)
		centralHeader.writeUInt32LE(0x02014b50, 0)
		centralHeader.writeUInt16LE(20, 4)
		centralHeader.writeUInt16LE(20, 6)
		centralHeader.writeUInt32LE(0, 8)
		centralHeader.writeUInt16LE(0, 10)
		centralHeader.writeUInt32LE(checksum, 16)
		centralHeader.writeUInt32LE(data.length, 20)
		centralHeader.writeUInt32LE(data.length, 24)
		centralHeader.writeUInt16LE(nameBytes.length, 28)
		centralHeader.writeUInt32LE(offset, 42)
		central.push(centralHeader, nameBytes)
		offset += localHeader.length + nameBytes.length + data.length
	}

	const centralDirectory = Buffer.concat(central)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(Object.keys(entries).length, 8)
	end.writeUInt16LE(Object.keys(entries).length, 10)
	end.writeUInt32LE(centralDirectory.length, 12)
	end.writeUInt32LE(offset, 16)
	return Buffer.concat([...local, centralDirectory, end])
}

const buildPptx = () =>
	buildStoredZip({
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
		"ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>`,
		"ppt/_rels/presentation.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>`,
		"ppt/slides/slide1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Quarterly board pack</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
	})

writeFileSync(join(out, "board-pack.pdf"), buildPdf(["Quarterly board pack", "Risks and mitigations"]))
writeFileSync(join(out, "board-pack.pptx"), buildPptx())

const workbook = new ExcelJS.Workbook()
const q3 = workbook.addWorksheet("Q3")
for (const row of [
	["Region", "Revenue"],
	["APAC", 120],
	["EMEA", 95],
]) {
	q3.addRow(row)
}
const notes = workbook.addWorksheet("Notes")
for (const row of [["Note"], ["carry over"]]) notes.addRow(row)
await workbook.xlsx.writeFile(join(out, "revenue.xlsx"))

writeFileSync(join(out, "notes.md"), "# Notes\n\nThe first Revision of a doc.\n")
writeFileSync(join(out, "notes-v2.md"), "# Notes\n\nThe second Revision of a doc.\n")
writeFileSync(join(out, "page.html"), "<!doctype html><title>Demo</title><h1>Sandboxed</h1>\n")
writeFileSync(
	join(out, "chat.json"),
	JSON.stringify({ turns: [{ question: "What changed?", answer: "The revenue table." }] }, null, 2),
)

console.log(`wrote fixtures to ${out}`)
