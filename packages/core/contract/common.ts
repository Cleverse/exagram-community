import { z } from "zod"

export const IdSchema = z.uuid()
export const ArtifactKindSchema = z.enum(["doc", "html", "chat", "pdf", "docx", "pptx", "xlsx", "image"])
export const RevisionStatusSchema = z.enum(["pending", "approved", "discarded"])
export const ExtractionStatusSchema = z.enum(["none", "queued", "done", "failed"])
export const AccessSchema = z.enum(["owner", "edit", "collaborate", "view"])
export const DefaultPinSchema = z.enum(["latest", "current"])
export const PublishPolicySchema = z.enum(["auto", "manual"])
export const LinkPreviewSchema = z.enum(["metadata", "generic"])
export const ArtifactScopeSchema = z.enum(["all", "sharedWithMe", "mine"])

export const UPLOAD_MAX_BYTES = 20971520
