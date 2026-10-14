import { type Connection } from "@exagram/api-client"
import { type ReactNode, useState } from "react"

import { Dialog } from "@/components/Dialog"
import { IconCheckBold, IconCheckCircle, IconClose } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { clientLook, CONNECTION_KIND } from "@/features/connections/clientMeta"
import { ConnectionFoldersDialog } from "@/features/connections/ConnectionFoldersDialog"
import { useConnectionDetail } from "@/features/connections/useConnectionDetail"

const sectionHeadingClass = "font-display text-[20px] font-semibold"

/** Presentational only, so the capability list, access line and redaction choice are testable without a server. */
export const ConnectionDetailDialogView = ({
	name,
	scopeLabels,
	stale,
	connectedLabel,
	redactionPicker,
	onReconnect,
	onRevoke,
	onClose,
	reachLabel,
	reconnectFolderNote,
	onChangeFolders,
}: {
	name: string
	scopeLabels: string[]
	stale: boolean
	connectedLabel: string
	/** The edition's redaction block for this Connection; null when it has none. */
	redactionPicker: ReactNode
	onReconnect: () => void
	onRevoke: () => void
	onClose: () => void
	reachLabel: string
	reconnectFolderNote: string | null
	onChangeFolders: () => void
}) => {
	const look = clientLook(name)

	return (
		// `bare`: the prototype's client detail has no Screen 2 header strip, and its close button sits
		// over the card. `position:relative` is what anchors that button to the card.
		<Dialog
			ariaLabel={name}
			onClose={onClose}
			width={760}
			scrim={0.55}
			surface="var(--color-ground-raised)"
			bare
			cardStyle={{ position: "relative", padding: "36px 40px 40px" }}
		>
			<button
				type="button"
				aria-label="Close"
				className="absolute top-[22px] right-[22px] grid size-9 place-items-center text-secondary hover:bg-chip"
				onClick={onClose}
			>
				<IconClose />
			</button>

			<div className="flex items-start gap-5 pr-10">
				<span
					className="font-mono grid size-[72px] flex-none place-items-center text-[18px] font-medium"
					style={{ background: look.iconBg, color: look.detailFg }}
				>
					{look.initials}
				</span>
				<div className="min-w-0">
					<div className="font-display text-[32px] leading-[1.1] font-bold tracking-[-.02em]">{name}</div>
					<div className="mt-2.5 flex flex-wrap items-center gap-3 text-[16px] text-secondary">
						<span>{CONNECTION_KIND}</span>
						<span className="bg-chip px-[9px] py-[3px] text-[13px] font-semibold">OAuth</span>
						<span className="flex items-center gap-1.5 font-medium text-ink">
							<IconCheckCircle style={{ color: "var(--color-link)" }} />
							Connected
						</span>
					</div>
				</div>
			</div>

			<div className="mt-6 text-[17px] text-secondary">Connected {connectedLabel} · acts only as you.</div>

			{stale ? (
				<div className="mt-6 flex items-center gap-[14px] border border-gold-line bg-gold-bg px-5 py-4 text-[15px] leading-[1.5] text-gold-fg">
					<span className="size-[9px] flex-none bg-gold-fg" />
					<span className="flex-1">
						Connected before Shares existed — it cannot reach Shares until you reconnect and approve it.
					</span>
					<button
						type="button"
						className="press bg-primary text-white hover:bg-primary-hover h-9 px-[14px] text-[14px] font-semibold whitespace-nowrap"
						onClick={onReconnect}
					>
						Reconnect
					</button>
				</div>
			) : null}

			<div className={`${sectionHeadingClass} mt-9`}>Capabilities</div>
			<div className="mt-3.5 flex flex-col gap-2.5">
				{scopeLabels.map((label) => (
					<div key={label} className="flex items-center gap-3 text-[17px] text-ink">
						<IconCheckBold style={{ color: "var(--color-link)" }} />
						<span>{label}</span>
					</div>
				))}
			</div>
			<div className="mt-3 text-[15px] text-muted">{reachLabel}</div>
			<div className="mt-3 text-[15px] text-muted">
				Missing something?{" "}
				<button
					type="button"
					className="font-semibold text-link hover:text-link-hover hover:underline"
					onClick={onReconnect}
				>
					Reconnect
				</button>{" "}
				and approve it on the consent screen — permissions never arrive quietly.
			</div>
			{reconnectFolderNote ? <div className="mt-2 text-[15px] text-muted">{reconnectFolderNote}</div> : null}

			<div className="mt-8 flex items-center justify-between gap-4">
				<div className={sectionHeadingClass}>Folder access</div>
				<button
					type="button"
					className="h-10 border border-line-strong bg-white px-[14px] text-[15px] hover:bg-surface"
					onClick={onChangeFolders}
				>
					Change
				</button>
			</div>

			{redactionPicker}

			<hr className="my-9 border-0 border-t border-line" />

			<div className="font-display text-[22px] font-semibold">Danger zone</div>
			<div className="mt-[18px] flex flex-wrap items-center gap-5">
				<div className="min-w-[240px] flex-1">
					<div className="text-[17px] font-semibold">Revoke this connection</div>
					<div className="mt-1 text-[15px] leading-[1.5] text-muted">
						Its next request is refused. Artifacts it wrote stay yours; your other Connections are untouched.
					</div>
				</div>
				<button
					type="button"
					className="h-11 bg-html-bg px-[18px] text-[16px] font-semibold whitespace-nowrap text-danger hover:bg-html-bg"
					onClick={onRevoke}
				>
					Revoke
				</button>
			</div>
		</Dialog>
	)
}

export const ConnectionDetailDialog = ({ connection, onClose }: { connection: Connection; onClose: () => void }) => {
	const detail = useConnectionDetail(connection, { onRevoked: onClose })
	const [foldersOpen, setFoldersOpen] = useState(false)

	return (
		<>
			<ConnectionDetailDialogView
				name={detail.name}
				scopeLabels={detail.scopes.map((entry) => entry.label)}
				stale={detail.stale}
				connectedLabel={detail.connectedLabel}
				redactionPicker={
					edition.ConnectionRedactionPicker && (
						<edition.ConnectionRedactionPicker connection={connection} variant="desktop" />
					)
				}
				onReconnect={detail.reconnect}
				onRevoke={detail.revoke}
				onClose={onClose}
				reachLabel={detail.reachLabel}
				reconnectFolderNote={detail.reconnectFolderNote}
				onChangeFolders={() => setFoldersOpen(true)}
			/>
			{foldersOpen ? (
				<ConnectionFoldersDialog
					connectionId={connection.id}
					clientName={connection.name}
					onClose={() => setFoldersOpen(false)}
				/>
			) : null}
		</>
	)
}
