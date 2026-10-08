import { useSheet } from "@/components/mobile/sheet/context"
import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { ConnectionFoldersBody } from "@/features/connections/ConnectionFoldersDialog"

export default function ClientFoldersSheet({ params }: { params: SheetParams["clientFolders"] }) {
	const sheet = useSheet()

	return (
		<Sheet
			title={`Folders ${params.connectionName} can reach in Shares`}
			sub="This narrows what it can reach in Shares — it never widens it."
			wrapTitle
		>
			<ConnectionFoldersBody connectionId={params.connectionId} onClose={sheet.back} />
		</Sheet>
	)
}
