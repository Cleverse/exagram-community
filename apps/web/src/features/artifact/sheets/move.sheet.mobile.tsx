import { type VisibleArtifact } from "@exagram/api-client"

import { SheetRow, SheetRows, SheetSeparator } from "@/components/mobile/primitives"
import { FolderGlyph } from "@/components/mobile/rows"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { IconGrid } from "@/components/ui/icons"
import { useSheetArtifact } from "@/features/artifact/sheets/sheetData"
import { SheetGone, SheetLoading, SheetNote } from "@/features/artifact/sheets/sheetParts"
import { useMoveArtifactModel } from "@/features/project/useMoveArtifactModel"

const MoveList = ({ artifact }: { artifact: VisibleArtifact }) => {
	const sheet = useSheet()
	const { rows, error, moving, moveTo } = useMoveArtifactModel({ artifactId: artifact.id, title: artifact.title })

	// One tap moves; the current place is checked and tapping it just closes (core `kind === "move"`).
	const pick = (projectId: string | null) => {
		if (moving) return
		if (projectId === artifact.projectId) sheet.close()
		else moveTo(projectId, sheet.close)
	}

	return (
		<Sheet title="Move to" sub={artifact.title}>
			<SheetRows>
				<SheetRow
					icon={<IconGrid size={18} />}
					label="No folder"
					check={artifact.projectId === null}
					disabled={moving}
					onClick={() => pick(null)}
				/>
				{rows.length > 0 ? <SheetSeparator /> : null}
				{rows.map(({ project, nested }) => (
					// A sub-project sits under its parent, indented as in the sidebar.
					<div key={project.id} style={{ paddingLeft: nested ? 20 : 0 }}>
						<SheetRow
							icon={<FolderGlyph size={18} />}
							label={project.name}
							check={artifact.projectId === project.id}
							disabled={moving}
							onClick={() => pick(project.id)}
						/>
					</div>
				))}
			</SheetRows>
			{error ? <SheetNote role="alert">{error}</SheetNote> : null}
		</Sheet>
	)
}

/**
 * Move to (core `kind === "move"`): No project, then the Owner's Projects roots first,
 * each with its sub-projects. The move, its toast and a refusal's message are desktop's, via
 * `useMoveArtifactModel`.
 */
const MoveSheet = ({ params }: { params: SheetParams["move"] }) => {
	const { artifact, loading } = useSheetArtifact(params.artifactId)
	if (loading) return <SheetLoading title="Move to" />
	if (!artifact) return <SheetGone />
	return <MoveList artifact={artifact} />
}

export default MoveSheet
