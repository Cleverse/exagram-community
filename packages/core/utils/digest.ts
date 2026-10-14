import { createHash } from "node:crypto"

export const sha256Hex = (body: Buffer): string => createHash("sha256").update(body).digest("hex")
