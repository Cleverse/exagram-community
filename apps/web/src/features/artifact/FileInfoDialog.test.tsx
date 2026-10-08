import { QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { FileInfoDialog } from "./FileInfoDialog"

import { QueryKeys } from "@/config/queryKeys"
import { artifactFixture } from "@/features/artifact/sheets/sheetHarness"
import { testQueryClient } from "@/test/mobile"

describe("FileInfoDialog", () => {
	it("shows link access in file details", () => {
		const client = testQueryClient()
		client.setQueryData(QueryKeys.connections.list(), [])
		const file = artifactFixture({ access: "view", generalAccess: "anyone", sharedWithNames: [] })
		render(
			<QueryClientProvider client={client}>
				<FileInfoDialog artifact={file} projectName={null} onClose={() => {}} />
			</QueryClientProvider>,
		)
		expect(screen.getByText("Anyone with the link")).toBeInTheDocument()
	})
})
