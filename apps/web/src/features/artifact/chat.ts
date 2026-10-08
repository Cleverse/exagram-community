export type ChatTurn = { question: string; answer: string }

type Message = { role: string; content: string }

const isMessage = (value: unknown): value is Message =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Message).role === "string" &&
	typeof (value as Message).content === "string"

const isTurn = (value: unknown): value is ChatTurn =>
	typeof value === "object" && value !== null && typeof (value as ChatTurn).answer === "string"

/** Consecutive assistant messages are one answer; `system` and `tool` never reach the reader. */
const pairMessages = (messages: Message[]): ChatTurn[] => {
	const turns: ChatTurn[] = []
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue
		if (message.role === "user") {
			turns.push({ question: message.content, answer: "" })
			continue
		}
		const open = turns.at(-1)
		if (!open) {
			turns.push({ question: "", answer: message.content })
			continue
		}
		open.answer = open.answer ? `${open.answer}\n\n${message.content}` : message.content
	}
	return turns
}

export const parseChatBody = (body: string): ChatTurn[] | null => {
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		return null
	}

	const entries = Array.isArray(parsed)
		? parsed
		: typeof parsed === "object" && parsed !== null
			? ((parsed as { turns?: unknown[]; messages?: unknown[] }).turns ?? (parsed as { messages?: unknown[] }).messages)
			: undefined

	if (!Array.isArray(entries) || entries.length === 0) return null
	if (entries.some(isMessage)) return pairMessages(entries.filter(isMessage))
	if (entries.every(isTurn)) return entries.map((turn) => ({ question: turn.question ?? "", answer: turn.answer }))
	return null
}
