export const DELETE_ACCOUNT_SECTION =
	"Permanently delete your account and everything in your Personal Workspace. This cannot be undone."

export const DELETE_ACCOUNT_LEAD = "Deleting your account is immediate and permanent. It cannot be undone."

export const DELETED_HEADING = "What is deleted"

export const DELETED_ITEMS: readonly string[] = [
	"Your Personal Workspace and everything in it, including files, their history, folders, sharing and links.",
	"Your Connections.",
]

export const STAYS_HEADING = "What stays"

/** The Team line is for a person who has one; the rest stays under "Deleted person" whoever they are. */
export const staysItems = (inTeam: boolean): readonly string[] => [
	...(inTeam ? ["In your Team, files and folders you own move to the Team's Workspace Owner."] : []),
	"Your comments, Revisions and recorded reads in other Workspaces stay under the name “Deleted person”.",
]

export const CONFIRM_EMAIL_LABEL = "Type your email address to confirm"
