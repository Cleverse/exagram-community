import { useNavigate } from "react-router"

import { SheetRow, SheetRows, SheetSeparator } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { IconLogout, IconPlug, IconSliders } from "@/components/ui/icons"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignOut } from "@/features/auth/hooks/useSignIn"
import { useConnections } from "@/features/connections/hooks/useConnections"
import { paths } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"

/**
 * The Account drawer (W:L629–650, C:L1457–1476): the signed-in person, then MCP clients and Settings, then
 * Sign out. Switch organization is left out, as on desktop's account menu: a person belongs to one Workspace
 * (ADR 0020). Both links navigate, and the drawer closes itself on the path change. It takes no params.
 */
export default function AccountSheet() {
	const me = useMe()
	const connections = useConnections()
	const signOut = useSignOut()
	const sheet = useSheet()
	const navigate = useNavigate()

	// The count waits for the list: a "0" while it loads would be a claim, not a number.
	const clientCount = connections.data?.filter((connection) => connection.revokedAt === null).length

	return (
		<Sheet title="Account">
			<div className="flex items-center" style={{ gap: 12, padding: "6px 16px 10px" }}>
				<span
					aria-hidden
					className="grid flex-none place-items-center bg-accent text-white"
					style={{ width: 40, height: 40, borderRadius: "50%", fontSize: 13, fontWeight: 600 }}
				>
					{initialsOf(me.data?.name, me.data?.email)}
				</span>
				<div className="min-w-0">
					<div className="truncate" style={{ fontSize: 15, fontWeight: 600 }}>
						{me.data?.name}
					</div>
					<div className="truncate text-muted" style={{ fontSize: 13 }}>
						{me.data?.email}
					</div>
				</div>
			</div>
			<SheetRows>
				<SheetRow
					icon={<IconPlug />}
					label="MCP clients"
					value={clientCount === undefined ? undefined : String(clientCount)}
					chevron
					onClick={() => void navigate(paths.connections)}
				/>
				<SheetRow
					icon={<IconSliders />}
					label="Settings"
					chevron
					onClick={() => void navigate(paths.settings("general"))}
				/>
				<SheetSeparator />
				<SheetRow
					icon={<IconLogout />}
					label="Sign out"
					danger
					disabled={signOut.isPending}
					onClick={() => signOut.mutate(undefined, { onSuccess: sheet.close })}
				/>
			</SheetRows>
		</Sheet>
	)
}
