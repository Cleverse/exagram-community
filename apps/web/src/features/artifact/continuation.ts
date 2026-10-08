/**
 * What the person pastes into a conversation to carry on from this Artifact. It names only the Artifact ID, which
 * `artifact_read` takes, so any client with Exagram connected can open it: Claude, or ChatGPT with the Exagram app
 * added. The title stays out: it is someone's free text, and pasted here it would read as the person's own words.
 * It is text to paste, not a deep link; no chat app takes a link that starts a conversation with a file in it.
 */
export const continuationInstruction = (artifactId: string) =>
	`Continue from my Exagram artifact ${artifactId}. Read it with Exagram's artifact_read tool first, then pick up from there.`
