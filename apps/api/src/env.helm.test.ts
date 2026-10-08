import { basename } from "node:path"

import {
	CI_VALUES_FILES,
	composeService,
	container,
	findHelm,
	helmTemplate,
	isOptionalComposeValue,
	resolveEnv,
	workloads,
} from "@exagram/core/test/helm-render"
import { describe, expect, it } from "vitest"

import type { Container, Manifest, Workload } from "@exagram/core/test/helm-render"

import { parseEnv } from "./env"
import { runPreflight } from "./preflight"

// The Secret is read from the render: `lookup` finds nothing under `helm template`, so Sprig generates
// every key fresh, which also proves its output (randAlphaNum, genPrivateKey "rsa") satisfies the schemas.
const helm = findHelm()
const helmDescribe = helm === null ? describe.skip : describe
// CI installs helm, so this never skips there.
const SUITE = `helm chart env contract${helm === null ? " (skipped: no helm binary; set HELM_BIN or put helm on PATH)" : ""}`
const RENDER_TIMEOUT = 60_000

const render = (...args: string[]): Manifest[] => helmTemplate(helm!, args)
const renderCi = (file: string): Manifest[] => render("-f", file)
const ciFile = (name: string): string => CI_VALUES_FILES.find((file) => basename(file) === `${name}.yaml`)!

function workload(manifests: Manifest[], component: string): Workload {
	const found = workloads(manifests).get(component)
	if (!found) throw new Error(`render has no ${component} workload`)
	return found
}

function mounts(target: Container): Record<string, boolean> {
	return Object.fromEntries((target.volumeMounts ?? []).map((m) => [m.mountPath, m.readOnly === true]))
}

// chart container -> compose service. The bundled layer only overrides values, so compose.yml plus
// compose.postgres.yml gives the key set for every database layout.
const PARITY = [
	{ component: "api", container: "api", service: "api" },
	{ component: "worker", container: "worker", service: "worker" },
	{ component: "usercontent", container: "usercontent", service: "usercontent" },
	{ component: "migrate", container: "preflight", service: "preflight" },
	{ component: "migrate", container: "migrate", service: "migrate" },
]

