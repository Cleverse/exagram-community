import { type Project } from "@exagram/api-client"
import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { useMe } from "@/features/auth/hooks/useMe"
import { useProjects } from "@/features/library/hooks/useProjects"
import { canMoveProject, projectMovedMessage } from "@/features/library/projectMove"
import { useMoveProject } from "@/features/project/hooks/useProjectMutations"
import { Option } from "@/features/project/MoveArtifactDialog"

/**
 * The Project ⋯ menu's "Move to…": nest this Project as a folder of another top-level Project you own, or lift it
 * back to the top level. The choices are the ones `canMoveProject` allows (the current place stays listed and
 * marked); a refused move shows the server's message unchanged.
 */
export const MoveProjectDialog = ({ project, onClose }: { project: Project; onClose: () => void }) => {
	const projects = useProjects()
	const me = useMe()
	const move = useMoveProject()
	const toast = useToast()
	const [target, setTarget] = useState<string | null>(project.parentProjectId)

	const all = projects.data ?? []
	const hasFolders = all.some((candidate) => candidate.parentProjectId === project.id)
	const parents = all.filter(
		(candidate) => candidate.id === project.parentProjectId || canMoveProject(all, project, candidate.id, me.data?.id),
	)

	const unchanged = target === project.parentProjectId

	const submit = () =>
		move.mutate(
			{ projectId: project.id, parentProjectId: target },
			{
				onSuccess: () => {
					toast(projectMovedMessage(project.name, target, all))
					onClose()
				},
				onError: (error) => toast(error.message),
			},
		)

	return (
		<Dialog
			title="Move folder"
			onClose={onClose}
			width={520}
			bodyGap={12}
			helper="People with access to the new parent folder also reach this one and its files."
			footer={
				<>
					<Button variant="outline" size={40} onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" size={40} disabled={unchanged || move.isPending} onClick={submit}>
						Move
					</Button>
				</>
			}
		>
			<div className="truncate" style={{ fontSize: 14, color: "var(--color-muted)" }}>
				{project.name}
			</div>
			<div
				role="radiogroup"
				aria-label="Parent folder"
				className="flex flex-col divide-y divide-row-line overflow-hidden"
				style={{ border: "1px solid var(--color-line-faint)" }}
			>
				<Option
					label="Top level"
					folder={false}
					current={project.parentProjectId === null}
					checked={target === null}
					onSelect={() => setTarget(null)}
				/>
				{parents.map((parent) => (
					<Option
						key={parent.id}
						label={parent.name}
						nested
						current={parent.id === project.parentProjectId}
						checked={target === parent.id}
						onSelect={() => setTarget(parent.id)}
					/>
				))}
			</div>
			{hasFolders ? (
				<p style={{ fontSize: 13, color: "var(--color-muted)" }}>
					This folder has subfolders of its own, so it stays at the top level. Subfolders go one level deep.
				</p>
			) : null}
			{projects.isError ? (
				<p role="alert" className="text-danger" style={{ fontSize: 13 }}>
					{projects.error.message}
				</p>
			) : null}
		</Dialog>
	)
}
