import { type ConnectionFolders } from "@exagram/api-client"
import { useState } from "react"

import { Dialog, dialogCancelClass, dialogPrimaryClass } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { useConnectionFolders, useSaveConnectionFolders } from "@/features/connections/hooks/useConnectionFolders"

type FolderEntry = ConnectionFolders["folders"][number]
type Project = ConnectionFolders["projects"][number]
type FolderInput = Pick<ConnectionFolders, "access" | "otherFilesAccess" | "folders">

const entriesOf = (folders: FolderEntry[], projects?: Project[]) => {
	const viewOnly = new Set(projects?.filter((project) => project.personAccess === "view").map((project) => project.id))
	return Object.fromEntries(
		folders.map(({ projectId, access }) => [projectId, viewOnly.has(projectId) ? "view" : access]),
	) as Record<string, FolderEntry["access"]>
}

const orderedProjects = (projects: Project[]) => {
	const byParent = new Map<string | null, Project[]>()
	const ids = new Set(projects.map((project) => project.id))
	for (const project of projects) {
		const parentId = project.parentProjectId && ids.has(project.parentProjectId) ? project.parentProjectId : null
		byParent.set(parentId, [...(byParent.get(parentId) ?? []), project])
	}
	const rows: { project: Project; depth: number }[] = []
	const visit = (parentId: string | null, depth: number) => {
		for (const project of byParent.get(parentId) ?? []) {
			rows.push({ project, depth })
			visit(project.id, depth + 1)
		}
	}
	visit(null, 0)
	return rows
}

const folderInput = (
	access: FolderInput["access"],
	otherFilesAccess: FolderInput["otherFilesAccess"],
	entries: Record<string, FolderEntry["access"]>,
): FolderInput => ({
	access,
	otherFilesAccess,
	folders: Object.entries(entries)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([projectId, entryAccess]) => ({ projectId, access: entryAccess })),
})

