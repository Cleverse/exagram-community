export type DiffLine = { kind: "same" | "added" | "removed"; text: string }

/**
 * Past this many line pairs (after the common head and tail are trimmed) the LCS table gets too big to
 * build in the browser — about 4MB of table and a noticeable pause — so the diff says so instead.
 */
export const DIFF_CELL_LIMIT = 1_000_000

/**
 * A text's lines: CRLF and LF both end a line, an empty text has none, and a trailing newline ends the
 * last line rather than starting an empty one, so "a" and "a\n" are the same one line.
 */
export const linesOf = (text: string): string[] => {
	if (text === "") return []
	const lines = text.split(/\r?\n/)
	if (lines[lines.length - 1] === "") lines.pop()
	return lines
}

/**
 * A line diff from `before` to `after` by longest common subsequence: unchanged lines, lines only in
 * `before` (removed) and lines only in `after` (added), in reading order. Removals come before the
 * additions that replace them. Returns `null` when the inputs are too large to compare here.
 */
export const lineDiff = (before: string, after: string): DiffLine[] | null => {
	const a = linesOf(before)
	const b = linesOf(after)

	// Trim the common head and tail first: most revisions change a little in the middle.
	let head = 0
	while (head < a.length && head < b.length && a[head] === b[head]) head++
	let tail = 0
	while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++

	const midA = a.slice(head, a.length - tail)
	const midB = b.slice(head, b.length - tail)
	if ((midA.length + 1) * (midB.length + 1) > DIFF_CELL_LIMIT) return null

	// lcs[i][j] = length of the LCS of midA[i:] and midB[j:], in one flat row-major array.
	const width = midB.length + 1
	const lcs = new Uint32Array((midA.length + 1) * width)
	for (let i = midA.length - 1; i >= 0; i--) {
		for (let j = midB.length - 1; j >= 0; j--) {
			lcs[i * width + j] =
				midA[i] === midB[j]
					? (lcs[(i + 1) * width + j + 1] ?? 0) + 1
					: Math.max(lcs[(i + 1) * width + j] ?? 0, lcs[i * width + j + 1] ?? 0)
		}
	}

	const middle: DiffLine[] = []
	let i = 0
	let j = 0
	while (i < midA.length && j < midB.length) {
		if (midA[i] === midB[j]) {
			middle.push({ kind: "same", text: midA[i] ?? "" })
			i++
			j++
		} else if ((lcs[(i + 1) * width + j] ?? 0) >= (lcs[i * width + j + 1] ?? 0)) {
			middle.push({ kind: "removed", text: midA[i] ?? "" })
			i++
		} else {
			middle.push({ kind: "added", text: midB[j] ?? "" })
			j++
		}
	}
	for (; i < midA.length; i++) middle.push({ kind: "removed", text: midA[i] ?? "" })
	for (; j < midB.length; j++) middle.push({ kind: "added", text: midB[j] ?? "" })

	const same = (text: string): DiffLine => ({ kind: "same", text })
	return [...a.slice(0, head).map(same), ...middle, ...a.slice(a.length - tail).map(same)]
}
