import { strFromU8, unzipSync } from "fflate"

import { checkZipBudget } from "./limits"

import type { ParseOutput } from "./parser.port"

const SLIDE_PART = /^ppt\/slides\/slide(\d+)\.xml$/
const TEXT_RUN = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g

// `&amp;` last, so an encoded `&amp;lt;` does not decode twice into `<`.
const decodeXml = (value: string) =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&")

export function parsePptx(bytes: Uint8Array): Promise<ParseOutput> {
	try {
		checkZipBudget(bytes)
		const files = unzipSync(bytes)
		const slides = Object.keys(files)
			.map((path) => ({ path, match: SLIDE_PART.exec(path) }))
			.filter((entry): entry is { path: string; match: RegExpExecArray } => entry.match !== null)
			.map((entry) => ({ path: entry.path, part: Number(entry.match[1]) }))
			.sort((a, b) => a.part - b.part)

		const sections = slides.map((slide, index) => {
			const xml = strFromU8(files[slide.path]!)
			const runs = [...xml.matchAll(TEXT_RUN)].map((match) => decodeXml(match[1]!)).filter((text) => text.length > 0)
			return `<!-- Slide: ${index + 1} -->\n${runs.join("\n")}`
		})

		return Promise.resolve({ text: sections.join("\n\n"), pages: slides.length })
	} catch (error) {
		return Promise.reject(error as Error)
	}
}
