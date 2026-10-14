import { type Connection } from "@exagram/api-client"

import { SectionLabel } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { IconCheckBold } from "@/components/ui/icons"
import { Skeleton, SkeletonStatus } from "@/components/ui/Skeleton"
import { edition } from "@/edition/edition"
import { CONNECTION_KIND } from "@/features/connections/clientMeta"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { useConnectionDetail } from "@/features/connections/useConnectionDetail"

/** The drawer's section heads sit flush in its padded column. */
const labelStyle = { padding: 0 }

const ClientDetail = ({ connection }: { connection: Connection }) => {
	const sheet = useSheet()
	const detail = useConnectionDetail(connection, { onRevoked: sheet.close })

	return (
		<Sheet title={detail.name} sub={CONNECTION_KIND}>
			<div className="flex flex-col" style={{ padding: "4px 16px 12px", gap: 18 }}>
				<div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
					Connected {detail.connectedLabel} · acts only as you.
				</div>

				{detail.stale ? (
					<div
						className="flex items-center border border-gold-line bg-gold-bg text-gold-fg"
						style={{ gap: 12, padding: "12px 14px", borderRadius: 10, fontSize: 13.5, lineHeight: 1.5 }}
					>
						<span className="flex-1">
							Connected before Shares existed — it cannot reach Shares until you reconnect and approve it.
						</span>
						<button
							type="button"
							onClick={detail.reconnect}
							className="flex-none bg-ink text-white active:bg-primary-hover"
							style={{ height: 36, padding: "0 12px", fontSize: 13.5, fontWeight: 500 }}
						>
							Reconnect
						</button>
					</div>
				) : null}

				<section aria-label="Scopes">
					<SectionLabel style={labelStyle}>Scopes</SectionLabel>
					{detail.scopes.length === 0 ? (
						<div className="text-muted" style={{ fontSize: 13, lineHeight: 1.45, paddingTop: 8 }}>
							None yet. Reconnect to grant them on the consent screen.
						</div>
					) : (
						detail.scopes.map((entry) => (
							<div key={entry.scope} className="flex" style={{ gap: 10, padding: "10px 0" }}>
								<IconCheckBold size={15} className="flex-none text-green-fg" style={{ marginTop: 2 }} />
								<div>
									<div className="font-mono" style={{ fontSize: 13, fontWeight: 500 }}>
										{entry.scope}
									</div>
									<div className="text-muted" style={{ fontSize: 13, lineHeight: 1.45, marginTop: 2 }}>
										{entry.label}
									</div>
								</div>
							</div>
						))
					)}
				</section>

				<section aria-label="Folder access">
					<SectionLabel style={labelStyle}>Folder access</SectionLabel>
					<div className="flex items-start justify-between" style={{ gap: 12, marginTop: 8 }}>
						<div style={{ fontSize: 14.5, lineHeight: 1.5 }}>{detail.reachLabel}</div>
						<button
							type="button"
							onClick={() =>
								sheet.push("clientFolders", { connectionId: connection.id, connectionName: connection.name })
							}
							className="flex-none font-semibold text-link active:text-link-hover"
							style={{ fontSize: 14.5, lineHeight: 1.5 }}
						>
							Change
						</button>
					</div>
					{detail.reconnectFolderNote ? (
						<div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
							{detail.reconnectFolderNote}
						</div>
					) : null}
				</section>

				{edition.ConnectionRedactionPicker && (
					<edition.ConnectionRedactionPicker connection={connection} variant="mobile" />
				)}

				<button
					type="button"
					onClick={detail.revoke}
					disabled={detail.revoking}
					className="bg-danger-bg text-danger active:bg-danger-hover disabled:opacity-60"
					style={{ height: 44, fontSize: 14.5, fontWeight: 500 }}
				>
					Revoke access
				</button>
			</div>
		</Sheet>
	)
}

/**
 * The Connection drawer: what one Connection holds and may reach, its redaction and
 * Revoke. The design's "last used" line is left out: the API records no last use for a Connection.
 */
export default function ClientSheet({ params }: { params: SheetParams["client"] }) {
	const connections = useConnections()
	const connection = connections.data?.find((entry) => entry.id === params.connectionId && entry.revokedAt === null)

	if (connection) return <ClientDetail connection={connection} />

	return (
		<Sheet title="Connection">
			<div style={{ padding: "4px 16px 12px" }}>
				{connections.isPending ? (
					<SkeletonStatus label="Loading the Connection…" className="flex flex-col" style={{ gap: 10 }}>
						<Skeleton width="60%" height={12} />
						<Skeleton width="80%" height={12} />
					</SkeletonStatus>
				) : connections.isError ? (
					<p role="alert" className="text-danger" style={{ fontSize: 14, margin: 0 }}>
						{connections.error.message}
					</p>
				) : (
					<p className="text-muted" style={{ fontSize: 14, margin: 0 }}>
						This Connection was revoked or is not in this Workspace.
					</p>
				)}
			</div>
		</Sheet>
	)
}
