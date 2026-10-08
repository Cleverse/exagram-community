/** Lower case without i, l, o; upper case without I, L, O; digits without 0 and 1. Nothing here reads as another character. */
export const ANYONE_PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"

const GROUP = 4
const GROUPS = 3
const LENGTH = GROUP * GROUPS

// A byte maps to the alphabet by remainder, which favours the first characters unless the top of the range
// is thrown away. The bytes at or above this limit are.
const UNBIASED_BELOW = 256 - (256 % ANYONE_PASSWORD_ALPHABET.length)

/** 12 characters as `xxxx-xxxx-xxxx`, each drawn evenly from the alphabet (about 69 bits). */
export const generatePassword = (
	fill: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
) => {
	let characters = ""
	while (characters.length < LENGTH) {
		for (const byte of fill(new Uint8Array(LENGTH * 2))) {
			if (byte < UNBIASED_BELOW && characters.length < LENGTH) {
				characters += ANYONE_PASSWORD_ALPHABET.charAt(byte % ANYONE_PASSWORD_ALPHABET.length)
			}
		}
	}
	return Array.from({ length: GROUPS }, (_, group) => characters.slice(group * GROUP, (group + 1) * GROUP)).join("-")
}
