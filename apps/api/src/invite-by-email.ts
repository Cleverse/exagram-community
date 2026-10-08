/** Whether a share may create an Invited Member: Google can claim it, or the edition relies on a Join Link (ADR 0034). */
export const inviteByEmail = (input: { googleConfigured: boolean; inviteWithoutGoogle: boolean }): boolean =>
	input.googleConfigured || input.inviteWithoutGoogle
