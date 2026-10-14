import { type DragEvent, useRef, useState } from "react"

import { useToast } from "@/components/Toast"
import { useMe } from "@/features/auth/hooks/useMe"
import { useDragState } from "@/features/library/dragState"
import { useProjects } from "@/features/library/hooks/useProjects"
import { ARTIFACT_DRAG_TYPE, PROJECT_DRAG_TYPE } from "@/features/library/kinds"
import { movedMessage } from "@/features/library/moveMessage"
import { canMoveProject, projectMovedMessage } from "@/features/library/projectMove"
import { canAddTo, ONLY_OWNER_ADDS } from "@/features/library/projectSummary"
import { useLibraryActions } from "@/features/library/useLibraryActions"
import { useMoveArtifact, useMoveProject } from "@/features/project/hooks/useProjectMutations"

/** A list of drop targets while a row is dragged: a 2px dashed `drop` outline, 2px off, on `drop-zone`. */
export const DROP_ZONE_CLASS = "rounded-[8px] bg-drop-zone outline-2 outline-offset-2 outline-dashed outline-drop"

/** The target under the cursor: a 1.5px `drop` outline on the `drop-target` wash. */
export const DROP_TARGET_CLASS = "bg-drop-target! outline-[1.5px] outline-drop outline-solid -outline-offset-[1.5px]"

const carriesProject = (event: DragEvent) => event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)

/**
 * Makes a folder — a Project, or `null` for no Project — a drop target: a file row dragged from the list
 * moves into it, and files dragged in from the desktop upload into it. The dragged file's own folder takes
 * no row drop: it neither lights nor accepts one. A Project row dropped on it nests there as a
 * folder (`null`: back to the top level) wherever `canMoveProject` allows; a Project drag stops at the
 * innermost target, so the section around a row never takes a drop meant for the row. `projectsOnly` takes
 * nothing but a Project row. `over` lights the target while a drag hovers it; enter and leave fire for every
 * child crossed, so they are counted.
 */
export const useFolderDrop = <T extends HTMLElement>(target: { projectId: string | null; projectsOnly?: boolean }) => {
	const actions = useLibraryActions()
	const move = useMoveArtifact()
	const moveProject = useMoveProject()
	const toast = useToast()
	const projects = useProjects()
	const me = useMe()
	const { dragged, setDragged, draggedProject, setDraggedProject } = useDragState()
	const depth = useRef(0)
	const [over, setOver] = useState(false)

	// Only the Owner adds to a Project; a shared Project someone else owns takes no drop at all.
	const ownsTarget = canAddTo(projects.data ?? [], target.projectId, me.data?.id)

	const takes = (event: DragEvent) => {
		if (carriesProject(event))
			return (
				draggedProject !== null && canMoveProject(projects.data ?? [], draggedProject, target.projectId, me.data?.id)
			)
		if (!ownsTarget || target.projectsOnly) return false
		const types = event.dataTransfer.types
		if (types.includes("Files")) return true
		if (!types.includes(ARTIFACT_DRAG_TYPE)) return false
		return dragged?.projectId !== target.projectId
	}

	const onDragEnter = (event: DragEvent<T>) => {
		if (carriesProject(event)) event.stopPropagation()
		if (!takes(event)) return
		depth.current += 1
		setOver(true)
	}
	const onDragOver = (event: DragEvent<T>) => {
		if (carriesProject(event)) event.stopPropagation()
		if (!takes(event)) return
		event.preventDefault()
		event.dataTransfer.dropEffect = event.dataTransfer.types.includes("Files") ? "copy" : "move"
	}
	const onDragLeave = (event: DragEvent<T>) => {
		if (carriesProject(event)) event.stopPropagation()
		if (!takes(event)) return
		depth.current = Math.max(0, depth.current - 1)
		if (depth.current === 0) setOver(false)
	}
	const onDrop = (event: DragEvent<T>) => {
		depth.current = 0
		setOver(false)

		if (carriesProject(event)) {
			event.preventDefault()
			event.stopPropagation()
			const moving = draggedProject
			const parentProjectId = target.projectId
			setDraggedProject(null)
			if (!moving || !canMoveProject(projects.data ?? [], moving, parentProjectId, me.data?.id)) return
			moveProject.mutate(
				{ projectId: moving.id, parentProjectId },
				{
					onSuccess: () => toast(projectMovedMessage(moving.name, parentProjectId, projects.data ?? [])),
					onError: (error) => toast(error.message),
				},
			)
			return
		}
		if (target.projectsOnly) return

		if (!ownsTarget) {
			// Keep the drop from bubbling to the screen's own drop, which would put it somewhere else.
			event.preventDefault()
			event.stopPropagation()
			if (event.dataTransfer.types.includes("Files")) toast(ONLY_OWNER_ADDS)
			return
		}

		const files = Array.from(event.dataTransfer.files)
		if (files.length > 0) {
			event.preventDefault()
			// The shell's own drop would upload to the screen's Project instead.
			event.stopPropagation()
			actions.uploadFiles(files, target.projectId)
			return
		}

		const artifactId = event.dataTransfer.getData(ARTIFACT_DRAG_TYPE)
		if (!artifactId || !takes(event)) return
		event.preventDefault()
		event.stopPropagation()
		const title = dragged?.id === artifactId ? dragged.title : "File"
		setDragged(null)
		move.mutate(
			{ artifactId, projectId: target.projectId },
			{
				onSuccess: () => toast(movedMessage(title, target.projectId, projects.data ?? [])),
				onError: (error) => toast(error.message),
			},
		)
	}

	return { over, dropHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

/**
 * Makes a Project row draggable, to drop onto another Project and nest there. Only the Owner moves a Project,
 * so a row someone else owns does not drag.
 */
export const useProjectDrag = (projectId: string) => {
	const me = useMe()
	const projects = useProjects()
	const { draggedProject, setDraggedProject } = useDragState()
	const project = projects.data?.find((candidate) => candidate.id === projectId)

	if (!project || project.ownerId !== me.data?.id) return { beingDragged: false, dragHandlers: {} }
	return {
		beingDragged: draggedProject?.id === project.id,
		dragHandlers: {
			draggable: true,
			onDragStart: (event: DragEvent) => {
				event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id)
				event.dataTransfer.effectAllowed = "move"
				setDraggedProject(project)
			},
			onDragEnd: () => setDraggedProject(null),
		},
	}
}
