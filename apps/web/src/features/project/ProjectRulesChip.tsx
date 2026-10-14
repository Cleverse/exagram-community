import { type Project } from "@exagram/api-client"
import clsx from "clsx"
import { type ReactNode, useRef, useState } from "react"

import { Dialog } from "@/components/Dialog"
import { Button } from "@/components/ui/Button"
import { IconCheck, IconShield, IconUpload } from "@/components/ui/icons"
import { edition } from "@/edition/edition"
import { publishPolicyLabel } from "@/features/project/publishPolicy"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"
import { useProjectSettings } from "@/mock/projectSettings"

const Rule = ({
	icon,
	label,
	local = false,
	children,
}: {
	icon: ReactNode
	label: string
	/** A value only this browser holds (the settings dialog's local store), so it says so. */
	local?: boolean
	children: ReactNode
}) => (
	<div className="grid" style={{ gridTemplateColumns: "16px minmax(0,1fr)", gap: "4px 10px", padding: "14px 10px" }}>
		<span className="text-muted" style={{ marginTop: 2 }}>
			{icon}
		</span>
		<div>
			<div className="text-muted" style={{ fontSize: 12 }}>
				{label}
				{local ? " · Saved in this browser" : null}
			</div>
			<div style={{ fontSize: 14, lineHeight: 1.45, marginTop: 2, textWrap: "pretty" }}>{children}</div>
		</div>
	</div>
)

const Divider = () => <div className="bg-row-line" style={{ height: 1, margin: "0 10px" }} />

/**
 * "Folder rules" under a Project's title: a 28px chip that opens the rules a client follows
 * here in a modal. Only the Owner sees it (the page decides). The publish policy is the Project's real
 * setting; the policy text and the overwrite toggle are the settings dialog's local values until the API
 * has columns for them, and the modal labels them "Saved in this browser".
 *
 * Closing (Escape, the scrim, ×, Close) hands focus back to the chip; Edit settings hands over to the
 * settings dialog instead.
 */
export const ProjectRulesChip = ({ project, onEdit }: { project: Project; onEdit: () => void }) => {
	const settings = useProjectSettings(project.id)
	const { kind } = useWorkspaceOf(project.workspaceId)
	const personal = kind === "personal"
	const local = edition.projectRules
	const [open, setOpen] = useState(false)
	const chipRef = useRef<HTMLButtonElement>(null)

	const policy = local ? settings.policy.trim() : ""
	const close = () => {
		setOpen(false)
		chipRef.current?.focus()
	}

	return (
		<div className="flex items-center" style={{ height: 28 }}>
			<button
				ref={chipRef}
				type="button"
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => setOpen(true)}
				className={clsx(
					"flex items-center whitespace-nowrap text-body transition-colors duration-(--duration-press) ease-(--ease-arrive)",
					open ? "bg-chip" : "bg-hover hover:bg-chip",
				)}
				style={{ gap: 6, height: 28, padding: "0 10px", fontSize: 13 }}
			>
				<IconShield size={14} strokeWidth={1.4} />
				Folder rules
				<span className="font-mono text-muted" style={{ fontSize: 11 }}>
					{(policy ? 1 : 0) + (personal ? 0 : (local ? 1 : 0) + 1)}
				</span>
			</button>

			{open ? (
				<Dialog
					title="Folder rules"
					onClose={close}
					width={480}
					surface="var(--color-panel)"
					bodyPadding="8px 14px"
					bodyGap={0}
					footer={
						<>
							<Button variant="outline" size={36} onClick={close}>
								Close
							</Button>
							<Button
								size={36}
								onClick={() => {
									setOpen(false)
									onEdit()
								}}
							>
								Edit settings
							</Button>
						</>
					}
					helper={project.name}
				>
					{local ? (
						<Rule icon={<IconShield size={14} strokeWidth={1.4} />} label="Policy" local>
							{policy || "No policy — Connections read this folder with Workspace defaults"}
						</Rule>
					) : null}
					{personal ? null : (
						<>
							{local ? (
								<>
									<Divider />
									<Rule icon={<IconUpload size={14} strokeWidth={1.4} />} label="Overwrite" local>
										{settings.overwrite ? "Editors can overwrite" : "Owner-only overwrite"}
									</Rule>
									<Divider />
								</>
							) : null}
							<Rule icon={<IconCheck size={14} strokeWidth={1.4} />} label="Published version">
								{publishPolicyLabel(project.publishPolicy)}
							</Rule>
						</>
					)}
				</Dialog>
			) : null}
		</div>
	)
}
