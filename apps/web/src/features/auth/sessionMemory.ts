const forgetters = new Set<() => void>()

/** Registers what to forget from memory when the person at this browser may change: state read back from storage. */
export const forgetAtSessionBoundary = (forget: () => void) => {
	forgetters.add(forget)
}

export const forgetSessionMemory = () => {
	for (const forget of forgetters) forget()
}
