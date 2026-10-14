import { performance } from "node:perf_hooks"

import { describe, expect, it } from "vitest"

import { rewriteCdnUrls } from "./cdn-rewrite"

const rewrite = (html: string): string => rewriteCdnUrls(Buffer.from(html, "latin1")).toString("latin1")

describe("rewriteCdnUrls", () => {
	it("returns identical bytes when nothing matches, including non-UTF-8 and multibyte bytes", () => {
		const input = Buffer.concat([
			Buffer.from('<p>héllo 日本語 </p><script src="/local.js"></script>'),
			Buffer.from([0xff, 0xfe, 0x80, 0xc3]),
		])
		expect(rewriteCdnUrls(input).equals(input)).toBe(true)
	})

	it("preserves multibyte bytes around a rewrite", () => {
		const input = Buffer.from('<p>日本語</p><script src="https://unpkg.com/react@18.3.1/x.js"></script><p>é</p>')
		const output = rewriteCdnUrls(input)
		expect(output.toString("utf8")).toBe(
			'<p>日本語</p><script src="/uc/cdn/unpkg.com/react@18.3.1/x.js"></script><p>é</p>',
		)
	})

	it.each([
		[
			'<script src="https://cdnjs.cloudflare.com/a.js"></script>',
			'<script src="/uc/cdn/cdnjs.cloudflare.com/a.js"></script>',
		],
		["<script src='https://unpkg.com/a.js'></script>", "<script src='/uc/cdn/unpkg.com/a.js'></script>"],
		[
			'<script data-note="a > b" src="https://unpkg.com/a.js"></script>',
			'<script data-note="a > b" src="/uc/cdn/unpkg.com/a.js"></script>',
		],
		[
			"<link title='>' href=\"https://fonts.googleapis.com/css2?family=Inter\" rel=stylesheet>",
			"<link title='>' href=\"/uc/cdn/fonts.googleapis.com/css2?family=Inter\" rel=stylesheet>",
		],
		[
			'<style media="a>b">@import "https://fonts.googleapis.com/css2?family=Inter";</style>',
			'<style media="a>b">@import "/uc/cdn/fonts.googleapis.com/css2?family=Inter";</style>',
		],
		["<script src=https://unpkg.com/a.js></script>", "<script src=/uc/cdn/unpkg.com/a.js></script>"],
		['<script src = "//cdn.jsdelivr.net/npm/a@1.0.0">', '<script src = "/uc/cdn/cdn.jsdelivr.net/npm/a@1.0.0">'],
		['<SCRIPT SRC="http://UNPKG.com/a.js">', '<SCRIPT SRC="/uc/cdn/unpkg.com/a.js">'],
		[
			'<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter&display=swap">',
			'<link rel="stylesheet" href="/uc/cdn/fonts.googleapis.com/css2?family=Inter&display=swap">',
		],
		[
			'<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
			'<link rel="preconnect" href="/uc/cdn/fonts.gstatic.com" crossorigin>',
		],
	])("rewrites %s", (input, expected) => {
		expect(rewrite(input)).toBe(expected)
	})

	it("leaves integrity and crossorigin untouched", () => {
		const input =
			'<script src="https://unpkg.com/a@1.0.0/x.js" integrity="sha384-abc" crossorigin="anonymous"></script>'
		expect(rewrite(input)).toBe(
			'<script src="/uc/cdn/unpkg.com/a@1.0.0/x.js" integrity="sha384-abc" crossorigin="anonymous"></script>',
		)
	})

	it.each([
		'<script data-src="https://unpkg.com/a.js"></script>',
		'<script src="https://cdnjs.cloudflare.com.evil.test/a.js"></script>',
		'<script src="https://unpkg.com:8080/a.js"></script>',
		'<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>',
		'<img src="https://unpkg.com/a.png">',
		'<a href="https://unpkg.com/a">x</a>',
		"<script>const u = 'https://unpkg.com/a.js'</script>",
		"<p>https://unpkg.com/a.js</p>",
	])("does not touch %s", (input) => {
		expect(rewrite(input)).toBe(input)
	})

	it("rewrites CSS urls and imports inside style blocks only", () => {
		const input =
			'<style>@import url("https://fonts.googleapis.com/css2?family=Inter");@import "https://fonts.googleapis.com/css?family=Roboto";' +
			"@font-face{src:url(https://fonts.gstatic.com/s/a/v1/a.woff2)}a{background:url( 'http://unpkg.com/a.png' )}" +
			"b{background:url(https://evil.test/a.png)}</style><p>url(https://unpkg.com/a.png)</p>"
		expect(rewrite(input)).toBe(
			'<style>@import url("/uc/cdn/fonts.googleapis.com/css2?family=Inter");@import "/uc/cdn/fonts.googleapis.com/css?family=Roboto";' +
				"@font-face{src:url(/uc/cdn/fonts.gstatic.com/s/a/v1/a.woff2)}a{background:url( '/uc/cdn/unpkg.com/a.png' )}" +
				"b{background:url(https://evil.test/a.png)}</style><p>url(https://unpkg.com/a.png)</p>",
		)
	})

	describe("on adversarial input", () => {
		const SIZE = 2 * 1024 * 1024
		const cases: [string, () => string][] = [
			["unterminated <script repeated", () => "<script ".repeat(SIZE / 8)],
			["unterminated <link repeated", () => "<link ".repeat(SIZE / 6)],
			["<style> repeated without </style>", () => "<style>".repeat(SIZE / 7)],
			["nested src= attributes", () => '<script src="src="'.repeat(SIZE / 18)],
			["one unterminated script tag with a huge value", () => `<script src="${"a".repeat(SIZE)}`],
			["<style> followed by many url( starts", () => `<style>${"url(".repeat(SIZE / 4)}`],
			["closed <style> with many url( starts", () => `<style>${"url( ".repeat(SIZE / 5)}</style>`],
		]
		it.each(cases)("finishes in linear time: %s", (_name, build) => {
			const html = build()
			const started = performance.now()
			rewrite(html)
			expect(performance.now() - started).toBeLessThan(1000)
		})
	})
})
