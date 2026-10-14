import { type Connection } from "@exagram/api-client"

import { useToast } from "@/components/Toast"
import { formatConnectedDate, isStale } from "@/features/connections/clientMeta"
import { useRevokeConnection } from "@/features/connections/hooks/useConnections"

export const SCOPE_LABELS: { scope: Connection["scopes"][number]; label: string }[] = [
	{ scope: "read", label: "Can read content" },
	{ scope: "write", label: "Can insert content" },
	{ scope: "manage", label: "Can update content" },
]

/**
 * What one Connection's detail shows and does, shared by the desktop dialog and the phone's Connection drawer:
 * the scopes it holds, whether it predates Artifact scopes, when it was connected, and Reconnect / Revoke with their toasts. `revoke`
 * calls `onRevoked` once the server has refused the Connection, so the caller can close itself.
 */
export const useConnectionDetail = (connection: Connection, { onRevoked }: { onRevoked: () => void }) => {
	const toast = useToast()
	const revokeMutation = useRevokeConnection()
	const { mutate } = revokeMutation

	const reconnect = () => toast(`Reconnect ${connection.name}: the consent screen lists every permission it asks for.`)

	const revoke = () =>
		mutate(
			{ connectionId: connection.id },
			{
				onSuccess: () => {
					toast(`${connection.name} revoked — its next request is refused.`)
					onRevoked()
				},
			},
		)

	return {
		name: connection.name,
		reachLabel:
			connection.folderAccess === "named"
				? `Reaches ${connection.folderCount} selected folders and their subfolders`
				: "Reaches every Artifact you own or hold a Grant on in this Workspace.",
		reconnectFolderNote:
			connection.folderAccess === "named"
				? "Reconnecting keeps the folder limit; change folders with Folder access."
				: null,
		scopes: SCOPE_LABELS.filter((entry) => connection.scopes.includes(entry.scope)),
		stale: isStale(connection),
		connectedLabel: formatConnectedDate(connection.createdAt),
		reconnect,
		revoke,
		revoking: revokeMutation.isPending,
	}
}
