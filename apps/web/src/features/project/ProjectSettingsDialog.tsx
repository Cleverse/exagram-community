import { type PublishPolicy, type WorkspaceKind } from "@exagram/api-client"
import { type ReactNode, useEffect, useRef, useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { IconSparkle } from "@/components/ui/icons"
import { RadioCard } from "@/components/ui/RadioCard"
import { Switch } from "@/components/ui/Switch"
import { edition } from "@/edition/edition"
import { PUBLISH_POLICY_OPTIONS } from "@/features/project/publishPolicy"
import {
	createdProjectMessage,
	EMPTY_PROJECT_DRAFT,
	type ProjectDraft as Draft,
	useCreateProjectModel,
	useProjectSettingsModel,
} from "@/features/project/useProjectSettingsModel"
import { useWorkspaceKind, useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"
import { draftPolicy } from "@/mock/policyDraft"
import { useProjectSettings } from "@/mock/projectSettings"

const FieldLabel = ({ children }: { children: string }) => (
	<div style={{ fontSize: 14, fontWeight: 600 }}>{children}</div>
)

const FieldHelp = ({ children }: { children: string }) => (
	<div style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 2, lineHeight: 1.5 }}>{children}</div>
)

const INPUT_STYLE = {
	width: "100%",
	border: "1px solid var(--color-line-soft)",
	background: "#fff",
	fontSize: 15,
	outline: 0,
} as const

export const ProjectSettingsDialogView = ({
	mode,
	kind,
	initial,
	saving,
	extra,
	onSave,
	onClose,
}: {
	mode: "create" | "edit"
	kind: WorkspaceKind
	initial: Draft
	saving: boolean
	/** Controls that apply immediately rather than on Save; edit mode only. */
	extra?: ReactNode
	onSave: (draft: Draft) => void
	onClose: () => void
}) => {
	const [draft, setDraft] = useState(initial)
	const [drafting, setDrafting] = useState(false)
	const [drafted, setDrafted] = useState(false)
	const [focused, setFocused] = useState<"name" | "policy" | null>(null)
	const personal = kind === "personal"
	const patch = (next: Partial<Draft>) => setDraft((previous) => ({ ...previous, ...next }))

	const runDraft = () => {
		if (drafting) return
		setDrafting(true)
		void draftPolicy(draft.name.trim() || "this project").then((policy) => {
			setDraft((previous) => ({ ...previous, policy }))
			setDrafting(false)
			setDrafted(true)
		})
	}

	const saveDisabled = draft.name.trim() === "" || saving

	return (
		<Dialog
			title={mode === "create" ? "New project" : `Settings · ${draft.name}`}
			ariaLabel={mode === "create" ? "New project" : "Project settings"}
			onClose={onClose}
			helper={
				mode === "create"
					? personal
						? "Settings can change later."
						: "Private until you invite someone. Settings can change later."
					: "Changes apply to the next request from any client."
			}
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button size={40} disabled={saveDisabled} onClick={() => onSave(draft)}>
						{mode === "create" ? "Create project" : "Save settings"}
					</Button>
				</>
			}
		>
			<div>
				<label htmlFor="project-name" className="block" style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>
					Name
				</label>
				<input
					id="project-name"
					aria-label="Project name"
					autoFocus
					value={draft.name}
					onChange={(event) => patch({ name: event.target.value })}
					placeholder="e.g. Q4 Sales Enablement"
					style={{
						...INPUT_STYLE,
						height: 44,
						padding: "0 14px",
						borderColor: focused === "name" ? "var(--color-ink)" : "var(--color-line-soft)",
					}}
					onFocus={() => setFocused("name")}
					onBlur={() => setFocused(null)}
				/>
			</div>

			<div>
				<div className="flex items-end" style={{ gap: 12, marginBottom: 8 }}>
					<div className="min-w-0 flex-1">
						<label htmlFor="project-policy" className="block" style={{ fontSize: 14, fontWeight: 600 }}>
							Policy
						</label>
						<FieldHelp>
							{personal
								? "Instructions every AI client follows when reading or writing here. Write it like a prompt."
								: "Instructions every AI client and collaborator follows when reading or writing here. Write it like a prompt."}
						</FieldHelp>
					</div>
					<Button variant="subtle" size={36} gap={7} onClick={runDraft} disabled={drafting}>
						<IconSparkle size={14} />
						{drafting ? "Drafting…" : draft.policy ? "Redraft with AI" : "Draft with AI"}
					</Button>
				</div>
				<textarea
					id="project-policy"
					rows={5}
					value={draft.policy}
					onChange={(event) => {
						patch({ policy: event.target.value })
						setDrafted(false)
					}}
					placeholder="e.g. Answer only from files in this project. Cite the file and revision for every claim."
					style={{
						...INPUT_STYLE,
						padding: "12px 14px",
						font: "inherit",
						// The prototype's textarea keeps the UA black, not the var(--color-ink) ink every other control uses.
						color: "#000",
						lineHeight: 1.55,
						resize: "vertical",
						borderColor: focused === "policy" ? "var(--color-ink)" : "var(--color-line-soft)",
					}}
					onFocus={() => setFocused("policy")}
					onBlur={() => setFocused(null)}
				/>
				{drafted ? (
					<div style={{ fontSize: 13, color: "var(--color-muted)", marginTop: 6 }}>
						Drafted from the project name and your workspace defaults. Edit freely — it is saved as plain text.
					</div>
				) : null}
			</div>

			{personal ? null : (
				<>
					<div
						className="flex items-start"
						style={{ gap: 20, padding: "18px 20px", background: "#fff", border: "1px solid var(--color-line-faint)" }}
					>
						<div className="min-w-0 flex-1">
							<div style={{ fontSize: 16, fontWeight: 600 }}>Collaborators can upload over existing files</div>
							<div style={{ fontSize: 14, color: "var(--color-muted)", marginTop: 4, lineHeight: 1.55 }}>
								Anyone with Can edit may replace a file with a new revision. Off means only you replace; others add new
								files.
							</div>
						</div>
						<Switch
							checked={draft.overwrite}
							onChange={(overwrite) => patch({ overwrite })}
							label="Collaborators can upload over existing files"
						/>
					</div>

					<div>
						<FieldLabel>Published version</FieldLabel>
						<FieldHelp>What has to happen before a new upload becomes the version clients read.</FieldHelp>
						<div className="flex flex-col" style={{ gap: 8, marginTop: 10 }}>
							{PUBLISH_POLICY_OPTIONS.map((option) => (
								<RadioCard
									key={option.value}
									name="published-version"
									value={option.value}
									checked={draft.publish === option.value}
									onSelect={(value) => patch({ publish: value as PublishPolicy })}
									label={option.label}
									description={option.description}
								/>
							))}
						</div>
					</div>
				</>
			)}

			{extra}
		</Dialog>
	)
}

