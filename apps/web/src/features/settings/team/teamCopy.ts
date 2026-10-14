export const NO_MEMBERS_MATCH = "No members match."

export const HAS_ACCOUNT_LABEL = "Has an account"

export const DEMOTE_TITLE = "Change your role to Member?"
export const DEMOTE_CONFIRM = "Change to Member"

export const removeMemberBody = (name: string) =>
	`${name} loses access to everything shared with them, and their connections are revoked. Access ends now; a file already open may stay readable for up to 5 minutes.`
export const SUCCESSOR_PROMPT = "Choose who takes over their files and folders"
export const SUCCESSOR_PLACEHOLDER = "Choose a member"

export const GROUPS_INTRO =
	"Share a file or folder with a group once. People added to the group later get the same access."
export const groupsEmpty = (admin: boolean) =>
	admin ? "No groups yet. Create one to share with several people at once." : "No groups yet."
export const GROUP_MODAL_INTRO = "Anything shared with this group reaches every member."
export const groupPickHint = (picked: number) => (picked > 0 ? `${picked} selected` : "Pick at least one")
export const issuedInviteNote = (email: string) =>
	`Invite link for ${email}. Send it yourself; it is shown only now and works for 7 days.`

export const DELETE_GROUP_BODY =
	"Everything shared with this group stops reaching its members through it. Anyone who was also given access directly keeps it."
