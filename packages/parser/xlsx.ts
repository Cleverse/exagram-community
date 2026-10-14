import ExcelJS from "exceljs"

import { checkZipBudget } from "./limits"

import type { ParseOutput } from "./parser.port"

const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")

/**
 * ExcelJS numbers rows and columns from 1 and skips nothing when `includeEmpty` is set, so a short
 * row still reports its cells in column order and the table stays rectangular. `cell.text` is the
 * rendered value: a date reads as the sheet shows it, a formula as its cached result, rich text as
 * one string. Nothing here touches the workbook's styles or its shared-string table.
 */
export async function parseXlsx(bytes: Uint8Array): Promise<ParseOutput> {
	checkZipBudget(bytes)
	const workbook = new ExcelJS.Workbook()
	// exceljs's own Buffer type declaration is really "any ArrayBuffer"; Node's Buffer (a Uint8Array
	// subtype) does not structurally match it, so load() takes the underlying ArrayBuffer instead.
	await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)

	const sections: string[] = []
	workbook.eachSheet((worksheet) => {
		const rows: string[][] = []
		let width = 0
		worksheet.eachRow({ includeEmpty: false }, (row) => {
			const values: string[] = []
			row.eachCell({ includeEmpty: true }, (current) => values.push(cell(current.text ?? "")))
			if (values.every((value) => value === "")) return
			width = Math.max(width, values.length)
			rows.push(values)
		})

		if (rows.length === 0) {
			sections.push(`<!-- Sheet: ${worksheet.name} -->`)
			return
		}

		const line = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`
		const lines = [
			line(rows[0]!),
			`| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
			...rows.slice(1).map(line),
		]
		sections.push(`<!-- Sheet: ${worksheet.name} -->\n${lines.join("\n")}`)
	})

	return { text: sections.join("\n\n"), pages: workbook.worksheets.length }
}
