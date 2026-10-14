import { useRef } from "react"

import { SheetRow, SheetRows } from "@/components/mobile/primitives"
import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { IconNewProject, IconUpload } from "@/components/ui/icons"
import { UPLOAD_ACCEPT } from "@/features/library/upload"
import { useLibraryActions } from "@/features/library/useLibraryActions"

/**
 * The Create drawer: Upload file and New folder. Upload goes straight to the phone's file
 * picker and then through the same upload path as a desktop drop, so each file is checked, titled from its
 * name and toasted the same way. New chat joins when Chat ships (plan decision 3).
 */
export default function NewSheet({ params }: { params: SheetParams["new"] }) {
	const sheet = useSheet()
	const actions = useLibraryActions()
	const input = useRef<HTMLInputElement>(null)

	return (
		<Sheet title="Create">
			<SheetRows>
				<SheetRow
					icon={<IconUpload size={18} />}
					label="Upload file"
					sub="Markdown, HTML, PDF, Office files or images"
					onClick={() => input.current?.click()}
				/>
				<SheetRow
					icon={<IconNewProject size={18} />}
					label="New folder"
					sub="A folder with its own rules for Connections"
					chevron
					onClick={() => sheet.push("newProject", { parentId: params.projectId })}
				/>
			</SheetRows>
			{/* The drawer stays open while the picker is up, so a cancelled pick leaves it where it was. */}
			<input
				ref={input}
				type="file"
				multiple
				accept={UPLOAD_ACCEPT}
				aria-label="Choose files to upload"
				className="hidden"
				onChange={(event) => {
					const files = Array.from(event.target.files ?? [])
					event.target.value = ""
					if (files.length === 0) return
					actions.uploadFiles(files, params.projectId)
					sheet.close()
				}}
			/>
		</Sheet>
	)
}
