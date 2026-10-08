import { isApiError, type FindingType } from "@exagram/api-client"
import { useState } from "react"

import { useApproveRevision } from "./useApprove"

import { useToast } from "@/components/Toast"

export type ApprovalRevision = {
	revisionId: string
	authorConnectionId?: string | null
	placeholderTypes?: FindingType[]
}

export const useApproveWithConfirmation = (options: { onSuccess?: (revisionId: string) => void } = {}) => {
	const approve = useApproveRevision()
	const toast = useToast()
	const [confirming, setConfirming] = useState<ApprovalRevision | null>(null)

	const execute = (revision: ApprovalRevision, confirmPlaceholders: boolean) => {
		approve.mutate(
			{ revisionId: revision.revisionId, confirmPlaceholders },
			{
				onSuccess: () => {
					setConfirming(null)
					options.onSuccess?.(revision.revisionId)
				},
				onError: (error) => {
					if (isApiError(error) && error.code === "PLACEHOLDERS_NEED_CONFIRMATION") {
						setConfirming(revision)
						return
					}
					if (isApiError(error) && error.code === "REDACTION_NOT_READY") {
						toast("Redaction is still being checked. Try approving again shortly.")
						return
					}
					toast(error.message)
				},
			},
		)
	}

	const requestApproval = (revision: ApprovalRevision) => {
		if (
			revision.authorConnectionId !== null &&
			revision.authorConnectionId !== undefined &&
			(revision.placeholderTypes?.length ?? 0) > 0
		) {
			setConfirming(revision)
			return
		}
		execute(revision, false)
	}

	const confirmApproval = () => {
		if (confirming === null) return
		const revision = confirming
		setConfirming(null)
		execute(revision, true)
	}

	return {
		requestApproval,
		confirmApproval,
		cancelConfirmation: () => setConfirming(null),
		confirming,
		isPending: approve.isPending,
	}
}
