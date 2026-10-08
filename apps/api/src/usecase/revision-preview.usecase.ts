import { createHash } from "node:crypto"

import { mintUsercontentToken } from "@exagram/core/services/usercontent-token.service"
import { RefusalError } from "@exagram/core/utils/refusal"

import type { User } from "@exagram/core/entity/auth"
import type { ServeService } from "@exagram/core/services/serve/serve.service"

export interface MintedPreview {
	revisionId: string
	url: string | null
	expiresInSeconds: number
}

export class RevisionPreviewUsecase {
	constructor(
		private readonly serve: ServeService,
		private readonly secret: string,
		private readonly usercontentOrigin: string,
		private readonly ttlSeconds: number,
	) {}

	async previewToken(
		user: Pick<User, "id" | "workspaceId">,
		artifactId: string,
		unlockHash?: string,
	): Promise<MintedPreview> {
		const result = await this.serve.serve(
			{
				principal: { kind: "user", id: user.id, workspaceId: user.workspaceId },
				surface: "web",
				action: "revisions.previewToken",
				artifactId,
				unlockHash,
			},
			async (tx, resolution, callId) => {
				if (resolution.revisionId === null) throw new RefusalError()
				const [preview] = await tx<{ html: string; kind: string }[]>`
					SELECT p.html, a.kind
					FROM "exagram"."revision_previews" p
					JOIN "exagram"."revisions" r ON r.id = p.revision_id
					JOIN "exagram"."artifacts" a ON a.id = r.artifact_id
					WHERE p.revision_id = ${resolution.revisionId}::uuid AND p.html IS NOT NULL
				`
				if (!preview || !["pdf", "docx", "pptx", "xlsx"].includes(preview.kind)) {
					return { revisionId: resolution.revisionId, previewSha256: null }
				}
				const previewSha256 = createHash("sha256").update(Buffer.from(preview.html, "utf8")).digest("hex")
				await this.serve.recordBodyDigest(callId, previewSha256)
				return { revisionId: resolution.revisionId, previewSha256 }
			},
		)
		return {
			revisionId: result.revisionId,
			url:
				result.previewSha256 === null
					? null
					: `${this.usercontentOrigin}/uc/${mintUsercontentToken(
							{ revisionId: result.revisionId, previewSha256: result.previewSha256 },
							this.secret,
							{ ttlSeconds: this.ttlSeconds },
						)}/preview`,
			expiresInSeconds: this.ttlSeconds,
		}
	}
}
