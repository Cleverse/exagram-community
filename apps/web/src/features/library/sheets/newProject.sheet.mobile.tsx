import { type PublishPolicy } from "@exagram/api-client"
import clsx from "clsx"
import { useId, useState } from "react"
import { useNavigate } from "react-router"

import { Sheet } from "@/components/mobile/sheet/Sheet"
import { type SheetParams } from "@/components/mobile/sheet/types"
import { useToast } from "@/components/Toast"
import { edition } from "@/edition/edition"
import { useCreateProject, useSetProjectPublishPolicy } from "@/features/project/hooks/useProjectMutations"
import { PUBLISH_POLICY_OPTIONS } from "@/features/project/publishPolicy"
import { createdProjectMessage } from "@/features/project/useProjectSettingsModel"
import { useLoadedWorkspaceKind } from "@/features/workspace/useWorkspaceKind"
import { DEFAULT_PROJECT_SETTINGS, type ProjectSettings } from "@/mock/projectSettings"
import { writeMock } from "@/mock/store"
import { paths } from "@/routes/paths"

const FIELD_LABEL = "text-secondary"
const FIELD_LABEL_STYLE = { fontSize: 13, fontWeight: 500 } as const

/**
 * One publishing choice: an 18px ring that fills to a 6px ink border when chosen, the label and
 * its description. A real radio underneath, so it reads and keys as one.
 */
const PublishOption = ({
	name,
	value,
	checked,
	label,
	description,
	onSelect,
}: {
	name: string
	value: PublishPolicy
	checked: boolean
	label: string
	description: string
	onSelect: (value: PublishPolicy) => void
}) => (
	<label
		className={clsx(
			"flex cursor-pointer items-start border text-left",
			"has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink",
			checked ? "border-ink" : "border-line-strong",
		)}
		style={{ gap: 12, padding: 12, borderRadius: 6 }}
	>
		<input
			type="radio"
			name={name}
			value={value}
			checked={checked}
			onChange={() => onSelect(value)}
			className="sr-only"
		/>
		<span
			aria-hidden
			className={clsx("flex-none", checked ? "border-ink" : "border-control-edge")}
			style={{
				width: 18,
				height: 18,
				marginTop: 1,
				borderRadius: "50%",
				borderStyle: "solid",
				borderWidth: checked ? 6 : 2,
			}}
		/>
		<span>
			<span className="block" style={{ fontSize: 14.5, fontWeight: 500 }}>
				{label}
			</span>
			<span className="block text-muted" style={{ fontSize: 12.5, marginTop: 2, lineHeight: 1.45 }}>
				{description}
			</span>
		</span>
	</label>
)

/**
 * The New folder drawer, a sub-level of Create: name, the policy for Connections and the publishing
 * choice, then Create folder. It saves the way desktop's New folder does: create, then set the publish policy
 * when it is not the server's default, then keep the policy text in this browser (the API has no column for it
 * yet), and opens the new Project.
 */
export default function NewProjectSheet({ params }: { params: SheetParams["newProject"] }) {
	const navigate = useNavigate()
	const toast = useToast()
	const createProject = useCreateProject()
	const setPublishPolicy = useSetProjectPublishPolicy()
	const kind = useLoadedWorkspaceKind()
	const [name, setName] = useState("")
	const [policy, setPolicy] = useState("")
	const [publish, setPublish] = useState<PublishPolicy>("auto")
	const [saving, setSaving] = useState(false)
	const nameId = useId()
	const policyId = useId()
	const radioName = useId()

	const trimmed = name.trim()
	const disabled = trimmed === "" || saving

	const create = () => {
		if (disabled) return
		setSaving(true)
		const fail = (error: Error) => {
			setSaving(false)
			toast(error.message)
		}
		createProject.mutate(
			{ name: trimmed, parentProjectId: params.parentId },
			{
				onSuccess: (project) => {
					const done = () => {
						writeMock<ProjectSettings>(`project.${project.id}`, {
							...DEFAULT_PROJECT_SETTINGS,
							policy: policy.trim(),
						})
						toast(createdProjectMessage(trimmed, publish, kind))
						// Arriving on the Project closes the drawer (the provider closes on any path change).
						void navigate(paths.project(project.id))
					}
					// A new Project starts 'auto'; only a different choice needs a second call.
					if (publish === project.publishPolicy) done()
					else
						setPublishPolicy.mutate(
							{ projectId: project.id, publishPolicy: publish },
							{ onSuccess: done, onError: fail },
						)
				},
				onError: fail,
			},
		)
	}

	return (
		<Sheet title="New folder">
			<form
				className="flex flex-col"
				style={{ padding: "4px 16px 12px", gap: 16 }}
				onSubmit={(event) => {
					event.preventDefault()
					create()
				}}
			>
				<div className="flex flex-col" style={{ gap: 6 }}>
					<label htmlFor={nameId} className={FIELD_LABEL} style={FIELD_LABEL_STYLE}>
						Name
					</label>
					<input
						id={nameId}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. Q4 planning"
						autoComplete="off"
						className="border border-line-strong bg-white outline-none focus:border-ink"
						// 16px keeps iOS Safari from zooming the page when the field takes focus.
						style={{ height: 44, padding: "0 12px", borderRadius: 6, fontSize: 16 }}
					/>
				</div>

				{edition.projectRules ? (
					<div className="flex flex-col" style={{ gap: 6 }}>
						<label htmlFor={policyId} className={FIELD_LABEL} style={FIELD_LABEL_STYLE}>
							Policy for Connections
						</label>
						<textarea
							id={policyId}
							rows={4}
							value={policy}
							onChange={(event) => setPolicy(event.target.value)}
							placeholder="e.g. Answer only from files in this folder. Cite the file and revision for every claim."
							className="border border-line-strong bg-white outline-none focus:border-ink"
							style={{ padding: "10px 12px", borderRadius: 6, fontSize: 16, lineHeight: 1.5, resize: "none" }}
						/>
						<span className="text-muted-2" style={{ fontSize: 12 }}>
							Saved in this browser for now; Connections don't read it yet.
						</span>
					</div>
				) : null}

				{kind === "personal" ? null : (
					<fieldset className="m-0 flex flex-col border-0 p-0" style={{ gap: 6 }}>
						<legend className={FIELD_LABEL} style={{ ...FIELD_LABEL_STYLE, marginBottom: 6 }}>
							Publishing
						</legend>
						{PUBLISH_POLICY_OPTIONS.map((option) => (
							<PublishOption
								key={option.value}
								name={radioName}
								value={option.value}
								checked={publish === option.value}
								label={option.label}
								description={option.description}
								onSelect={setPublish}
							/>
						))}
					</fieldset>
				)}

				<button
					type="submit"
					disabled={disabled}
					className={disabled ? "bg-row-selected text-muted-2" : "bg-ink text-white active:bg-primary-hover"}
					style={{ height: 46, borderRadius: 6, fontSize: 15, fontWeight: 500 }}
				>
					{saving ? "Creating…" : "Create folder"}
				</button>
			</form>
		</Sheet>
	)
}
