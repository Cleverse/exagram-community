import clsx from "clsx"
import { useState } from "react"
import { useNavigate } from "react-router"

import { Avatar } from "@/components/ui/Avatar"
import { IconChevronsUpDown } from "@/components/ui/icons"
import { Menu, type MenuItem } from "@/components/ui/Menu"
import { edition } from "@/edition/edition"
import { useMe } from "@/features/auth/hooks/useMe"
import { useSignOut } from "@/features/auth/hooks/useSignIn"
import { ConnectionsDialog } from "@/features/connections/ConnectionsPage"
import { paths } from "@/routes/paths"
import { initialsOf } from "@/utils/initials"

export const AccountMenu = ({ compact = false }: { compact?: boolean }) => {
	const me = useMe()
	const signOut = useSignOut()
	const navigate = useNavigate()
	const [anchor, setAnchor] = useState<DOMRect | null>(null)
	const [mcpOpen, setMcpOpen] = useState(false)

	const initials = initialsOf(me.data?.name, me.data?.email)
	// AuthGuard renders the shell only once `me` has loaded, so the Workspace's name is always there.
	const organization = me.data?.workspaceName ?? ""
	const close = () => setAnchor(null)
	const orgLine = edition.copy.accountWorkspace(organization)
	const go = (to: string) => () => {
		close()
		void navigate(to)
	}

	const items: MenuItem[] = [
		{
			label: "MCP clients",
			onSelect: () => {
				close()
				setMcpOpen(true)
			},
		},
		{ label: "Settings", onSelect: go(paths.settings("general")) },
		{
			label: "Sign out",
			onSelect: () => {
				close()
				signOut.mutate()
			},
		},
	]

	return (
		<>
			{compact ? (
				<button
					type="button"
					title="Account"
					aria-label="Account"
					aria-haspopup="menu"
					aria-expanded={anchor !== null}
					onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
					className="press grid flex-none place-items-center"
				>
					<Avatar initials={initials} background="var(--color-accent)" square />
				</button>
			) : (
				<button
					type="button"
					title="Account"
					aria-label="Account"
					aria-haspopup="menu"
					aria-expanded={anchor !== null}
					onClick={(event) => setAnchor(event.currentTarget.getBoundingClientRect())}
					className={clsx(
						"flex w-full items-center text-left transition-colors duration-(--duration-row) ease-(--ease-arrive)",
						anchor ? "bg-hover" : "hover:bg-hover",
					)}
					style={{ gap: 10, height: 48, padding: "0 8px" }}
				>
					<Avatar initials={initials} square className="flex-none" />
					<span className="min-w-0 flex-1">
						<span className="block truncate" style={{ fontSize: 14, fontWeight: 600 }}>
							{me.data?.name}
						</span>
						{orgLine ? (
							<span className="block truncate text-muted" style={{ fontSize: 12 }}>
								{orgLine}
							</span>
						) : null}
					</span>
					<IconChevronsUpDown size={14} className="flex-none text-secondary" />
				</button>
			)}

			{anchor ? (
				<Menu anchor={anchor} placement="up" width={260} ariaLabel="Account" onClose={close} items={items} />
			) : null}

			{mcpOpen ? <ConnectionsDialog onClose={() => setMcpOpen(false)} /> : null}
		</>
	)
}
