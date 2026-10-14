import { type Project, type PublishPolicy, type WorkspaceKind } from "@exagram/api-client"
import clsx from "clsx"
import { type ReactNode, useState } from "react"

import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { Switch } from "@/components/ui/Switch"
import { edition } from "@/edition/edition"
import { buttonStyle, inkButtonClass, outlineButtonClass } from "@/features/artifact/sheets/sheetData"
import { SheetLabel, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMe } from "@/features/auth/hooks/useMe"
import { useProjects } from "@/features/library/hooks/useProjects"
import { PUBLISH_POLICY_OPTIONS } from "@/features/project/publishPolicy"
import { type ProjectDraft, useProjectSettingsModel } from "@/features/project/useProjectSettingsModel"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"

const OVERWRITE_LABEL = "Collaborators can upload over existing files"
const OVERWRITE_HELP = "Anyone with Can edit may replace a file with a new revision."

const optionFor = (policy: PublishPolicy) => PUBLISH_POLICY_OPTIONS.find((option) => option.value === policy)

const Column = ({ children }: { children: ReactNode }) => (
	<div className="flex flex-col" style={{ padding: "4px 16px 12px", gap: 16 }}>
		{children}
	</div>
)

/** Reading the rules: policy in a soft box, publishing with what it means, the overwrite switch. */
const RulesView = ({
	draft,
	kind,
	onEdit,
}: {
	draft: ProjectDraft
	kind: WorkspaceKind
	onEdit: (() => void) | null
}) => {
	const publish = optionFor(draft.publish)
	const personal = kind === "personal"
	return (
		<Column>
			{edition.projectRules ? (
				<div>
					<SheetLabel>Policy for Connections</SheetLabel>
					<div
						className="bg-ground text-body"
						style={{ marginTop: 8, padding: "12px 14px", fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-line" }}
					>
						{draft.policy || "No policy yet. Connections read this folder with Workspace defaults."}
					</div>
				</div>
			) : null}
			{personal ? null : (
				<>
					<div>
						<SheetLabel>Publishing</SheetLabel>
						<div style={{ fontSize: 15, fontWeight: 500, marginTop: 8 }}>{publish?.label}</div>
						<div className="text-muted" style={{ fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
							{publish?.description}
						</div>
					</div>
					{edition.projectRules ? (
						<div className="flex items-center" style={{ gap: 12 }}>
							<span className="flex-1">
								<span className="block" style={{ fontSize: 15, fontWeight: 500 }}>
									{OVERWRITE_LABEL}
								</span>
								<span className="block text-muted" style={{ fontSize: 13 }}>
									{OVERWRITE_HELP}
								</span>
							</span>
							<span className="flex-none text-secondary" style={{ fontSize: 14 }}>
								{draft.overwrite ? "On" : "Off"}
							</span>
						</div>
					) : null}
				</>
			)}
			{onEdit ? (
				<button type="button" onClick={onEdit} className={outlineButtonClass} style={buttonStyle}>
					Edit rules
				</button>
			) : null}
		</Column>
	)
}

/**
 * Editing the rules in the drawer, laid out like the design's New folder form: the policy,
 * the publishing choices as bordered radio cards, the overwrite switch, then Cancel and Save.
 */
const RulesForm = ({
	initial,
	kind,
	saving,
	onCancel,
	onSave,
}: {
	initial: ProjectDraft
	kind: WorkspaceKind
	saving: boolean
	onCancel: () => void
	onSave: (draft: ProjectDraft) => void
}) => {
	const [draft, setDraft] = useState(initial)
	const patch = (next: Partial<ProjectDraft>) => setDraft((previous) => ({ ...previous, ...next }))
	const personal = kind === "personal"
	return (
		<Column>
			{edition.projectRules ? (
				<label className="flex flex-col" style={{ gap: 6 }}>
					<span className="text-secondary" style={{ fontSize: 13, fontWeight: 500 }}>
						Policy for Connections
					</span>
					<textarea
						rows={4}
						value={draft.policy}
						onChange={(event) => patch({ policy: event.target.value })}
						placeholder="e.g. Answer only from files in this folder. Cite the file and revision for every claim."
						className="border border-line-strong bg-white outline-none focus:border-ink"
						style={{ padding: "10px 12px", fontSize: 15, lineHeight: 1.5, resize: "none" }}
					/>
				</label>
			) : null}
			{personal ? null : (
				<>
					<div role="radiogroup" aria-label="Publishing" className="flex flex-col" style={{ gap: 6 }}>
						<span className="text-secondary" style={{ fontSize: 13, fontWeight: 500 }}>
							Publishing
						</span>
						{PUBLISH_POLICY_OPTIONS.map((option) => {
							const on = draft.publish === option.value
							return (
								<button
									key={option.value}
									type="button"
									role="radio"
									aria-checked={on}
									onClick={() => patch({ publish: option.value })}
									className={clsx("flex items-start border text-left", on ? "border-ink" : "border-line-strong")}
									style={{ gap: 12, padding: 12 }}
								>
									<span
										aria-hidden
										className="flex-none"
										style={{
											width: 18,
											height: 18,
											marginTop: 1,
											borderRadius: "50%",
											border: on ? "5px solid var(--color-ink)" : "1.5px solid var(--color-control-edge)",
										}}
									/>
									<span>
										<span className="block" style={{ fontSize: 14.5, fontWeight: 500 }}>
											{option.label}
										</span>
										<span className="block text-muted" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>
											{option.description}
										</span>
									</span>
								</button>
							)
						})}
					</div>
					{edition.projectRules ? (
						<div className="flex items-center" style={{ gap: 12 }}>
							<span className="flex-1">
								<span className="block" style={{ fontSize: 15, fontWeight: 500 }}>
									{OVERWRITE_LABEL}
								</span>
								<span className="block text-muted" style={{ fontSize: 13 }}>
									{OVERWRITE_HELP}
								</span>
							</span>
							<Switch
								checked={draft.overwrite}
								onChange={(overwrite) => patch({ overwrite })}
								label={OVERWRITE_LABEL}
							/>
						</div>
					) : null}
				</>
			)}
			<div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
				<button type="button" onClick={onCancel} className={outlineButtonClass} style={buttonStyle}>
					Cancel
				</button>
				<button
					type="button"
					disabled={saving}
					onClick={() => onSave(draft)}
					className={inkButtonClass}
					style={buttonStyle}
				>
					{saving ? "Saving…" : "Save rules"}
				</button>
			</div>
		</Column>
	)
}

const Rules = ({ project }: { project: Project }) => {
	const me = useMe()
	const model = useProjectSettingsModel(project.id)
	const { kind } = useWorkspaceOf(project.workspaceId)
	const [editing, setEditing] = useState(false)
	// As on desktop, only the Owner changes a Project's rules (its rules card shows to no one else).
	const isOwner = project.ownerId === me.data?.id
	if (!model.initial) return <SheetLoading title="Folder rules" />
	return (
		<Sheet title="Folder rules" sub={project.name}>
			{editing ? (
				<RulesForm
					initial={model.initial}
					kind={kind}
					saving={model.saving}
					onCancel={() => setEditing(false)}
					onSave={(draft) => model.save(draft, () => setEditing(false))}
				/>
			) : (
				<RulesView draft={model.initial} kind={kind} onEdit={isOwner ? () => setEditing(true) : null} />
			)}
		</Sheet>
	)
}

/**
 * Project rules (core `kind === "rules"`): the policy Connections follow, the publishing mode and
 * the overwrite switch, read from and saved through `useProjectSettingsModel`, as desktop's settings dialog
 * does. The Owner edits them here; the redaction override stays on desktop.
 */
const RulesSheet = ({ params }: { params: SheetParams["rules"] }) => {
	const projects = useProjects()
	const project = (projects.data ?? []).find((candidate) => candidate.id === params.projectId)
	if (projects.isPending) return <SheetLoading title="Folder rules" />
	if (!project) {
		return (
			<Sheet title="Folder unavailable">
				<SheetNote>This folder was deleted or is no longer shared with you.</SheetNote>
			</Sheet>
		)
	}
	return <Rules project={project} />
}

export default RulesSheet
