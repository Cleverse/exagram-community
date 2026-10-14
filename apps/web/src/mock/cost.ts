/**
 * The prototype's sample cost model (Exagram Team.dc.html line 1160):
 * `tokens_in × $0.0000025 + tokens_out × $0.00001 + redacted_spans × $0.0012`.
 * Real pricing replaces this when the API grows a cost field.
 */
export const cost = (tokensIn: number, tokensOut: number, redactedSpans: number): number =>
	tokensIn * 0.0000025 + tokensOut * 0.00001 + redactedSpans * 0.0012

/** `$0.000` for a free request, three decimals otherwise — the prototype's `USD`. */
export const usd = (amount: number): string => (amount === 0 ? "$0.000" : `$${amount.toFixed(3)}`)

/** "52.6k" for the TOKENS SERVED card; below 1000 the raw count is shown. */
export const tokens = (total: number): string => (total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total))

/**
 * "$0.018 · redaction $0.002 · serving $0.015" — the expanded audit row's cost breakdown. With redaction off
 * there is no redaction part and no redaction cost.
 */
export const costBreakdown = (
	tokensIn: number,
	tokensOut: number,
	redactedSpans: number,
	redactionOn = true,
): string => {
	const spans = redactionOn ? redactedSpans : 0
	const serving = usd(tokensIn * 0.0000025 + tokensOut * 0.00001)
	return redactionOn
		? `${usd(cost(tokensIn, tokensOut, spans))} · redaction ${usd(spans * 0.0012)} · serving ${serving}`
		: `${usd(cost(tokensIn, tokensOut, 0))} · serving ${serving}`
}
