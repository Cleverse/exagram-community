import { oc } from "@orpc/contract"
import { z } from "zod"

import { responseSchema } from "../interface"
import { RevisionSchema } from "../revisions/types"

import {
	ArtifactSchema,
	CreateArtifactBodySchema,
	CreatedArtifactSchema,
	FinalizeBodySchema,
	ListArtifactsQuerySchema,
	ListArtifactsResponseSchema,
	MoveArtifactBodySchema,
	SetAnyoneSettingsBodySchema,
	SetPublishPolicyBodySchema,
	SetGeneralAccessBodySchema,
	UnlockBodySchema,
	UnlockResponseSchema,
	VisibleArtifactSchema,
} from "./types"

const base = oc.$route({ inputStructure: "detailed", outputStructure: "compact" })
const idParams = z.object({ id: z.uuid() })

export const artifactsContract = oc.router({
	list: base
		.route({ method: "GET", path: "/artifacts" })
		.input(z.object({ query: ListArtifactsQuerySchema }))
		.output(responseSchema(ListArtifactsResponseSchema)),

	get: base
		.route({ method: "GET", path: "/artifacts/{id}" })
		.input(z.object({ params: idParams }))
		.output(responseSchema(VisibleArtifactSchema)),

	create: base
		.route({ method: "POST", path: "/artifacts" })
		.input(z.object({ body: CreateArtifactBodySchema }))
		.output(responseSchema(CreatedArtifactSchema)),

	finalize: base
		.route({ method: "POST", path: "/artifacts/{id}/finalize" })
		.input(z.object({ params: idParams, body: FinalizeBodySchema }))
		.output(responseSchema(RevisionSchema)),

	/** Copies the Artifact through the serve boundary: same bytes, a fresh Artifact and first Revision. */
	duplicate: base
		.route({ method: "POST", path: "/artifacts/{id}/duplicate" })
		.input(z.object({ params: idParams }))
		.output(responseSchema(z.object({ artifact: ArtifactSchema, revision: RevisionSchema }))),

	move: base
		.route({ method: "POST", path: "/artifacts/{id}/move" })
		.input(z.object({ params: idParams, body: MoveArtifactBodySchema }))
		.output(responseSchema(ArtifactSchema)),

	setPublishPolicy: base
		.route({ method: "PATCH", path: "/artifacts/{id}/publish-policy" })
		.input(z.object({ params: idParams, body: SetPublishPolicyBodySchema }))
		.output(responseSchema(VisibleArtifactSchema)),

	setGeneralAccess: base
		.route({ method: "PATCH", path: "/artifacts/{id}/general-access" })
		.input(z.object({ params: idParams, body: SetGeneralAccessBodySchema }))
		.output(responseSchema(VisibleArtifactSchema)),

	/** Owner only. The password, expiry and download choices of Anyone with the link (ADR 0044). */
	setAnyoneSettings: base
		.route({ method: "PATCH", path: "/artifacts/{id}/anyone-settings" })
		.input(z.object({ params: idParams, body: SetAnyoneSettingsBodySchema }))
		.output(responseSchema(VisibleArtifactSchema)),

	/**
	 * Open to a signed-out reader. A right password sets the unlock cookie; a wrong one is
	 * `INCORRECT_PASSWORD`. An Artifact with no live password refuses as one that does not exist.
	 */
	unlock: base
		.route({ method: "POST", path: "/artifacts/{id}/unlock" })
		.input(z.object({ params: idParams, body: UnlockBodySchema }))
		.output(responseSchema(UnlockResponseSchema)),

	softDelete: base
		.route({ method: "DELETE", path: "/artifacts/{id}" })
		.input(z.object({ params: idParams }))
		.output(responseSchema(ArtifactSchema)),

	restore: base
		.route({ method: "POST", path: "/artifacts/{id}/restore" })
		.input(z.object({ params: idParams }))
		.output(responseSchema(ArtifactSchema)),

	search: base
		.route({ method: "GET", path: "/artifacts/search" })
		.input(
			z.object({
				query: z.object({
					q: z.string().min(1).max(200),
					projectId: z.uuid().optional(),
					limit: z.coerce.number().int().min(1).max(50).default(20),
				}),
			}),
		)
		.output(
			responseSchema(
				z.object({
					items: z.array(
						z.object({
							artifactId: z.uuid(),
							revisionId: z.uuid().nullable(),
							title: z.string(),
							kind: z.string(),
							projectId: z.uuid().nullable(),
							snippet: z.string(),
						}),
					),
				}),
			),
		),
})
