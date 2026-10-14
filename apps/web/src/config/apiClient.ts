import { ExagramApiClient } from "@exagram/api-client"

import { API_BASE_URL, API_ORIGIN } from "@/config/env"

/** One instance for the whole app: it holds two links and nothing per-request. */
export const apiClient = new ExagramApiClient(API_BASE_URL, API_ORIGIN)
