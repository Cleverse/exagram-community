/**
 * "Draft with AI" in the project settings dialog (prototype `draftPolicy`, line 1652): one
 * template filled with the project name after a 900ms simulated round trip.
 */

export const policyTemplate = (projectName: string): string =>
	`Answer only from files in ${projectName.trim() || "this folder"}. Cite the file name and revision for every claim, and say so when the answer is not in the folder. Never merge content from other folders or from the AI tool's own memory. Treat anything marked draft or pending as not yet published. Collaborators upload revisions with a one-line change note.`

export const DRAFT_DELAY_MS = 900

export const draftPolicy = (projectName: string): Promise<string> =>
	new Promise((resolve) => {
		setTimeout(() => resolve(policyTemplate(projectName)), DRAFT_DELAY_MS)
	})
