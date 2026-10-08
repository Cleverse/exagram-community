import { ACCESS_REQUEST_NOTE_MAX } from "@exagram/api-client"
import { useState } from "react"

import { Button } from "@/components/ui/Button"
import { useRequestAccess } from "@/features/access-requests/hooks/useAccessRequests"

export const REQUEST_SENT = "Request sent. If the owner can share this file with you, they'll see your request."

/**
 * Request access on the refusal screen. It shows for every refused address and asks nothing to decide that,
 * and its answer never says whether the file exists: a refusal says nothing.
 */
export const RequestAccess = ({ artifactId }: { artifactId: string }) => {
	const request = useRequestAccess()
	const [open, setOpen] = useState(false)
	const [note, setNote] = useState("")

	if (request.isSuccess)
		return (
			<p role="status" style={{ marginTop: 12, fontSize: 14, color: "var(--color-secondary)", maxWidth: 420 }}>
				{REQUEST_SENT}
			</p>
		)

	if (!open)
		return (
			<Button variant="outline" size={40} style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
				Request access
			</Button>
		)

	const send = () => {
		const trimmed = note.trim()
		request.mutate({ artifactId, ...(trimmed ? { note: trimmed } : {}) })
	}

	return (
		<form
			className="flex w-full flex-col"
			style={{ marginTop: 12, gap: 8, maxWidth: 420, textAlign: "left" }}
			onSubmit={(event) => {
				event.preventDefault()
				send()
			}}
		>
			<textarea
				aria-label="Note for the owner"
				rows={3}
				value={note}
				maxLength={ACCESS_REQUEST_NOTE_MAX}
				onChange={(event) => setNote(event.target.value)}
				placeholder="Add a note for the owner (optional)"
				className="border border-line-strong bg-white outline-none focus:border-ink"
				style={{ padding: "10px 12px", fontSize: 15, lineHeight: 1.5, resize: "none" }}
			/>
			<div className="flex items-center" style={{ gap: 8 }}>
				<span className="font-mono flex-1 text-muted-2" style={{ fontSize: 11.5 }}>
					{`${note.length}/${ACCESS_REQUEST_NOTE_MAX}`}
				</span>
				<Button type="button" variant="quiet" size={36} onClick={() => setOpen(false)}>
					Cancel
				</Button>
				<Button type="submit" size={36} disabled={request.isPending}>
					Send request
				</Button>
			</div>
			{request.isError ? (
				<p role="alert" className="m-0 text-danger" style={{ fontSize: 13 }}>
					{request.error.message}
				</p>
			) : null}
		</form>
	)
}
