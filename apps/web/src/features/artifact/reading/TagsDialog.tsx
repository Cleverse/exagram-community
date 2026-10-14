import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { useTags } from "@/features/artifact/reading/useTags"

/** "Tags…" from the preview pane's menu: the same owner-written tags the reading toolbar edits. */
export const TagsDialog = ({
	artifactId,
	title,
	onClose,
}: {
	artifactId: string
	title: string
	onClose: () => void
}) => {
	const { tags, add, remove } = useTags(artifactId)
	const [draft, setDraft] = useState("")

	const commit = () => {
		add(draft)
		setDraft("")
	}

	return (
		<Dialog
			title="Tags"
			onClose={onClose}
			width={480}
			bodyGap={12}
			helper="Tags are owner-written and visible to anyone who can see the file."
			footer={
				<Button variant="primary" size={40} onClick={onClose}>
					Done
				</Button>
			}
		>
			<div className="truncate" style={{ fontSize: 14, color: "var(--color-muted)" }}>
				{title}
			</div>
			<div className="flex items-center" style={{ gap: 8 }}>
				<label className="sr-only" htmlFor="pane-tag">
					Add a tag
				</label>
				<input
					id="pane-tag"
					value={draft}
					autoFocus
					placeholder="Add a tag"
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter") commit()
					}}
					className="min-w-0 flex-1 border border-line-soft bg-white outline-none focus:border-ink focus:shadow-[0_0_0_1px_var(--color-ink)]"
					style={{ height: 40, padding: "0 12px", fontSize: 15 }}
				/>
				<Button variant="outline" size={40} disabled={draft.trim() === ""} onClick={commit}>
					Add
				</Button>
			</div>
			{tags.length === 0 ? (
				<p style={{ fontSize: 14, color: "var(--color-muted)" }}>No tags yet.</p>
			) : (
				<ul className="flex flex-wrap" style={{ gap: 8 }}>
					{tags.map((tag) => (
						<li
							key={tag}
							className="flex items-center"
							style={{
								gap: 6,
								height: 32,
								padding: "0 6px 0 12px",
								background: "var(--color-chip)",
								fontSize: 14,
							}}
						>
							{tag}
							<button
								type="button"
								aria-label={`Remove tag ${tag}`}
								onClick={() => remove(tag)}
								className="grid place-items-center hover:bg-white"
								style={{ width: 22, height: 22, color: "var(--color-muted)" }}
							>
								×
							</button>
						</li>
					))}
				</ul>
			)}
		</Dialog>
	)
}
