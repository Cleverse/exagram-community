# Exagram

A store for documents and AI-made artifacts, shared with named people and with AI tools over MCP, where every read is
recorded.

## Language

### Store

**Artifact**: One file in the store: a Markdown or text doc, an HTML page, a chat transcript, or an uploaded PDF, docx,
pptx, xlsx or image. Has Revisions and one Owner. _Avoid_: document, file, share, note

**Revision**: An immutable content version of an Artifact, numbered in order. History is append-only; a restore writes a
new Revision equal to an old one. _Avoid_: version, snapshot, upload

**Restore**: Writing a new Revision equal to an earlier approved one. Always waits for the Approver, whatever the
Publish Policy. Not bringing back a deleted Artifact, which the API also calls restore. _Avoid_: revert, rollback

**Discarded**: A Pending Revision the Approver turned down. It stays in history, readable only by the Owner and the
Owner's Connections. _Avoid_: rejected, deleted

**Current Revision**: The newest approved Revision of an Artifact. What a follow-latest Grant, a Connection and a Link
serve. _Avoid_: latest, head

**Pending Revision**: A Revision waiting for the Approver. Some Revisions wait and some do not:

- Every Revision a Collaborator writes waits, directly or through a Connection.
- A Connection's Revision whose body carries a redaction placeholder waits, whatever the policy.
- Every Restore waits, whatever the policy.
- Under a manual Publish Policy, every Revision waits, the Owner's own included.
- Under an auto Publish Policy, an Owner's or Editor's upload or Connection write is published on arrival and never
  waits.

Visible only to its Author and the Approver, and to a Connection only when that Connection wrote it or acts for the
Owner; absent from every other read, including counts. _Avoid_: draft, proposal, unapproved

**Extracted Text**: The text pulled from an uploaded PDF, docx, pptx or xlsx Revision. What AI reads for those kinds;
the bytes stay intact. _Avoid_: parsed content, OCR output

**Library**: The screen listing the Artifacts a person reaches: all of them, those shared with them, or their own.
_Avoid_: drive, files

**Project**: An owner's named group of Artifacts, one level of sub-Project deep. Grants on a Project cover every
Artifact in it. The UI calls any Project a "folder" and a sub-Project a "subfolder"; code and API keep `project`.
_Avoid_: collection, workspace

**Owner**: The person who created a Project, and through it every Artifact inside; an Artifact outside any Project is
owned by its creator. The only person who sees its full history and its Ledger rows, and its Approver. An Artifact moves
only between one Owner's Projects. _Avoid_: creator, author, admin, workspace owner (see Workspace Owner)

**Author**: The person or Connection that wrote a Revision. Authorship never confers ownership. _Avoid_: uploader,
creator

### Approval

**Approver**: The Owner of the Project an Artifact sits in, or of the Artifact itself when it sits in none. Approves or
discards Pending Revisions. _Avoid_: reviewer, moderator

**Approval**: The Owner's act that turns a Pending Revision into the Current Revision; the UI button says "Approve". A
Pending Revision reaches a Grant or a Link only through Approval, and a Connection reads past it only by asking for a
Revision it wrote or its person owns. A Revision published on arrival under an auto Publish Policy never needed one.
_Avoid_: merge, accept, auto-approve

**Publish Policy**: The rule for whether a Project's new Revisions go live without Approval.

- auto (the default): an Owner's or Editor's upload or Connection write is published on arrival, meaning it is approved
  and becomes the Current Revision at once.
- manual: every Revision waits as Pending for the Approver.

Collaborator Revisions, Connection Revisions carrying a redaction placeholder, and every Restore wait under either
value. Any Artifact may carry its own value, which overrides its Project's. A sub-Project carries its own value and does
not inherit its parent's. An Artifact outside any Project with no value of its own follows auto. The UI says "Publish
automatically" or "Manual approval only". _Avoid_: auto-approve, approval mode, review setting

### Sharing

**Grant**: One named person's access to one Artifact or Project: role view, collaborate or edit, following latest or
pinned to one Revision (only an Artifact Grant can be pinned). Artifacts are private until granted. _Avoid_: share,
permission, ACL, invite

**Editor**: A grantee with role edit. Reads, invites others up to Editor, and writes Revisions that follow the Publish
Policy, publishing on arrival under auto, like the Owner's. Cannot approve, change roles, remove Grants, set Pins or
change the policy; those stay the Owner's. _Avoid_: contributor, writer

