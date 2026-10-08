import { type Components } from "react-markdown"

/** Element styles copied from the prototype's block renderers, in the same `em` scale. */
export const sheetMarkdown: Components = {
	h1: ({ children }) => (
		<h3 className="font-display mt-[2em] mb-[.8em] text-[1.9em] font-bold tracking-[-.01em]">{children}</h3>
	),
	h2: ({ children }) => (
		<h3 className="font-display mt-[2em] mb-[.8em] text-[1.65em] font-semibold tracking-[-.01em]">{children}</h3>
	),
	h3: ({ children }) => <h4 className="font-display mt-[1.6em] mb-[.6em] text-[1.3em] font-semibold">{children}</h4>,
	h4: ({ children }) => <h5 className="font-display mt-[1.4em] mb-[.5em] text-[1.15em] font-semibold">{children}</h5>,
	p: ({ children }) => (
		<p className="mb-[1.1em] text-[1.2em] leading-[1.7] text-ink" style={{ textWrap: "pretty" }}>
			{children}
		</p>
	),
	ol: ({ children }) => <ol className="mb-[1.1em] list-decimal pl-[1.6em] text-[1.2em] leading-[1.7]">{children}</ol>,
	ul: ({ children }) => <ul className="mb-[1.1em] list-disc pl-[1.6em] text-[1.2em] leading-[1.7]">{children}</ul>,
	li: ({ children }) => <li className="mb-[.4em]">{children}</li>,
	hr: () => <hr className="my-[2.2em] border-0 border-t border-line-faint" />,
	table: ({ children }) => (
		<table className="mb-[1.4em] w-full border-collapse text-[1.05em] leading-[1.6]">{children}</table>
	),
	th: ({ children }) => (
		<th className="border border-line-strong bg-menu-hover px-[1em] py-[.7em] text-left font-semibold">{children}</th>
	),
	td: ({ children }) => <td className="border border-line-strong px-[1em] py-[.8em] align-top">{children}</td>,
	blockquote: ({ children }) => (
		<blockquote className="mb-[1.1em] border-l-2 border-line-faint pl-[1em] text-[1.2em] leading-[1.7] text-secondary">
			{children}
		</blockquote>
	),
	code: ({ children }) => <code className="font-mono bg-chip px-[.3em] py-[.1em] text-[.9em]">{children}</code>,
	pre: ({ children }) => (
		<pre className="font-mono mb-[1.1em] overflow-x-auto border border-line-faint bg-menu-hover p-[1em] text-[.95em] leading-[1.6]">
			{children}
		</pre>
	),
	a: ({ children, href }) => (
		<a className="underline" href={href} target="_blank" rel="noopener noreferrer nofollow">
			{children}
		</a>
	),
}
