import { useEffect, useRef, useState } from "react"

import { FrameLoadingOverlay } from "@/features/artifact/reading/FrameLoadingOverlay"

/**
 * `allow-same-origin` is never in this list. With it the frame could reach the reader's session on the
 * app origin; the CSP on the usercontent response is the other half of the boundary.
 */
export const SANDBOX = "allow-scripts"

/**
 * The sandboxed page rendered at a wider viewport and scaled down (or up) to the pane, so zooming
 * out shows more of a landing page instead of squeezing it into the pane's width.
 */
export const ScaledFrame = ({
	url,
	title,
	zoom,
	sandbox = SANDBOX,
	onLoad,
}: {
	url: string
	title: string
	zoom: number
	sandbox?: string | null
	onLoad?: () => void
}) => {
	const scale = zoom / 100
	return (
		<iframe
			className="absolute top-0 left-0 border-0 bg-white"
			style={{
				width: `${100 / scale}%`,
				height: `${100 / scale}%`,
				transform: `scale(${scale})`,
				transformOrigin: "0 0",
			}}
			sandbox={sandbox ?? undefined}
			referrerPolicy="no-referrer"
			src={url}
			title={`Contents of ${title}`}
			onLoad={onLoad}
		/>
	)
}

export const HtmlFrame = ({ url, title, zoom }: { url: string; title: string; zoom: number }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<>
			<ScaledFrame url={url} title={title} zoom={zoom} onLoad={() => setLoaded(true)} />
			{!loaded && <FrameLoadingOverlay />}
		</>
	)
}

export const ImageFrame = ({ url, title, zoom }: { url: string; title: string; zoom: number }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<>
			<img
				src={url}
				alt={title}
				className="h-full w-full object-contain"
				style={{ transform: `scale(${zoom / 100})` }}
				onLoad={() => setLoaded(true)}
				onError={() => setLoaded(true)}
			/>
			{!loaded && <FrameLoadingOverlay />}
		</>
	)
}

export const OfficeFrame = ({ url, title, zoom }: { url: string; title: string; zoom: number }) => {
	const [loaded, setLoaded] = useState(false)
	return (
		<>
			<ScaledFrame
				url={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(`${url}/file.pptx`)}`}
				title={title}
				zoom={zoom}
				sandbox={null}
				onLoad={() => setLoaded(true)}
			/>
			{!loaded && <FrameLoadingOverlay />}
		</>
	)
}

export const PdfFrame = ({ url, title, zoom }: { url: string; title: string; zoom: number }) => {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	const previousZoom = useRef(zoom)
	const [initialSrc] = useState(() => `${url}/view#zoom=${zoom}`)
	const [loaded, setLoaded] = useState(false)

	useEffect(() => {
		if (previousZoom.current === zoom) return
		previousZoom.current = zoom
		iframeRef.current?.contentWindow?.location.replace(`${url}/view#zoom=${zoom}`)
	}, [url, zoom])

	return (
		<>
			<iframe
				ref={iframeRef}
				className="absolute top-0 left-0 h-full w-full border-0 bg-white"
				sandbox={SANDBOX}
				referrerPolicy="no-referrer"
				src={initialSrc}
				title={`Contents of ${title}`}
				onLoad={() => setLoaded(true)}
			/>
			{!loaded && <FrameLoadingOverlay />}
		</>
	)
}

/** One body frame by kind (html, image, pdf or pptx), for a reader with a body token URL. */
export const BodyFrame = ({ kind, url, title, zoom }: { kind: string; url: string; title: string; zoom: number }) =>
	kind === "html" ? (
		<HtmlFrame key={url} url={url} title={title} zoom={zoom} />
	) : kind === "image" ? (
		<ImageFrame key={url} url={url} title={title} zoom={zoom} />
	) : kind === "pdf" ? (
		<PdfFrame key={url} url={url} title={title} zoom={zoom} />
	) : (
		<OfficeFrame key={url} url={url} title={title} zoom={zoom} />
	)
