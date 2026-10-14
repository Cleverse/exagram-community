import { findPlaceholderTypes } from "./redact"

import type { Detector } from "./redactor.port"

/**
 * The version the built-in detector records. Below MIN_ACCEPTED_DETECTOR_VERSION, so a Revision it marks `done` never
 * satisfies a redacted Connection read, and an install that later adds a Detector re-checks it.
 */
export const NULL_DETECTOR_VERSION = 0

/** The built-in Detector: reports no Findings. Implement `Detector` (redactor.port.ts) to detect sensitive data. */
export const nullDetector: Detector = { version: NULL_DETECTOR_VERSION, detect: () => [] }

/**
 * The row the redact job stores under `nullDetector`. No second plaintext copy, but the placeholders the author
 * typed, so approving a Connection's Revision that holds `[EMAIL]` still asks for confirmation (EXR02).
 */
export const nullRedaction = (text: string) => ({
	redactedText: "",
	detectorVersion: NULL_DETECTOR_VERSION,
	placeholderTypes: findPlaceholderTypes(text),
})
