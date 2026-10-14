import { useState } from "react"

import { useComments, useCreateComment } from "@/features/artifact/hooks/useComments"
import { formatWhen } from "@/utils/format"

/** The panel body only; the side panel around it owns the header, the width and the border. */
export const CommentsPanel = ({ artifactId }: { artifactId: string }) => {
	const thread = useComments(artifactId)
	const create = useCreateComment(artifactId)
	const [draft, setDraft] = useState("")

	const submit = () => {
		const body = draft.trim()
		if (body === "" || !thread.data) return
		create.mutate({ revisionId: thread.data.revisionId, body }, { onSuccess: () => setDraft("") })
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<p className="mono-kicker px-4 pt-4">on the Revision you are reading</p>

			<ol className="min-h-0 flex-1 overflow-y-auto p-4">
				{thread.isError ? (
					<li role="alert" className="text-muted text-sm">
						{thread.error.message}
					</li>
				) : null}
				{thread.data?.items.length === 0 ? <li className="text-muted text-[15px]">No Comments yet.</li> : null}
				{thread.data?.items.map((comment) => (
					<li key={comment.id} className="mb-4">
						<p className="text-[13px]">
							<span className="font-medium">{comment.authorName}</span>
							<span className="text-muted ml-2">{formatWhen(comment.createdAt)}</span>
						</p>
						<p className="mt-1 text-[15px] whitespace-pre-line">{comment.body}</p>
					</li>
				))}
			</ol>

			<div className="border-t border-line p-3">
				<label className="sr-only" htmlFor="comment-body">
					Write a Comment
				</label>
				<textarea
					id="comment-body"
					className="h-20 w-full resize-none border border-line-soft bg-white p-2 text-[15px] outline-none focus:border-ink"
					placeholder="Write a Comment"
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit()
					}}
				/>
				{create.isError ? (
					<p role="alert" className="text-danger mt-1 text-xs">
						{create.error.message}
					</p>
				) : null}
				<button
					type="button"
					className="press bg-primary text-white hover:bg-primary-hover mt-2 flex h-10 w-full items-center justify-center text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
					disabled={draft.trim() === "" || !thread.data || create.isPending}
					onClick={submit}
				>
					{create.isPending ? "Posting…" : "Post"}
				</button>
			</div>
		</div>
	)
}
