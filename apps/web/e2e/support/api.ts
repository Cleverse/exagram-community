import { createHash, randomBytes } from "node:crypto"

import { type APIRequestContext, type Page, expect } from "@playwright/test"

export const uniqueEmail = (tag: string) => `${tag}-${Date.now()}@example.test`

export const pkce = () => {
	const verifier = randomBytes(32).toString("base64url")
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") }
}

/** Dynamic client registration: the client is created by the client, not by us. */
export const registerClient = async (request: APIRequestContext, baseURL: string, redirectUri: string) => {
	const response = await request.post(`${baseURL}/oauth/reg`, {
		data: {
			client_name: "Exagram end-to-end",
			application_type: "native",
			redirect_uris: [redirectUri],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: "none",
		},
	})
	expect(response.status(), await response.text()).toBe(201)
	return (await response.json()) as { client_id: string }
}

export const exchangeCode = async (
	request: APIRequestContext,
	baseURL: string,
	input: { code: string; clientId: string; redirectUri: string; verifier: string; resource: string },
) => {
	const response = await request.post(`${baseURL}/oauth/token`, {
		form: {
			grant_type: "authorization_code",
			code: input.code,
			client_id: input.clientId,
			redirect_uri: input.redirectUri,
			code_verifier: input.verifier,
			resource: input.resource,
		},
	})
	expect(response.status(), await response.text()).toBe(200)
	return (await response.json()) as { access_token: string; scope: string }
}

export const mcp = async (request: APIRequestContext, baseURL: string, token: string, body: unknown) => {
	const response = await request.post(`${baseURL}/mcp`, {
		headers: {
			authorization: `Bearer ${token}`,
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
		},
		data: body,
	})
	return { status: response.status(), text: await response.text() }
}

/**
 * The DCR + PKCE + consent dance, on a `page` that is already signed in as the
 * Owner. Runs the consent screen on whatever `page` it is given, so a caller that must keep another
 * tab untouched (no navigation, to prove a live update needed no reload) passes a second one.
 */
export const mintConnectionToken = async (
	page: Page,
	request: APIRequestContext,
	baseURL: string,
	scope: "read" | "read write",
): Promise<{ access_token: string; scope: string }> => {
	const appPort = new URL(baseURL).port || "5173"
	// RFC 8252 §7.3: a native client's redirect URI is a loopback IP literal, never "localhost".
	const redirectUri = `http://127.0.0.1:${appPort}/e2e-callback`
	const resource = `${baseURL}/mcp`
	const { challenge, verifier } = pkce()
	const client = await registerClient(request, baseURL, redirectUri)

	const authorize = new URL(`${baseURL}/oauth/auth`)
	authorize.search = new URLSearchParams({
		client_id: client.client_id,
		response_type: "code",
		redirect_uri: redirectUri,
		scope: `openid ${scope}`,
		resource,
		code_challenge: challenge,
		code_challenge_method: "S256",
		state: "live-e2e",
	}).toString()
	await page.goto(authorize.toString())
	await expect(page).toHaveURL(/\/oauth\/consent\//)
	if (scope.includes("write")) await page.getByLabel(/Write Revisions/).check()
	await page.getByRole("button", { name: "Allow" }).click()
	await page.waitForURL(/e2e-callback\?/)

	const code = new URL(page.url()).searchParams.get("code")!
	return exchangeCode(request, baseURL, { code, clientId: client.client_id, redirectUri, verifier, resource })
}

export const createTeamAndEnter = async (page: Page, name: string) => {
	const headers = { Origin: new URL(page.url()).origin }
	const created = await page.request.post("/v1/workspace/teams", { data: { name }, headers })
	expect(created.ok(), await created.text()).toBe(true)
	const team = ((await created.json()) as { result: { id: string } }).result
	const switched = await page.request.post("/v1/auth/workspace", { data: { workspaceId: team.id }, headers })
	expect(switched.ok(), await switched.text()).toBe(true)
	await page.goto("/activity")
}
