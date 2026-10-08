import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { parse, parseAllDocuments } from "yaml"

const DEPLOY_DIR = fileURLToPath(new URL("../../../deploy/", import.meta.url))

export const CHART_DIR = join(DEPLOY_DIR, "helm/exagram")

/** `deploy/helm/exagram/ci/*.yaml`, the values files CI renders the chart with. */
export const CI_VALUES_FILES = readdirSync(join(CHART_DIR, "ci"))
	.filter((name) => name.endsWith(".yaml"))
	.sort()
	.map((name) => join(CHART_DIR, "ci", name))

/** The helm binary to use: `HELM_BIN`, else `helm` on PATH; null when neither runs. */
export function findHelm(): string | null {
	for (const candidate of [process.env.HELM_BIN, "helm"]) {
		if (!candidate) continue
		try {
			execFileSync(candidate, ["version", "--short"], { stdio: "pipe" })
			return candidate
		} catch {
			// try the next one
		}
	}
	return null
}

export interface EnvVar {
	name: string
	value?: string
	valueFrom?: { secretKeyRef?: { name: string; key: string; optional?: boolean } }
}

export interface VolumeMount {
	name: string
	mountPath: string
	readOnly?: boolean
}

export interface Container {
	name: string
	env?: EnvVar[]
	envFrom?: unknown[]
	volumeMounts?: VolumeMount[]
}

export interface PodSpec {
	affinity?: { podAffinity?: { requiredDuringSchedulingIgnoredDuringExecution?: unknown[] } }
	initContainers?: Container[]
	containers: Container[]
}

export interface Manifest {
	apiVersion: string
	kind: string
	metadata: { name: string; labels?: Record<string, string>; annotations?: Record<string, string> }
	spec?: Record<string, unknown>
	data?: Record<string, string>
}

const renders = new Map<string, Manifest[]>()

/** `helm template t <chart> <args>`, parsed; memoized per argument list. Throws helm's stderr on failure. */
export function helmTemplate(helm: string, args: string[]): Manifest[] {
	const cacheKey = JSON.stringify(args)
	const cached = renders.get(cacheKey)
	if (cached) return cached
	let output: string
	try {
		output = execFileSync(helm, ["template", "t", CHART_DIR, ...args], { encoding: "utf8", stdio: "pipe" })
	} catch (error) {
		const stderr = (error as { stderr?: Buffer | string }).stderr?.toString() ?? String(error)
		throw new Error(`helm template ${args.join(" ")} failed: ${stderr}`)
	}
	const manifests = parseAllDocuments(output)
		.map((doc) => doc.toJS() as Manifest | null)
		.filter((manifest): manifest is Manifest => manifest !== null)
	renders.set(cacheKey, manifests)
	return manifests
}

export interface Workload {
	kind: string
	name: string
	labels: Record<string, string>
	pod: PodSpec
}

/** Deployments, StatefulSets and Jobs by their `app.kubernetes.io/component` label. */
export function workloads(manifests: Manifest[]): Map<string, Workload> {
	const result = new Map<string, Workload>()
	for (const manifest of manifests) {
		if (!["Deployment", "StatefulSet", "Job"].includes(manifest.kind)) continue
		const template = manifest.spec?.template as { metadata: { labels: Record<string, string> }; spec: PodSpec }
		const component = template.metadata.labels["app.kubernetes.io/component"]
		if (component === undefined) throw new Error(`${manifest.kind} ${manifest.metadata.name} has no component label`)
		result.set(component, {
			kind: manifest.kind,
			name: manifest.metadata.name,
			labels: template.metadata.labels,
			pod: template.spec,
		})
	}
	return result
}

/** The container (init or main) of a workload, by name. */
export function container(workload: Workload, name: string): Container {
	const found = [...(workload.pod.initContainers ?? []), ...workload.pod.containers].find((c) => c.name === name)
	if (!found) throw new Error(`${workload.name} has no container ${name}`)
	return found
}

/**
 * A container's environment as the kubelet would set it: plain values as written, secretKeyRef values
 * from the rendered Secret. An optional ref to a missing key leaves the variable unset.
 */
export function resolveEnv(target: Container, manifests: Manifest[]): Record<string, string> {
	const env: Record<string, string> = {}
	for (const variable of target.env ?? []) {
		const ref = variable.valueFrom?.secretKeyRef
		if (ref === undefined) {
			env[variable.name] = variable.value ?? ""
			continue
		}
		const secret = manifests.find((m) => m.kind === "Secret" && m.metadata.name === ref.name)
		const encoded = secret?.data?.[ref.key]
		if (encoded === undefined) {
			if (ref.optional) continue
			throw new Error(`${target.name}: ${variable.name} reads ${ref.name}/${ref.key}, which the render doesn't hold`)
		}
		env[variable.name] = Buffer.from(encoded, "base64").toString("utf8")
	}
	return env
}

export interface ComposeService {
	/** Key to its raw compose value, e.g. "${S3_BUCKET:-}". */
	env: Record<string, string>
	/** Mount target to read-only flag. */
	mounts: Record<string, boolean>
}

interface ComposeFile {
	services: Record<
		string,
		{
			environment?: Record<string, unknown>
			volumes?: (string | { target: string; read_only?: boolean })[]
		}
	>
}

/** One service across compose layers (later layers add keys or override values), e.g. ["compose.yml", "compose.postgres.yml"]. */
export function composeService(service: string, layers: string[]): ComposeService {
	const result: ComposeService = { env: {}, mounts: {} }
	for (const layer of layers) {
		const file = parse(readFileSync(join(DEPLOY_DIR, layer), "utf8")) as ComposeFile
		const definition = file.services[service]
		if (!definition) continue
		for (const [key, value] of Object.entries(definition.environment ?? {})) result.env[key] = String(value)
		for (const volume of definition.volumes ?? []) {
			if (typeof volume === "string") {
				const [, target, mode] = volume.split(":")
				if (target === undefined) throw new Error(`${layer} ${service}: unreadable volume ${volume}`)
				result.mounts[target] = mode === "ro"
			} else {
				result.mounts[volume.target] = volume.read_only === true
			}
		}
	}
	if (Object.keys(result.env).length === 0 && Object.keys(result.mounts).length === 0) {
		throw new Error(`service not found in deploy/${layers.join(", ")}: ${service}`)
	}
	return result
}

/** Compose keys written `${X:-}`: unset in .env renders "", so a deployment may leave them out entirely. */
export function isOptionalComposeValue(value: string): boolean {
	return /^\$\{[A-Z0-9_]+:-\}$/.test(value)
}