**Viewer**: A grantee with role view. Reads, and cannot invite anyone. _Avoid_: reader

**Collaborator**: A grantee with role collaborate, between view and edit. Reads, invites others up to Collaborator, and
writes Revisions that always wait for the Approver, whatever the Publish Policy. _Avoid_: contributor, commenter

**Pin**: A Grant or Link fixed to one approved Revision. A pinned reader is served that Revision and never learns a
newer one exists. _Avoid_: version lock, freeze

**Pinned (sidebar)**: An Artifact pinned for the Workspace so it shows in everyone's sidebar; UI "Pin for org". Not a
Pin.

**Comment**: A remark by a grantee or the Owner, attached to one Revision. Never waits for Approval; a pinned reader
sees only Comments on their pinned Revision. _Avoid_: annotation, note, review

**Access Request**: A member's ask, from the refusal screen of a file they cannot read, that its Owner give them access
at a role they request, with an optional note. The answer is the same whether the file exists or the request was kept,
and the screen names neither the file nor its Owner. Only the Owner sees one, in Activity, and grants it (an ordinary
Grant, defaulting to the requested role) or declines it; either answer reaches the requester as a Notification, and a
decline stops the same person asking again for 7 days. The requester may cancel. Files only, in-app only. _Avoid_:
permission request, access ask, share request

**Default Pin**: The Artifact's setting for what a new Grant gets: follow latest or the Current Revision at grant time.

**Link**: An anonymous URL to one Artifact at one pinned Revision, with an expiry and an optional view limit. Opens
without sign-in; the Owner can revoke it. _Avoid_: public link, share link, handoff link

**Link Preview**: What a chat app shows when someone pastes an Artifact's or Project's address: its title and kind, or a
generic card when the Project's Owner chooses that; an Artifact in no Project always shows its title. Not a read, and
nothing to do with a Link. _Avoid_: unfurl card, OG preview

**Workspace**: A space of people, Projects and Artifacts: a Personal Workspace or a Team. One sign-in per person. Any
email can be shared with: one that is not yet a Member becomes an Invited Member (never an admin) whose Grants start
working at their first Google sign-in with that email, or their sign-up through an Admin's Join Link for it, and until
then the Share dialog lists them as invited and the sharer sends them the link (no email is sent). Being shared with
never decides someone's Workspace: the unclaimed row goes when its last Grant is removed. _Avoid_: tenant, organization

**Personal Workspace**: The Workspace every person has exactly one of, holding only their own files and the files shared
with them from Workspaces they are not a member of. It shares to any email, one person at a time, and can open an
Artifact to Anyone with the link; it has no Publish Policy, Pending Revisions or Collaborators. Code says
`kind = 'personal'`. _Avoid_: private workspace, my space, solo workspace

**Team**: A Workspace people share: Members, Admins, Invites and everything this glossary says about joining. A person
belongs to at most one live Team. Code says `kind = 'team'`; the Settings tab listing a Team's Members is also labelled
Team. _Avoid_: organization, company workspace

**Invited Member**: The member an email becomes when it is shared with before anyone holds it: listed as invited, its
Grants start working at that email's first Google sign-in, or at a sign-up through an Admin's Join Link for that email
(a password alone never claims it). _Avoid_: pending member, guest

**Invite**: A pending offer for one email to join the Workspace as a Member, carried by a Join Link and expiring after 7
days. Only an Admin sends one. Not a Grant: in code and docs "invite" means this; the Share dialog's "Invite … as
Viewer" creates a Grant. _Avoid_: invitation (in code)

**Join Link**: The URL carrying an Invite's token, shown to its sender once; the sender passes it on. Not a **Link**. UI
copy says "invite link" ("Create invite link"); code and docs say Join Link. _Avoid_: share link

**Reset Link**: A single-use URL, valid for an hour, that sets a new password for one Member who already has one and
ends their browser sessions; their Connections keep working. An Admin creates it on a Self-hosted install for a Member
who is not an Admin and sends it themselves; an Admin's own comes from a server command. Not a **Link**. _Avoid_: magic
link, recovery link

**Member**: A person who belongs to the Workspace and is not Removed. Every Member is an Admin or not; the role select
says "Admin" or "Member". An Invited Member is not listed among them until they sign in. The Settings tab listing them
is labelled Team; code and API keep `workspace`. _Avoid_: user (in UI copy), teammate