export const ConnectionFoldersForm = ({
	data,
	onClose,
	onSave,
	saving = false,
}: {
	data: ConnectionFolders
	onClose: () => void
	onSave: (input: FolderInput) => void
	saving?: boolean
}) => {
	const [access, setAccess] = useState(data.access)
	const [otherFilesAccess, setOtherFilesAccess] = useState(data.otherFilesAccess)
	const [entries, setEntries] = useState(() => entriesOf(data.folders, data.projects))
	const byId = new Map(data.projects.map((project) => [project.id, project]))
	const current = folderInput(access, otherFilesAccess, entries)
	const original = folderInput(data.access, data.otherFilesAccess, entriesOf(data.folders))
	const changed = JSON.stringify(current) !== JSON.stringify(original)

	const toggle = (project: Project) => {
		setEntries((previous) => {
			const next = { ...previous }
			if (next[project.id]) {
				delete next[project.id]
				for (const child of data.projects) {
					if (child.parentProjectId === project.id) delete next[child.id]
				}
			} else next[project.id] = "view"
			return next
		})
	}

	const setRight = (project: Project, right: FolderEntry["access"]) => {
		setEntries((previous) => {
			const next = { ...previous }
			const inherited = project.parentProjectId ? next[project.parentProjectId] : undefined
			if (inherited === right) delete next[project.id]
			else next[project.id] = right
			return next
		})
	}

	return (
		<div className="flex flex-col gap-5 px-4 py-5 text-ink sm:px-8">
			<fieldset className="flex flex-col gap-5 border-0 p-0">
				<legend className="sr-only">Folder access</legend>
				<label className="flex cursor-pointer items-start gap-4">
					<input
						type="radio"
						name="folder-access"
						checked={access === "all"}
						onChange={() => setAccess("all")}
						className="mt-1 size-[18px]"
					/>
					<span>
						<span className="block text-[17px] font-semibold">All folders</span>
						<span className="block text-[15px] text-muted">Everything you can see in this Workspace</span>
					</span>
				</label>
				<label className="flex cursor-pointer items-start gap-4">
					<input
						type="radio"
						name="folder-access"
						checked={access === "named"}
						onChange={() => setAccess("named")}
						className="mt-1 size-[18px]"
					/>
					<span>
						<span className="block text-[17px] font-semibold">Only these folders</span>
						<span className="block text-[15px] text-muted">
							Anything else in this Workspace is refused, and it is told why
						</span>
					</span>
				</label>
			</fieldset>

			{access === "named" ? (
				<div className="rounded-[18px] border border-card-line bg-white p-3 sm:p-4">
					{Object.keys(entries).length === 0 && otherFilesAccess === "none" ? (
						<p className="m-0 p-3 text-[14px] text-muted">
							No folders yet — this Connection is refused everywhere in this Workspace until you add one.
						</p>
					) : null}
					{orderedProjects(data.projects).map(({ project, depth }) => {
						const parent = project.parentProjectId ? byId.get(project.parentProjectId) : undefined
						const inherited = parent ? entries[parent.id] : undefined
						const storedRight = entries[project.id] ?? inherited
						const covered = inherited !== undefined
						const viewOnly = project.personAccess === "view"
						const right = viewOnly && storedRight ? "view" : storedRight
						return (
							<div
								key={project.id}
								className="flex min-h-11 items-center gap-2 py-1"
								style={{ paddingLeft: depth * 20 }}
							>
								<input
									type="checkbox"
									aria-label={project.name}
									checked={right !== undefined}
									disabled={covered}
									title={covered ? `Covered by ${parent?.name}` : undefined}
									onChange={() => toggle(project)}
									className="size-[18px] flex-none"
								/>
								<div className="min-w-0 flex-1 text-[14px] sm:text-[16px]">
									<div className="break-words">{project.name}</div>
									{project.personAccess === "collaborate" && right === "edit" ? (
										<div className="text-[12px] text-muted">New versions only; you cannot add files here</div>
									) : null}
								</div>
								{right ? (
									<select
										aria-label={`${project.name} access`}
										value={right}
										onChange={(event) => setRight(project, event.target.value as FolderEntry["access"])}
										title={
											viewOnly
												? "You only hold Can view here; a Connection cannot be given more than you have."
												: undefined
										}
										className="max-w-[94px] flex-none border border-card-line bg-white px-1 py-2 text-[12px] sm:max-w-none sm:px-2 sm:text-[14px]"
									>
										<option value="view">Can view</option>
										<option value="edit" disabled={viewOnly}>
											Can edit
										</option>
									</select>
								) : (
									<span className="px-3 text-muted">—</span>
								)}
							</div>
						)
					})}
					<div className="mt-3 flex min-h-12 items-center gap-2 border-t border-line pt-3">
						<input
							type="checkbox"
							id="other-files-access"
							checked={otherFilesAccess === "view"}
							onChange={(event) => setOtherFilesAccess(event.target.checked ? "view" : "none")}
							className="size-[18px] flex-none"
						/>
						<label htmlFor="other-files-access" className="min-w-0 flex-1 cursor-pointer text-[14px] sm:text-[16px]">
							<span className="block">Files not in a folder</span>
							<span className="block text-[12px] text-muted">and files shared with you one by one</span>
						</label>
						<span className="flex-none text-[13px] text-muted">view only</span>
					</div>
				</div>
			) : null}

			<div className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted sm:text-[15px]">
				<p className="m-0">
					Can edit lets it upload files and new versions here. It never gives it more than you have.
				</p>
				<p className="m-0">
					If you remove this Connection and add it again, it may register as a new Connection and start with all
					folders.
				</p>
			</div>
			<div className="flex justify-end gap-3 border-t border-line pt-4">
				<button type="button" className={dialogCancelClass} onClick={onClose}>
					Cancel
				</button>
				<button
					type="button"
					className={dialogPrimaryClass}
					disabled={!changed || saving}
					onClick={() => onSave(current)}
				>
					Save
				</button>
			</div>
		</div>
	)
}

export const ConnectionFoldersBody = ({ connectionId, onClose }: { connectionId: string; onClose: () => void }) => {
	const folders = useConnectionFolders(connectionId)
	const save = useSaveConnectionFolders(connectionId)
	const toast = useToast()
	if (folders.isPending)
		return (
			<div className="px-8 py-10 text-muted" role="status">
				Loading folders…
			</div>
		)
	if (folders.isError)
		return (
			<div className="px-8 py-10 text-danger" role="alert">
				{folders.error.message}
			</div>
		)
	return (
		<ConnectionFoldersForm
			data={folders.data}
			onClose={onClose}
			saving={save.isPending}
			onSave={(input) =>
				save.mutate(input, {
					onSuccess: () => {
						toast("Applies on the next request.")
						onClose()
					},
				})
			}
		/>
	)
}

export const ConnectionFoldersDialog = ({
	connectionId,
	clientName,
	onClose,
}: {
	connectionId: string
	clientName: string
	onClose: () => void
}) => (
	<Dialog
		ariaLabel={`Folders ${clientName} can reach in this Workspace`}
		onClose={onClose}
		width={832}
		surface="var(--color-ground-raised)"
		bare
		header={
			<div className="sticky top-0 z-10 border-b border-line bg-ground-raised px-8 py-6">
				<h2 className="font-display m-0 text-[24px] font-semibold">Folders {clientName} can reach in this Workspace</h2>
				<p className="m-0 mt-2 text-[15px] text-muted">
					This narrows what it can reach in this Workspace — it never widens it.
				</p>
			</div>
		}
	>
		<ConnectionFoldersBody connectionId={connectionId} onClose={onClose} />
	</Dialog>
)
