/** Bump on any change to a rule, a checksum or the normalized view. */
export const DETECTOR_VERSION = 1

/**
 * The oldest detector a Connection read still accepts. A bump of DETECTOR_VERSION normally leaves
 * this one behind, so AI reads keep working on the prior Redacted Text while the sweeper catches
 * up; a rule fix that cannot wait raises this one with it and withholds until it has.
 */
export const MIN_ACCEPTED_DETECTOR_VERSION = 1

/** A served body larger than this is never detected over; the Revision becomes `too_large`. */
export const REDACTION_LIMIT_BYTES = 5 * 1024 * 1024

export const FINDING_TYPES = [
	"EMAIL",
	"PHONE",
	"CREDIT_CARD",
	"IBAN",
	"TH_NATIONAL_ID",
	"US_SSN",
	"IP_ADDRESS",
	"SECRET_AWS_KEY",
	"SECRET_GITHUB_TOKEN",
	"SECRET_PRIVATE_KEY",
	"SECRET_JWT",
	"EXAGRAM_LINK",
] as const

export type FindingType = (typeof FINDING_TYPES)[number]

/** `start` and `end` are offsets into the ORIGINAL string. A Finding never carries the value. */
export interface Finding {
	type: FindingType
	start: number
	end: number
}

export interface DetectorOptions {
	/**
	 * This deployment's own origins, e.g. `["https://app.exagram.test"]`. A Link opens the original
	 * without sign-in, so one left in a body is a way around redaction for an AI tool with network
	 * access; the origins are an input rather than a constant to keep this package free of config.
	 */
	linkOrigins: readonly string[]
}

export interface Detector {
	readonly version: number
	/** Findings sorted by start, non-overlapping. `redact` applies them in order and does not merge. */
	detect(text: string): Finding[]
}
