import { basename } from "node:path"

import {
	CI_VALUES_FILES,
	container,
	findHelm,
	helmTemplate,
	resolveEnv,
	workloads,
} from "@exagram/core/test/helm-render"
import { describe, expect, it } from "vitest"

import { parseEnv } from "./env"

// Parity with compose.yml and the template assertions live in apps/api/src/env.helm.test.ts; this
// checks only that what the chart gives this app passes its own schema.
const helm = findHelm()
const helmDescribe = helm === null ? describe.skip : describe
// CI installs helm, so this never skips there.
const SUITE = `helm chart env contract${helm === null ? " (skipped: no helm binary; set HELM_BIN or put helm on PATH)" : ""}`

helmDescribe(SUITE, () => {
	for (const file of CI_VALUES_FILES) {
		it(`sets only usercontent env keys the schema accepts (${basename(file)})`, () => {
			const manifests = helmTemplate(helm!, ["-f", file])
			const app = workloads(manifests).get("usercontent")
			if (!app) throw new Error("render has no usercontent workload")
			expect(() => parseEnv(resolveEnv(container(app, "usercontent"), manifests))).not.toThrow()
		}, 60_000)
	}
})