**Admin**: The install's administrator: the first account, and any Member it promotes. Manages Members, makes Join Links
and Reset Links, and reads Audit. Reads Artifact bodies only as anyone else does, through a Grant, or as the Owner of
what they took over by naming themselves when removing a Member. _Avoid_: superuser, owner

**Workspace Owner**: The person who created the Workspace (`workspaces.owner_id`). Always an Admin; cannot be demoted or
removed. The Settings tab listing Members tags them "Owner"; nowhere else does. Not the **Owner** of any Artifact or
Project by virtue of it. Never shortened to "Owner" in code or docs.

**Removed**: A Member's state after an Admin removes them (`users.removed_at`). The row stays so authorship, Comments
and Ledger rows keep a name; the person cannot sign in, holds no Grants, Links, Connections or sessions, and is found by
no people lookup. What they owned went to the Member the Admin named. _Avoid_: deleted, deactivated

**Last active**: When a Member last used the web app, to within 5 minutes. Admins only. _Avoid_: last seen, online

**Audit**: The Admins' view of the whole install's Ledger. _Avoid_: logs, activity

**Activity**: The member's feed of events, Pending Revisions awaiting them and open Access Requests on files they own;
the default landing screen.

**Live Update**: A signal over a tab's one event stream that something changed on an Artifact the member reaches; the
page refetches, it never receives content. A Link's page learns only that the Link has ended. _Avoid_: push,
notification, sync

**Notification**: Something new for a person, listed in the web app: an Access Request, a Pending Revision awaiting
them, a Grant to them, someone else's comment, an answer to their own request or Revision, a new Revision in their
revision scope, or a new Connection of theirs. Metadata only, from `GET /v1/notifications`. Not a Live Update. _Avoid_:
alert, push

**Notification Preferences**: The member's account-level choices, kept on the server and shared by their devices: which
kinds they want, the revision scope (which folders new Revisions come from: every folder, folders they belong to, or
none), muted folders, and quiet hours. Per-device settings are not Notification Preferences.

### AI access

**Connection**: One AI tool's OAuth grant for one person, bound to scopes read, write, manage. It reaches what its
person reaches — their own Artifacts and their Grants — and nothing more. Its Folder Access can narrow that reach to
named Projects and Other files. _Avoid_: integration, token, client, session

**Scope**: What a Connection may do: read, write (create Revisions, which follow the Publish Policy), manage (remove or
re-role Grants).

**Folder Access**: A Connection's optional narrowing of its reach: all folders, or named Projects each at view or edit,
plus Other files at view or not at all. What it may do is the lower of this and its person's access at that moment. Not
a Scope. _Avoid_: folder scope, project picking

**Other files**: Artifacts in no Project, and Artifacts reached only through a direct Grant when their Project is not
visible to the person. A narrowed Connection may read these when its Folder Access includes them, but cannot write them.

**Finding**: One sensitive value detected in a Revision's body: its type and where it sits. _Avoid_: span, hit, match,
entity

**Redacted Text**: What a Connection reads for a Revision when redaction is on: the body, or its Extracted Text, with
every Finding replaced. People reading through a Grant or a Link get the original. Produced by the configured Detector
(`packages/redactor`); the built-in one reports no Findings, so it produces none. _Avoid_: sanitized derivative, masked
text, scrubbed, safe text

**Withheld**: The outcome in any of these cases:

- a reader lacks a Grant;
- a Connection's Folder Access leaves the Artifact out;
- a Revision is Pending;
- a Connection's read needs Redacted Text that does not exist yet.

Ledgered; the response never distinguishes it from not found. _Avoid_: denied, hidden, filtered

**Ledger**: The record of every read of an Artifact: who, which Connection or Link; which Revision, when, whether
original or Redacted Text, and what was withheld. It also records every Admin action on the Workspace (roles, removals,
Invites), naming whom it acted on. Owners see rows for their Artifacts; admins see all in Audit. _Avoid_: history,
analytics

### Deployment

**Self-hosted**: An Exagram install run on infrastructure its operator controls, including a database or storage they
bring. _Avoid_: on-prem, local, compose deployment, BYOC

**Edition**: The build an install runs, which `auth.providers` reports; this repository builds `community`. _Avoid_:
tier, plan