/** An in-memory STORAGE_DIR: preflight's probe write, read-back, hard link and removal all succeed. */
function memoryFs() {
	const files = new Map<string, string>()
	return {
		log: () => {},
		warn: () => {},
		uid: 1000,
		writeFile: (path: string, data: string) => void files.set(path, data),
		readFile: (path: string) => {
			const data = files.get(path)
			if (data === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" })
			return data
		},
		link: (existing: string, created: string) => void files.set(created, files.get(existing)!),
		unlink: (path: string) => void files.delete(path),
	}
}

helmDescribe(SUITE, () => {
	for (const file of CI_VALUES_FILES) {
		describe(basename(file), () => {
			it(
				"sets only api env keys apps/api's schema accepts",
				() => {
					const env = resolveEnv(container(workload(renderCi(file), "api"), "api"), renderCi(file))
					expect(() => parseEnv(env)).not.toThrow()
				},
				RENDER_TIMEOUT,
			)

			it(
				"gives api, worker, usercontent and the migrate Job compose.yml's env keys and mounts",
				() => {
					const manifests = renderCi(file)
					const filesystem = workload(manifests, "api").pod.containers[0]?.env?.some(
						(v) => v.name === "STORAGE_DRIVER" && v.value === "filesystem",
					)
					for (const entry of PARITY) {
						const chart = container(workload(manifests, entry.component), entry.container)
						const compose = composeService(entry.service, ["compose.yml", "compose.postgres.yml"])
						const chartKeys = (chart.env ?? []).map((v) => v.name)
						const label = `${entry.component}/${entry.container}`

						expect(
							chartKeys.filter((key) => !(key in compose.env)),
							`${label}: keys compose doesn't pass`,
						).toEqual([])
						const missing = Object.keys(compose.env).filter((key) => !chartKeys.includes(key))
						expect(
							missing.filter((key) => !isOptionalComposeValue(compose.env[key]!)),
							`${label}: required compose keys the chart leaves out`,
						).toEqual([])
						expect(new Set(chartKeys).size, `${label}: duplicate env keys`).toBe(chartKeys.length)

						// The chart drops the objects claim when the store is a bucket; compose always mounts its volume.
						const want = { ...compose.mounts }
						if (!filesystem) delete want["/var/lib/exagram/objects"]
						expect(mounts(chart), `${label}: mounts`).toEqual(want)
					}
				},
				RENDER_TIMEOUT,
			)

			it(
				"passes preflight with the env its init container gets",
				() => {
					const manifests = renderCi(file)
					const env = resolveEnv(container(workload(manifests, "migrate"), "preflight"), manifests)
					expect(() => runPreflight(env, memoryFs())).not.toThrow()
				},
				RENDER_TIMEOUT,
			)
		})
	}

	describe("templates", () => {
		it(
			"acme mode exposes web as a LoadBalancer that keeps the client address",
			() => {
				const service = renderCi(ciFile("default")).find(
					(m) => m.kind === "Service" && m.metadata.name === "t-exagram-web",
				)
				expect(service?.spec).toMatchObject({ type: "LoadBalancer", externalTrafficPolicy: "Local" })
			},
			RENDER_TIMEOUT,
		)

		it(
			"filesystem storage puts the objects pod affinity on exactly api, worker, usercontent and the migrate Job",
			() => {
				const objectsTerm = {
					labelSelector: { matchLabels: { "exagram.io/objects": "t" } },
					topologyKey: "kubernetes.io/hostname",
				}
				const withAffinity = [...workloads(renderCi(ciFile("default")))]
					.filter(([, w]) =>
						(w.pod.affinity?.podAffinity?.requiredDuringSchedulingIgnoredDuringExecution ?? []).some(
							(term) => JSON.stringify(term) === JSON.stringify(objectsTerm),
						),
					)
					.map(([component, w]) => {
						expect(w.labels["exagram.io/objects"]).toBe("t")
						return component
					})
				expect(withAffinity.sort()).toEqual(["api", "migrate", "usercontent", "worker"])
			},
			RENDER_TIMEOUT,
		)

		it(
			"s3 storage renders no objects claim and no pod affinity",
			() => {
				const manifests = renderCi(ciFile("s3"))
				expect(manifests.filter((m) => m.kind === "PersistentVolumeClaim").map((m) => m.metadata.name)).toEqual([
					"t-exagram-caddy-data",
				])
				for (const [, w] of workloads(manifests)) {
					expect(w.pod.affinity, w.name).toBeUndefined()
					expect(w.labels["exagram.io/objects"], w.name).toBeUndefined()
				}
			},
			RENDER_TIMEOUT,
		)

		it(
			"ingress mode renders the NetworkPolicy and Caddy's external TLS mode behind a ClusterIP",
			() => {
				const manifests = renderCi(ciFile("ingress"))
				expect(manifests.some((m) => m.kind === "NetworkPolicy")).toBe(true)
				expect(manifests.some((m) => m.kind === "Ingress")).toBe(true)
				const web = resolveEnv(container(workload(manifests, "web"), "web"), manifests)
				expect(web).toMatchObject({ EXAGRAM_TLS: "external", EXAGRAM_SITE_SCHEME: "http://" })
				const service = manifests.find((m) => m.kind === "Service" && m.metadata.name === "t-exagram-web")
				expect(service?.spec).toMatchObject({ type: "ClusterIP" })
			},
			RENDER_TIMEOUT,
		)

		describe("networkPolicy", () => {
			interface Policy {
				podSelector: { matchLabels: Record<string, string> }
				policyTypes: string[]
				ingress: { from: { podSelector: { matchLabels: Record<string, string> } }[]; ports: unknown[] }[]
			}
			const policies = (manifests: Manifest[]) =>
				new Map(
					manifests
						.filter((m) => m.kind === "NetworkPolicy")
						.map((m) => [m.metadata.labels?.["app.kubernetes.io/component"] ?? "", m.spec as unknown as Policy]),
				)
			const sources = (policy: Policy) =>
				policy.ingress.flatMap((rule) => rule.from.map((f) => f.podSelector.matchLabels["app.kubernetes.io/component"]))

			it(
				"admits only web and the test Pod to api and usercontent, and only the Postgres clients to Postgres",
				() => {
					const found = policies(renderCi(ciFile("default")))
					expect([...found.keys()].sort()).toEqual(["api", "postgres", "usercontent"])
					for (const [component, port] of [
						["api", 3000],
						["usercontent", 3002],
					] as const) {
						const policy = found.get(component)!
						expect(policy.policyTypes).toEqual(["Ingress"])
						expect(policy.podSelector.matchLabels["app.kubernetes.io/component"]).toBe(component)
						expect(sources(policy).sort()).toEqual(["test", "web"])
						expect(policy.ingress).toHaveLength(1)
						expect(policy.ingress[0]!.ports).toEqual([{ port, protocol: "TCP" }])
					}
					const postgres = found.get("postgres")!
					expect(postgres.policyTypes).toEqual(["Ingress"])
					expect(sources(postgres).sort()).toEqual(["api", "migrate", "usercontent", "worker"])
					expect(postgres.ingress[0]!.ports).toEqual([{ port: 5432, protocol: "TCP" }])
					for (const policy of found.values())
						for (const from of policy.ingress.flatMap((rule) => rule.from))
							expect(from.podSelector.matchLabels["app.kubernetes.io/instance"]).toBe("t")
				},
				RENDER_TIMEOUT,
			)

			it(
				"renders none of them with networkPolicy.enabled=false",
				() => {
					const manifests = render("-f", ciFile("default"), "--set", "networkPolicy.enabled=false")
					expect(manifests.filter((m) => m.kind === "NetworkPolicy")).toEqual([])
				},
				RENDER_TIMEOUT,
			)

			it(
				"renders no Postgres policy for an external database",
				() => {
					const found = policies(renderCi(ciFile("external-db")))
					expect([...found.keys()].sort()).toEqual(["api", "usercontent"])
				},
				RENDER_TIMEOUT,
			)
		})

		it("refuses tls.mode=acme without acmeEmail", () => {
			expect(() => render("--set", "appHost=exagram.example.com")).toThrow(/acmeEmail is required when tls\.mode=acme/)
		})

		it(
			"keeps the Secret and the data claims on uninstall, and retains Postgres's claim",
			() => {
				const manifests = renderCi(ciFile("default"))
				const kept = manifests
					.filter((m) => m.metadata.annotations?.["helm.sh/resource-policy"] === "keep")
					.map((m) => `${m.kind}/${m.metadata.name}`)
				expect(kept.sort()).toEqual([
					"PersistentVolumeClaim/t-exagram-caddy-data",
					"PersistentVolumeClaim/t-exagram-objects",
					"Secret/t-exagram",
				])
				const postgres = manifests.find((m) => m.kind === "StatefulSet")
				expect(postgres?.spec?.persistentVolumeClaimRetentionPolicy).toEqual({
					whenDeleted: "Retain",
					whenScaled: "Retain",
				})
			},
			RENDER_TIMEOUT,
		)

		it(
			"names the migrate Job after the release revision",
			() => {
				expect(workload(renderCi(ciFile("default")), "migrate").name).toBe("t-exagram-migrate-1")
			},
			RENDER_TIMEOUT,
		)

		it(
			"mounts a brought database CA read-only at /certs/db-ca.pem, as compose.db-ca.yml does",
			() => {
				const manifests = render("-f", ciFile("external-db"), "--set", "database.external.caSecret.name=db-ca")
				for (const entry of PARITY) {
					const compose = composeService(entry.service, ["compose.yml", "compose.db-ca.yml"])
					const chart = container(workload(manifests, entry.component), entry.container)
					expect(mounts(chart), `${entry.component}/${entry.container}`).toEqual(compose.mounts)
				}
				for (const component of ["api", "worker", "usercontent"]) {
					expect(mounts(container(workload(manifests, component), "wait-for-schema"))).toEqual({
						"/certs/db-ca.pem": true,
					})
				}
			},
			RENDER_TIMEOUT,
		)

		it(
			"routes values env to the apps whose compose service passes each key, and refuses others",
			() => {
				const manifests = render(
					"-f",
					ciFile("default"),
					"--set",
					"env.GOOGLE_CLIENT_ID=client.apps.googleusercontent.com",
				)
				const has = (component: string) =>
					(container(workload(manifests, component), component).env ?? []).some((v) => v.name === "GOOGLE_CLIENT_ID")
				expect([has("api"), has("worker"), has("usercontent")]).toEqual([true, false, false])
				expect(() => render("-f", ciFile("default"), "--set", "env.DATABASE_URL=postgres://x")).toThrow(
					/env\.DATABASE_URL is not a key this chart passes through/,
				)
			},
			RENDER_TIMEOUT,
		)
	})
})
