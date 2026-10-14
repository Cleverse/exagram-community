import { type WorkspaceKind } from "@exagram/api-client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { type Mock, vi } from "vitest"

import { ProjectSettingsDialogView } from "./ProjectSettingsDialog"

export const empty = { name: "", policy: "", overwrite: false, publish: "auto" } as const

export const renderView = (
	props: Partial<Parameters<typeof ProjectSettingsDialogView>[0]> = {},
	kind: WorkspaceKind = "team",
): { onSave: Mock; onClose: Mock } => {
	const onSave = vi.fn()
	const onClose = vi.fn()
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
	render(
		<QueryClientProvider client={queryClient}>
			<ProjectSettingsDialogView
				mode="create"
				kind={kind}
				initial={empty}
				saving={false}
				localRules
				onSave={onSave}
				onClose={onClose}
				{...props}
			/>
		</QueryClientProvider>,
	)
	return { onSave, onClose }
}
