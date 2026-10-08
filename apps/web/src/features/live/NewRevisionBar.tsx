/**
 * A quiet line over the body: a newer Current Revision is served, and View moves to it. It arrives while someone
 * is reading, so it grows open rather than pushing the document down in one frame.
 */
export const NewRevisionBar = ({ onView }: { onView: () => void }) => (
	<div role="status" className="grid flex-none" style={{ animation: "revealRow 200ms var(--ease-arrive)" }}>
		<div className="min-h-0 overflow-hidden">
			<div className="flex items-center gap-3 border-b border-pane-line bg-surface px-4 py-2 text-sm">
				<span className="size-2 shrink-0 bg-accent" aria-hidden />
				<span className="text-secondary">New Revision available</span>
				<button
					type="button"
					onClick={onView}
					className="press ml-auto border border-line-strong bg-panel px-3 py-1 font-medium text-ink hover:bg-hover"
				>
					View
				</button>
			</div>
		</div>
	</div>
)
