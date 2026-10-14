import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const problems = []
const rel = (path) => relative(root, path)

async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"))
	} catch (error) {
		problems.push(`${rel(path)}: cannot parse as plain JSON (${error.message})`)
		return undefined
	}
}

// A reference path is a directory (implies tsconfig.json) or a config file.
const referenceTarget = (from, path) => {
	const target = resolve(from, path)
	return target.endsWith(".json") ? target : join(target, "tsconfig.json")
}

const packages = []
for (const group of ["apps", "packages"]) {
	for (const entry of await readdir(join(root, group), { withFileTypes: true })) {
		const dir = join(root, group, entry.name)
		if (!entry.isDirectory() || !existsSync(join(dir, "package.json"))) continue
		const manifest = await readJson(join(dir, "package.json"))
		if (manifest) packages.push({ dir, manifest })
	}
}

const dirByName = new Map(packages.map(({ dir, manifest }) => [manifest.name, dir]))
const rootFile = join(root, "tsconfig.json")
const rootConfig = await readJson(rootFile)
const rootRefs = new Set((rootConfig?.references ?? []).map((ref) => referenceTarget(root, ref.path)))
const expectedRoot = new Set()
const composite = new Set()

for (const { dir, manifest } of packages) {
	const ideFile = join(dir, "tsconfig.ide.json")
	const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })
		.filter((name) => name.startsWith("@exagram/") && name !== "@exagram/dotrc")
		.map((name) => {
			const target = dirByName.get(name)
			if (!target) problems.push(`${rel(join(dir, "package.json"))}: dependency ${name} is not a workspace package`)
			return target
		})
		.filter(Boolean)
	for (const target of deps) {
		composite.add(target)
		expectedRoot.add(join(target, "tsconfig.json"))
	}

	if (existsSync(ideFile)) {
		expectedRoot.add(ideFile)
		const ide = await readJson(ideFile)
		if (!ide) continue
		const actual = new Set((ide.references ?? []).map((ref) => dirname(referenceTarget(dir, ref.path))))
		const want = new Set(deps)
		for (const target of want)
			if (!actual.has(target)) problems.push(`${rel(ideFile)}: add reference { "path": "${relative(dir, target)}" }`)
		for (const target of actual)
			if (!want.has(target)) problems.push(`${rel(ideFile)}: remove reference "${relative(dir, target)}"`)
	} else if (deps.length > 0) {
		problems.push(`${rel(ideFile)}: create it, referencing ${deps.map((d) => relative(dir, d)).join(", ")}`)
	}
}

for (const target of expectedRoot)
	if (!rootRefs.has(target)) problems.push(`${rel(rootFile)}: add reference { "path": "${rel(target)}" }`)
for (const target of rootRefs) {
	if (!existsSync(target)) problems.push(`${rel(rootFile)}: remove reference "${rel(target)}" (missing)`)
	else if (!expectedRoot.has(target)) problems.push(`${rel(rootFile)}: remove reference "${rel(target)}" (not needed)`)
}

for (const dir of composite) {
	const file = join(dir, "tsconfig.json")
	if (!existsSync(file)) continue
	const config = await readJson(file)
	if (config && config.compilerOptions?.composite !== true)
		problems.push(`${rel(file)}: set compilerOptions.composite to true`)
}

if (problems.length > 0) {
	console.error([...new Set(problems)].join("\n"))
	process.exit(1)
}
