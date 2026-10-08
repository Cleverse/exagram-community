import { type Connection } from "@exagram/api-client"

import { MobileScreen, PushHeader } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { useToast } from "@/components/Toast"
import { IconPlus } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { MCP_SERVER_URL } from "@/config/env"
import { clientLook, CONNECTION_KIND, formatConnectedDate, isStale } from "@/features/connections/clientMeta"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { paths } from "@/routes/paths"

/**
 * One client card (W:L466–469): a 40px initials tile in the client's colours, its name, and what it is. The
 * design's "used 2h ago" needs a last-use time the API does not record, so the line says when it was
 * connected instead.
 */
const ClientCard = ({ connection, onOpen }: { connection: Connection; onOpen: () => void }) => {
	const look = clientLook(connection.name)
	return (
		<button
			type="button"
			onClick={onOpen}
			className="flex items-center border border-card-line text-left active:bg-row-hover"
			style={{ gap: 12, padding: 12, borderRadius: 10 }}
		>
			<span
				aria-hidden
				className="grid flex-none place-items-center border border-card-line"
				style={{
					width: 40,
					height: 40,
					borderRadius: 8,
					background: look.iconBg,
					color: look.rowFg,
					fontSize: 12,
					fontWeight: 600,
				}}
			>
				{look.initials}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate" style={{ fontSize: 15, fontWeight: 500 }}>
					{connection.name}
				</span>
				<span className="block truncate text-muted-2" style={{ fontSize: 12.5 }}>
					{isStale(connection)
						? "No Artifacts access — reconnect to grant it"
						: `${CONNECTION_KIND} · connected ${formatConnectedDate(connection.createdAt)}`}
				</span>
			</span>
		</button>
	)
}

/**
 * MCP clients (`/connections`, W:L457–476), pushed from the Account drawer: "Back to Exagram", the list of
 * connected clients, each opening the Client drawer, and Connect a client. A phone can't run the desktop's
 * setup steps, so Connect copies the server URL to paste into the client.
 */
export default function ConnectionsPageMobile() {
	const connections = useConnections()
	const sheet = useSheet()
	const toast = useToast()

	const live = (connections.data ?? []).filter((connection) => connection.revokedAt === null)

	const copyServerUrl = () =>
		void navigator.clipboard.writeText(MCP_SERVER_URL).then(
			() => toast("Server URL copied. Add it to your AI client as a custom connector."),
			() => toast(`Could not copy. The server URL is ${MCP_SERVER_URL}`),
		)

	return (
		<MobileScreen
			push
			label="MCP clients"
			header={<PushHeader to={paths.library} backLabel="Back to Exagram" />}
			bodyStyle={{ padding: "18px 16px 40px" }}
		>
			<h1 className="m-0" style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.012em" }}>
				MCP clients
			</h1>
			<p className="m-0 text-pretty text-muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 6 }}>
				Tools that read your artifacts through the workspace policy. Tap one to change what it can reach.
			</p>

			{connections.isPending ? (
				<SkeletonStatus label="Loading connected clients…" className="flex flex-col" style={{ gap: 8, marginTop: 18 }}>
					{[0, 1, 2].map((index) => (
						<div
							key={index}
							className="flex items-center border border-card-line"
							style={{ gap: 12, padding: 12, borderRadius: 10 }}
						>
							<Skeleton width={40} height={40} radius={8} />
							<span className="flex min-w-0 flex-1 flex-col" style={{ gap: 6 }}>
								<Skeleton width={["40%", "52%", "34%"][index]} height={13} />
								<Skeleton width={["62%", "48%", "56%"][index]} height={10} />
							</span>
						</div>
					))}
				</SkeletonStatus>
			) : connections.isError ? (
				<p role="alert" className="text-danger" style={{ fontSize: 14, marginTop: 18 }}>
					{connections.error.message}
				</p>
			) : live.length === 0 ? (
				<div
					className="border border-dashed border-line-strong text-center text-muted"
					style={{ marginTop: 18, padding: "28px 16px", borderRadius: 10, fontSize: 14, lineHeight: 1.5 }}
				>
					No clients connected yet. Connect one below — it reaches everything you can, limited only by the Scopes you
					grant and by revoke.
				</div>
			) : (
				<div className="flex flex-col" style={{ gap: 8, marginTop: 18 }}>
					{live.map((connection) => (
						<ClientCard
							key={connection.id}
							connection={connection}
							onOpen={() => sheet.open("client", { connectionId: connection.id })}
						/>
					))}
				</div>
			)}

			<button
				type="button"
				onClick={copyServerUrl}
				className="flex w-full items-center justify-center border border-line-strong text-ink active:bg-hover"
				style={{ marginTop: 14, height: 46, gap: 8, fontSize: 14.5, fontWeight: 500 }}
			>
				<IconPlus size={16} />
				Connect a client
			</button>
		</MobileScreen>
	)
}
