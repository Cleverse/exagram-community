import { findPlaceholderTypes } from "./redact"

import type { Detector } from "./redactor.port"

/**
 * For an install without detection. Below MIN_ACCEPTED_DETECTOR_VERSION, so a Revision it marks `done` never
 * satisfies a redacted Connection read, and a later install with a real detector re-detects it.
 */
export const NULL_DETECTOR_VERSION = 0

export const nullDetector: Detector = { version: NULL_DETECTOR_VERSION, detect: () => [] }

/**
 * The row the redact job stores under the null detector. No second plaintext copy, but the placeholders the author
 * typed, so approving a Connection's Revision that holds `[EMAIL]` still asks for confirmation (EXR02, P34).
 */
export const nullRedaction = (text: string) => ({
	redactedText: "",
	detectorVersion: NULL_DETECTOR_VERSION,
	placeholderTypes: findPlaceholderTypes(text),
})
