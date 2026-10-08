import { FINDING_TYPES } from "@exagram/redactor"
import { z } from "zod"

export const FindingTypeSchema = z.enum(FINDING_TYPES)

export const RedactionStatusSchema = z.enum(["none", "queued", "done", "failed", "too_large"])
