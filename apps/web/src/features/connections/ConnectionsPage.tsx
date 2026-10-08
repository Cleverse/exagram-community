import { type Connection } from "@exagram/api-client"
import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { SectionRule } from "@/components/ui/Mono"
import { PageContainer } from "@/components/ui/PageContainer"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { clientLook, CONNECTION_KIND, isStale, mockLastUsed } from "@/features/connections/clientMeta"
import { ConnectionDetailDialog } from "@/features/connections/ConnectionDetailDialog"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { McpSetupCard } from "@/features/connections/McpSetupCard"

const ConnectionRow = ({ connection, onSelect }: { connection: Connection; onSelect: () => void }) => {
	const look = clientLook(connection.name)
	const stale = isStale(connection)

	const badge = {
		label: connection.folderAccess === "named" ? `${connection.folderCount} folders` : "All folders",
		bg: "var(--color-chip)",
		fg: "var(--color-secondary-2)",
	}

	return (
		<button
			type="button"
			className="flex items-center gap-4 border-b border-b-line-pale px-5 py-4 text-left hover:bg-surface-soft"
			onClick={onSelect}
		>
			<span
				className="font-mono grid size-11 flex-none place-items-center text-[13px] font-medium"
				style={{ background: look.iconBg, color: look.rowFg }}
			>
				{look.initials}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-[17px] font-semibold">{connection.name}</span>
				<span className="mt-[2px] block truncate text-[14px] text-muted">
					{stale
						? "No Artifacts access — reconnect to grant it"
						: `${CONNECTION_KIND} · last used ${mockLastUsed(connection.id)} ago`}
				</span>
			</span>
			<span
				className="flex-none px-[9px] py-[3px] text-[13px] font-semibold whitespace-nowrap"
				style={{ background: badge.bg, color: badge.fg }}
			>
				{badge.label}
			</span>
		</button>
	)
}

/** Presentational only, so the list rendering (count, empty state) is testable without a server. */
export const ConnectionsListView = ({
	connections,
	onSelect,
}: {
	connections: Connection[]
	onSelect: (connectionId: string) => void
}) => (
	<>
		<SectionRule style={{ marginTop: 36 }}>Connected clients · {connections.length}</SectionRule>

		{connections.length === 0 ? (
			<div className="mt-5 border border-dashed border-line-strong p-10 text-center text-[16px] text-muted">
				No clients connected yet. Connect one below — it reaches everything you can, limited only by the Scopes you
				grant and by revoke.
			</div>
		) : (
			<div className="mt-5 flex flex-col gap-[2px] overflow-hidden border border-card-line bg-white">
				{connections.map((connection) => (
					<ConnectionRow key={connection.id} connection={connection} onSelect={() => onSelect(connection.id)} />
				))}
			</div>
		)}
	</>
)

/** Placeholder rows in the list's card, shaped like `ConnectionRow`, while the connections load. */
const ConnectionsListSkeleton = () => (
	<>
		<SectionRule style={{ marginTop: 36 }}>Connected clients · …</SectionRule>
		<SkeletonStatus
			label="Loading connected clients…"
			className="mt-5 flex flex-col gap-[2px] overflow-hidden border border-card-line bg-white"
		>
			{[0, 1, 2].map((index) => (
				<div key={index} className="flex items-center gap-4 border-b border-b-line-pale px-5 py-4">
					<Skeleton width={44} height={44} radius={0} />
					<span className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton width={["34%", "46%", "28%"][index]} height={14} />
						<Skeleton width={["52%", "40%", "58%"][index]} height={11} />
					</span>
					<Skeleton width={84} height={22} radius={0} />
				</div>
			))}
		</SkeletonStatus>
	</>
)

/** The live connections, and the one whose detail dialog is open. The page and the dialog share it. */
const useConnectionsView = () => {
	const connections = useConnections()
	const [selectedId, setSelectedId] = useState<string | null>(null)

	const live = (connections.data ?? []).filter((connection) => connection.revokedAt === null)
	const selected = live.find((connection) => connection.id === selectedId) ?? null
	return { connections, live, selected, select: setSelectedId }
}

/** The intro, the connected clients and the setup card: the page's body, and the dialog's. */
const ConnectionsBody = ({ view }: { view: ReturnType<typeof useConnectionsView> }) => {
	const { connections, live, select } = view
	return (
		<>
			<div className="flex flex-wrap items-end gap-4">
				<p className="m-0 min-w-[260px] max-w-[720px] flex-1 text-[19px] leading-[1.55] text-pretty text-body">
					Every AI tool connected to your account, and what each one may reach in Artifacts. A client never sees more
					than you do; here you can give one less.
				</p>
			</div>

			{connections.isPending ? (
				<ConnectionsListSkeleton />
			) : connections.isError ? (
				<p role="alert" className="text-danger mt-9 text-sm">
					{connections.error.message}
				</p>
			) : (
				<ConnectionsListView connections={live} onSelect={select} />
			)}

			<SectionRule style={{ marginTop: 44 }}>Connect a new client</SectionRule>
			<McpSetupCard />
		</>
	)
}

export const ConnectionsPage = () => {
	const view = useConnectionsView()

	return (
		<PageContainer width={1040} label="MCP">
			<ConnectionsBody view={view} />
			{view.selected ? <ConnectionDetailDialog connection={view.selected} onClose={() => view.select(null)} /> : null}
		</PageContainer>
	)
}

/**
 * MCP clients as a modal, opened from the account menu over whatever screen is behind it. A client's
 * detail dialog stacks on top; while it is open, Escape closes only that one.
 */
export const ConnectionsDialog = ({ onClose }: { onClose: () => void }) => {
	const view = useConnectionsView()

	return (
		<Dialog
			title="MCP clients"
			width={1040}
			bodyGap={0}
			bodyPadding="24px 32px 40px"
			// Both dialogs hear Escape; the detail dialog, when open, is the one it closes.
			onClose={() => {
				if (!view.selected) onClose()
			}}
		>
			<ConnectionsBody view={view} />
			{view.selected ? <ConnectionDetailDialog connection={view.selected} onClose={() => view.select(null)} /> : null}
		</Dialog>
	)
}
