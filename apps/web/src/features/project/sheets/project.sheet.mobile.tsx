import { type Project } from "@exagram/api-client"
import { useState } from "react"
import { useLocation, useNavigate } from "react-router"

import { SheetRow, SheetRows, SheetSeparator } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { useToast } from "@/components/Toast"
import { IconNewProject, IconPencil, IconShare, IconShield, IconTrash } from "@/components/ui/icons"
import { buttonStyle, inkButtonClass, outlineButtonClass } from "@/features/artifact/sheets/sheetData"
import { ConfirmPanel, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMe } from "@/features/auth/hooks/useMe"
import { useArtifacts } from "@/features/library/hooks/useArtifacts"
import { useProjects } from "@/features/library/hooks/useProjects"
import { useDeleteProject, useRenameProject } from "@/features/project/hooks/useProjectMutations"
import { hasProjectRules } from "@/features/project/projectRules"
import { useWorkspaceOf } from "@/features/workspace/useWorkspaceKind"
import { paths } from "@/routes/paths"

/** The Folder rules row's value: the publish mode in a word, as the drawer has 120px for it. */
const PUBLISH_SHORT = { auto: "Automatic", manual: "Manual" } as const

/** Rename in place of the rows: the name field, then Cancel and Save (the desktop header's inline rename). */
const RenameForm = ({ project, onDone }: { project: Project; onDone: () => void }) => {
	const rename = useRenameProject()
	const toast = useToast()
	const [name, setName] = useState(project.name)
	const next = name.trim()

	const save = () => {
		if (next === "" || rename.isPending) return
		if (next === project.name) {
			onDone()
			return
		}
		rename.mutate(
			{ projectId: project.id, name: next },
			{
				onSuccess: () => {
					toast(`Renamed to ${next}`)
					onDone()
				},
				onError: (error) => toast(error.message),
			},
		)
	}

	return (
		<div style={{ padding: "4px 16px 8px" }}>
			<input
				aria-label="Folder name"
				autoFocus
				value={name}
				enterKeyHint="done"
				onChange={(event) => setName(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") save()
				}}
				className="w-full border border-line-strong bg-white outline-none focus:border-ink"
				style={{ height: 44, padding: "0 12px", fontSize: 16 }}
			/>
			<div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 16 }}>
				<button type="button" onClick={onDone} className={outlineButtonClass} style={buttonStyle}>
					Cancel
				</button>
				<button
					type="button"
					disabled={next === "" || rename.isPending}
					onClick={save}
					className={inkButtonClass}
					style={buttonStyle}
				>
					Save
				</button>
			</div>
		</div>
	)
}

const ProjectActions = ({ project }: { project: Project }) => {
	const sheet = useSheet()
	const me = useMe()
	const { kind } = useWorkspaceOf(project.workspaceId)
	const toast = useToast()
	const navigate = useNavigate()
	const location = useLocation()
	const files = useArtifacts({ scope: "all", projectId: project.id })
	const remove = useDeleteProject()
	const [mode, setMode] = useState<"rows" | "rename" | "delete">("rows")
	// Rename, sub-projects and Delete write to a Project the API lets only its Owner change.
	const isOwner = project.ownerId === me.data?.id
	const target = { kind: "project", id: project.id } as const
	const count = files.data?.length
	const sub = count === undefined ? undefined : count === 1 ? "1 file" : `${count} files`

	const deleteProject = () =>
		remove.mutate(
			{ projectId: project.id },
			{
				onSuccess: () => {
					toast(`Deleted ${project.name}`)
					// Standing on the Project that is gone, go where desktop goes; anywhere else just close.
					if (location.pathname === paths.project(project.id))
						sheet.closeThen(() => void navigate(paths.library, { replace: true }))
					else sheet.close()
				},
				// The server refuses a Project that still holds files; its message says so.
				onError: (error) => {
					toast(error.message)
					setMode("rows")
				},
			},
		)

	if (mode === "rename") {
		return (
			<Sheet title="Rename folder" sub={project.name}>
				<RenameForm project={project} onDone={() => setMode("rows")} />
			</Sheet>
		)
	}

	if (mode === "delete") {
		return (
			<Sheet title="Delete folder" sub={project.name}>
				<ConfirmPanel
					message="Only an empty folder can be deleted. Move or delete its files first."
					confirmLabel="Delete"
					busy={remove.isPending}
					onCancel={() => setMode("rows")}
					onConfirm={deleteProject}
				/>
			</Sheet>
		)
	}

	return (
		<Sheet title={project.name} sub={sub}>
			<SheetRows>
				<SheetRow
					icon={<IconShare size={18} />}
					label="Share folder"
					chevron
					onClick={() => sheet.push("share", { target })}
				/>
				{hasProjectRules(kind) ? (
					<SheetRow
						icon={<IconShield size={18} />}
						label="Folder rules"
						value={kind === "personal" ? undefined : PUBLISH_SHORT[project.publishPolicy]}
						chevron
						onClick={() => sheet.push("rules", { projectId: project.id })}
					/>
				) : null}
				{isOwner ? (
					<>
						<SheetRow icon={<IconPencil size={18} />} label="Rename" onClick={() => setMode("rename")} />
						<SheetRow
							icon={<IconNewProject size={18} />}
							label="New subfolder"
							chevron
							onClick={() => sheet.push("newProject", { parentId: project.id })}
						/>
						<SheetSeparator />
						<SheetRow
							icon={<IconTrash size={18} />}
							label="Delete folder"
							sub="Only an empty folder can be deleted"
							danger
							onClick={() => setMode("delete")}
						/>
					</>
				) : null}
			</SheetRows>
		</Sheet>
	)
}

/**
 * Project actions (core `kind === "project"`): Share folder and Folder rules for anyone who can see it;
 * Rename, New subfolder and Delete for its Owner. Rename and Delete use desktop's mutations; Delete asks
 * first and the server refuses a Project that still holds files.
 */
const ProjectSheet = ({ params }: { params: SheetParams["project"] }) => {
	const projects = useProjects()
	const project = (projects.data ?? []).find((candidate) => candidate.id === params.projectId)
	if (projects.isPending) return <SheetLoading title="Folder" />
	if (!project) {
		return (
			<Sheet title="Folder unavailable">
				<SheetNote>This folder was deleted or is no longer shared with you.</SheetNote>
			</Sheet>
		)
	}
	return <ProjectActions project={project} />
}

export default ProjectSheet
