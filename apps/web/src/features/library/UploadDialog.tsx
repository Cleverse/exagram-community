import { type Access, type PublishPolicy } from "@exagram/api-client"
import { useState } from "react"

import { Dialog } from "@/components/Dialog"
import { useToast } from "@/components/Toast"
import { Button } from "@/components/ui/Button"
import { IconUpload } from "@/components/ui/icons"
import { useUpload, type UploadStep } from "@/features/library/hooks/useUpload"
import { checkUpload, titleFromFilename, UPLOAD_ACCEPT } from "@/features/library/upload"

const STEP_LABEL: Record<UploadStep, string> = {
	preparing: "Preparing…",
	uploading: "Uploading…",
	saving: "Saving…",
}

/** Screen 2 field metrics: 44px control, white, `var(--color-line-soft)` border, 15px type. */
const INPUT_STYLE = {
	width: "100%",
	height: 44,
	padding: "0 14px",
	border: "1px solid var(--color-line-soft)",
	background: "#fff",
	fontSize: 15,
	outline: 0,
} as const

export const UploadDialog = ({
	projectId,
	artifactId = null,
	access = "owner",
	publishPolicy = "auto",
	initialFile = null,
	onClose,
}: {
	projectId: string | null
	artifactId?: string | null
	/** The caller's access on `artifactId`; an Editor's new Revision publishes at once. */
	access?: Access
	/** The policy governing the target: the file's own for a new Revision, the Project's for a new file. */
	publishPolicy?: PublishPolicy
	initialFile?: File | null
	onClose: () => void
}) => {
	const [file, setFile] = useState<File | null>(initialFile)
	const [title, setTitle] = useState(initialFile ? titleFromFilename(initialFile.name) : "")
	const [note, setNote] = useState("")
	const [step, setStep] = useState<UploadStep | null>(null)
	const [dragging, setDragging] = useState(false)
	const upload = useUpload(setStep)
	const toast = useToast()
	// Giving up on a failed new-Artifact upload deletes the empty Artifact it left; after a success it is a no-op.
	const close = () => {
		void upload.discard()
		onClose()
	}

	const problem = file ? checkUpload(file) : null

	return (
		<Dialog
			title={artifactId ? "Upload a new Revision" : "Upload to Exagram"}
			ariaLabel="Upload"
			onClose={close}
			helper={
				access === "collaborate"
					? "As a Collaborator, your new Revision waits for the Owner's approval before anyone else reads it."
					: publishPolicy === "manual"
						? "Manual approval only — this waits under Pending until the Owner publishes it."
						: "Publishes automatically — it becomes the current version as soon as it is saved."
			}
			width={560}
			footer={
				<>
					<Button variant="outline" size={40} onClick={close}>
						Cancel
					</Button>
					<Button
						variant="primary"
						size={40}
						disabled={!file || problem !== null || upload.isPending}
						onClick={() => {
							if (!file) return
							upload.mutate(
								{ file, title, projectId, artifactId, note: note || null },
								{
									onSuccess: (result) => {
										toast(
											result.status === "approved"
												? "Published — it is now the Current Revision"
												: access === "owner"
													? "Uploaded — it is waiting under Pending"
													: "Uploaded — it is waiting for the Owner's approval",
										)
										onClose()
									},
								},
							)
						}}
					>
						{step && upload.isPending ? STEP_LABEL[step] : artifactId ? "Save as a new Revision" : "Upload"}
					</Button>
				</>
			}
		>
			<div
				className="flex flex-col items-center justify-center text-center"
				style={{
					gap: 10,
					padding: "28px 20px",
					background: "#fff",
					border: `1px dashed ${dragging ? "var(--color-ink)" : "var(--color-line-soft)"}`,
					borderRadius: "var(--radius)",
				}}
				onDragOver={(event) => {
					event.preventDefault()
					setDragging(true)
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault()
					setDragging(false)
					const dropped = event.dataTransfer.files.item(0)
					if (!dropped) return
					setFile(dropped)
					if (!title) setTitle(titleFromFilename(dropped.name))
				}}
			>
				<IconUpload size={20} style={{ color: "var(--color-muted)" }} />
				<div style={{ fontSize: 15 }}>{file ? file.name : "Drop a file here"}</div>
				<label
					style={{
						fontSize: 14,
						fontWeight: 500,
						color: "var(--color-ink)",
						textDecoration: "underline",
						textUnderlineOffset: 3,
						cursor: "pointer",
					}}
				>
					{file ? "Change file" : "Choose a file"}
					<input
						type="file"
						aria-label="File"
						className="sr-only"
						accept={UPLOAD_ACCEPT}
						onChange={(event) => {
							const chosen = event.target.files?.item(0) ?? null
							setFile(chosen)
							if (chosen && !title) setTitle(titleFromFilename(chosen.name))
						}}
					/>
				</label>
			</div>

			<label className="flex flex-col" style={{ gap: 8 }}>
				<span style={{ fontSize: 14, fontWeight: 600 }}>{artifactId ? "What changed (optional)" : "Title"}</span>
				<input
					style={INPUT_STYLE}
					value={artifactId ? note : title}
					onChange={(event) => (artifactId ? setNote(event.target.value) : setTitle(event.target.value))}
				/>
			</label>

			{problem ? (
				<p role="alert" style={{ fontSize: 15, color: "var(--color-danger)" }}>
					{problem}
				</p>
			) : null}
			{upload.isError ? (
				<p role="alert" style={{ fontSize: 15, color: "var(--color-danger)" }}>
					{upload.error.message}
				</p>
			) : null}
		</Dialog>
	)
}