/**
 * Create mode has no project id until the server answers, so the mock settings for the new project
 * are written by this child once that id exists.
 */
const SettingsWriter = ({ projectId, draft, onDone }: { projectId: string; draft: Draft; onDone: () => void }) => {
	const settings = useProjectSettings(projectId)
	const pending = useRef({ draft, set: settings.set, onDone })
	pending.current = { draft, set: settings.set, onDone }

	useEffect(() => {
		const { draft: written, set, onDone: done } = pending.current
		set({ policy: written.policy.trim(), overwrite: written.overwrite })
		done()
	}, [projectId])

	return null
}

const CreateProjectDialog = ({
	parentProjectId,
	onClose,
	onCreated,
}: {
	parentProjectId: string | null
	onClose: () => void
	onCreated?: (projectId: string) => void
}) => {
	const model = useCreateProjectModel()
	const toast = useToast()
	const kind = useWorkspaceKind()
	const [written, setWritten] = useState<{ projectId: string; draft: Draft } | null>(null)

	return (
		<>
			<ProjectSettingsDialogView
				mode="create"
				kind={kind}
				initial={EMPTY_PROJECT_DRAFT}
				saving={model.saving || written !== null}
				onClose={onClose}
				onSave={(draft) =>
					model.create(draft, parentProjectId, (projectId, created) => setWritten({ projectId, draft: created }))
				}
			/>
			{written === null ? null : (
				<SettingsWriter
					projectId={written.projectId}
					draft={written.draft}
					onDone={() => {
						toast(createdProjectMessage(written.draft.name, written.draft.publish, kind))
						onCreated?.(written.projectId)
						onClose()
					}}
				/>
			)}
		</>
	)
}

const EditProjectDialog = ({ projectId, onClose }: { projectId: string; onClose: () => void }) => {
	const model = useProjectSettingsModel(projectId)
	const { kind } = useWorkspaceOf(model.project?.workspaceId)

	if (!model.initial) return null

	return (
		<ProjectSettingsDialogView
			mode="edit"
			kind={kind}
			initial={model.initial}
			saving={model.saving}
			extra={edition.ProjectRedactionSection && <edition.ProjectRedactionSection projectId={projectId} kind={kind} />}
			onClose={onClose}
			onSave={(draft) => model.save(draft, onClose)}
		/>
	)
}

/** In create mode `projectId` names the parent project the new one is nested under. */
export const ProjectSettingsDialog = ({
	mode,
	projectId,
	onClose,
	onCreated,
}: {
	mode: "create" | "edit"
	projectId?: string
	onClose: () => void
	onCreated?: (projectId: string) => void
}) =>
	mode === "create" ? (
		<CreateProjectDialog parentProjectId={projectId ?? null} onClose={onClose} onCreated={onCreated} />
	) : projectId ? (
		<EditProjectDialog projectId={projectId} onClose={onClose} />
	) : null
