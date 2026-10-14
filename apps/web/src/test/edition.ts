/**
 * The `asCommunity*` helpers put this edition's values in place for the rest of a test. They are already in place
 * here, so each helper does nothing; shared tests call them so the same case runs in every edition.
 */

/** Runs the rest of the test with this edition's General Access: no `org` choice, and its words for a stored one. */
export const asCommunityGeneralAccess = () => undefined

/** Runs the rest of the test with this edition's Invites: Member only, and a link to copy only where Google signs in. */
export const asCommunityInvites = () => undefined

/** Runs the rest of the test with this edition's weekly recap: an empty library shows an empty week, never a sample. */
export const asCommunityRecap = () => undefined

/** Runs the rest of the test with this edition's sign-in page: no sign-in email, so the password form always shows. */
export const asCommunityEmailSignIn = () => undefined

/** Runs the rest of the test with this edition's sign-in page: no desktop app link and no Mac server footer. */
export const asCommunityMacApp = () => undefined

/** Runs the rest of the test with this edition's sign-in page and Settings: both follow the providers the install offers. */
export const asCommunityProviders = () => undefined
