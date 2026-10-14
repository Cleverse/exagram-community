/** The name a deleted account keeps, so what it wrote and read still names someone. */
export const DELETED_PERSON_NAME = "Deleted person"

/** The person typed their account's address: case and surrounding spaces aside, as the database compares it. */
export const confirmsAccountEmail = (typed: string, email: string): boolean =>
	typed.trim().toLowerCase() === email.toLowerCase()
