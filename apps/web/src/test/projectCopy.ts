import ts from "typescript"
import { expect } from "vitest"

const PROJECT_WORD = /\bsub-?projects?\b|\bprojects?\b/i

const BARE_PROJECT_WORD = /^(?:sub-?)?projects?(?:'s)?[.,:;!?)]*$/i

// Whole literals from the design's sample data. A phrase that only contains one of them is still new copy.
const PLAIN_ENGLISH_PROJECT_TITLES: ReadonlySet<string> = new Set([
	"โครงการ Side Project ภายในทีม มีเป้าหมายเพื่อยกระดับทักษะ Product Mindset และ AI-Native Engineering ผ่านการสร้าง Internal Tool ที่ใช้งานได้จริง โดยมีหลักการสำคัญ:",
	"Personal Project & Self-Growth Guideline: Building in the AI Era",
	"Internal AI-Assisted Product Hackathon: Project Brief & Track Catalog",
	"Internal AI Product Hackathon - Project Brief.md",
])

interface Piece {
	raw: string
	trimmed: string
}

const quoted = ({ trimmed }: Piece) => /\s/.test(trimmed) || /^Projects?$/.test(trimmed)

const templatePiece = (piece: Piece) =>
	quoted(piece) || (/^\s|\s$/.test(piece.raw) && BARE_PROJECT_WORD.test(piece.trimmed))

const rendered = () => true

type CopyRule = (piece: Piece) => boolean

// A quoted lone word is an enum, route or key. In rendered text, or set off by whitespace in a template, it is prose.
const COPY_RULES: ReadonlyMap<ts.SyntaxKind, CopyRule> = new Map([
	[ts.SyntaxKind.StringLiteral, quoted],
	[ts.SyntaxKind.NoSubstitutionTemplateLiteral, quoted],
	[ts.SyntaxKind.TemplateHead, templatePiece],
	[ts.SyntaxKind.TemplateMiddle, templatePiece],
	[ts.SyntaxKind.TemplateTail, templatePiece],
	[ts.SyntaxKind.JsxText, rendered],
])

const namesProject = (rule: CopyRule, raw: string) => {
	const trimmed = raw.replace(/\s+/g, " ").trim()
	return PROJECT_WORD.test(trimmed) && !PLAIN_ENGLISH_PROJECT_TITLES.has(trimmed) && rule({ raw, trimmed })
}

export const projectCopyIn = (fileName: string, source: string): string[] => {
	if (!PROJECT_WORD.test(source)) return []
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
	const found: string[] = []
	const visit = (node: ts.Node) => {
		const rule = COPY_RULES.get(node.kind)
		const text = rule ? (node as ts.LiteralLikeNode).text : ""
		const parent = node.parent as ts.Node | undefined
		const moduleSpecifier = parent !== undefined && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent))
		if (rule && text && !moduleSpecifier && namesProject(rule, text)) {
			const { line } = file.getLineAndCharacterOfPosition(node.getStart())
			found.push(`${fileName}:${line + 1} ${text.replace(/\s+/g, " ").trim()}`)
		}
		ts.forEachChild(node, visit)
	}
	visit(file)
	return found
}

const LABEL_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"]

const HARNESS_PROBES = '[data-testid="where"], [data-testid="sheet-params"]'

export const expectNoProjectCopy = (root: Element = document.body) => {
	const labels = [...root.querySelectorAll("*")].flatMap((element) =>
		LABEL_ATTRIBUTES.map((name) => element.getAttribute(name) ?? ""),
	)
	const visible = root.cloneNode(true) as Element
	for (const probe of visible.querySelectorAll(HARNESS_PROBES)) probe.remove()
	const shown = [visible.textContent ?? "", ...labels].filter((value) => PROJECT_WORD.test(value))
	expect(shown).toEqual([])
}
