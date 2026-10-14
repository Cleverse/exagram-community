// Writes a minimal one-page PDF to stdout: the same shape as packages/parser/test/fixtures.ts's
// buildPdf, which the parse worker extracts text from.
const text = process.argv[2] ?? "Exagram self-hosted e2e"
const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET\n`
const objects = [
	"<</Type/Catalog/Pages 2 0 R>>",
	"<</Type/Pages/Kids[3 0 R]/Count 1>>",
	"<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
	`<</Length ${stream.length}>>stream\n${stream}endstream`,
	"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
]

let pdf = "%PDF-1.4\n"
const offsets = []
objects.forEach((body, i) => {
	offsets.push(pdf.length)
	pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
})
const startxref = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`
pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`

process.stdout.write(Buffer.from(pdf, "latin1"))
