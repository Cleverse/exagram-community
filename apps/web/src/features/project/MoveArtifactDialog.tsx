import { type Project } from "@exagram/api-client"
import clsx from "clsx"
import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { IconCheck, IconFolder, IconPlus } from "@/components/ui/icons"
import { useCreateProject } from "@/features/project/hooks/useProjectMutations"
import { useMoveArtifactModel } from "@/features/project/useMoveArtifactModel"

export const Option = ({
	label,
	nested = false,
	folder = label !== "No project",
	current,
	checked,
	onSelect,
}: {
	label: string
	nested?: boolean
	/** Whether the row wears the folder glyph; "No project" leaves the space blank. */
	folder?: boolean
	current: boolean
	checked: boolean
	onSelect: () => void
}) => (
	<button
		type="button"
		role="radio"
		aria-checked={checked}
		onClick={onSelect}
		className={clsx("flex w-full items-center text-left hover:bg-ground", checked ? "bg-ground" : "bg-white")}
		style={{ gap: 12, minHeight: 46, padding: `0 16px 0 ${nested ? 40 : 16}px`, fontSize: 15 }}
	>
		<IconFolder size={17} className="flex-none text-muted" style={{ opacity: folder ? 1 : 0 }} />
		<span className="min-w-0 flex-1 truncate" style={{ fontWeight: checked ? 600 : 400 }}>
			{label}
		</span>
		{current ? (
			<span
				className="font-mono flex-none uppercase"
				style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--color-muted)" }}
			>
				current
			</span>
		) : null}
		{checked ? <IconCheck size={16} strokeWidth={2.5} className="flex-none text-ink" /> : null}
	</button>
)

/**
 * The list's last row: "New project" until clicked, then a name field. A created Project becomes the
 * picked target straight away, so one more click on Move files the Artifact there.
 */
const NewProjectRow = ({ onCreated }: { onCreated: (project: Project) => void }) => {
	const create = useCreateProject()
	const toast = useToast()
	const [editing, setEditing] = useState(false)
	const [name, setName] = useState("")

	const submit = () => {
		const trimmed = name.trim()
		if (trimmed === "" || create.isPending) return
		create.mutate(
			{ name: trimmed, parentProjectId: null },
			{
				onSuccess: (project) => {
					setEditing(false)
					setName("")
					onCreated(project)
				},
				onError: (error) => toast(error.message),
			},
		)
	}

	if (!editing)
		return (
			<button
				type="button"
				onClick={() => setEditing(true)}
				className="flex w-full items-center bg-white text-left hover:bg-ground"
				style={{
					gap: 12,
					minHeight: 46,
					padding: "0 16px",
					fontSize: 15,
					color: "var(--color-ink)",
					fontWeight: 500,
				}}
			>
				<IconPlus size={17} className="flex-none" />
				New project
			</button>
		)

	return (
		<div className="flex items-center bg-white" style={{ gap: 8, minHeight: 46, padding: "6px 8px 6px 16px" }}>
			<IconFolder size={17} className="flex-none text-muted" />
			<input
				aria-label="New project name"
				autoFocus
				value={name}
				placeholder="Project name"
				disabled={create.isPending}
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") submit()
					if (event.key === "Escape") {
						// Escape leaves the field, not the dialog.
						event.stopPropagation()
						setEditing(false)
						setName("")
					}
				}}
				className="min-w-0 flex-1 bg-transparent outline-none"
				style={{ fontSize: 15, height: 32 }}
			/>
			<Button variant="primary" size={32} disabled={name.trim() === "" || create.isPending} onClick={submit}>
				{create.isPending ? "Creating…" : "Create"}
			</Button>
		</div>
	)
}

/**
 * The row menu's and the preview pane's "Move to project…". §A.3 restricts `artifacts.move` to the Owner's own
 * Projects, so this only ever lists what `projects.list` returned; a refused move surfaces the
 * server's message unchanged.
 */
export const MoveArtifactDialog = ({
	artifactId,
	title,
	currentProjectId,
	onClose,
}: {
	artifactId: string
	title: string
	currentProjectId: string | null
	onClose: () => void
}) => {
	const { rows, error, moving, moveTo } = useMoveArtifactModel({ artifactId, title })
	const [target, setTarget] = useState<string | null>(currentProjectId)

	const unchanged = target === currentProjectId

	const submit = () => moveTo(target, onClose)

	return (
		<Dialog
			title="Move to project"
			onClose={onClose}
			width={520}
			bodyGap={12}
			helper="Clients connected to the new project read it on their next request."
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" size={40} disabled={unchanged || moving} onClick={submit}>
						Move
					</Button>
				</>
			}
		>
			<div className="truncate" style={{ fontSize: 14, color: "var(--color-muted)" }}>
				{title}
			</div>
			<div
				role="radiogroup"
				aria-label="Project"
				className="flex flex-col divide-y divide-row-line overflow-hidden"
				style={{ border: "1px solid var(--color-line-faint)" }}
			>
				<Option
					label="No project"
					current={currentProjectId === null}
					checked={target === null}
					onSelect={() => setTarget(null)}
				/>
				{rows.map(({ project, nested }) => (
					<Option
						key={project.id}
						label={project.name}
						nested={nested}
						current={project.id === currentProjectId}
						checked={target === project.id}
						onSelect={() => setTarget(project.id)}
					/>
				))}
				<NewProjectRow onCreated={(project) => setTarget(project.id)} />
			</div>
			{error ? (
				<p role="alert" className="text-danger" style={{ fontSize: 13 }}>
					{error}
				</p>
			) : null}
		</Dialog>
	)
}
