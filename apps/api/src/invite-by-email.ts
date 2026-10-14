/**
 * Whether a share may create a row for an email nobody holds: the install can prove the email, or the
 * edition relies on an Admin's Join Link to claim it.
 */
export const inviteByEmail = (input: { emailProof: boolean; inviteWithoutGoogle: boolean }): boolean =>
	input.emailProof || input.inviteWithoutGoogle
