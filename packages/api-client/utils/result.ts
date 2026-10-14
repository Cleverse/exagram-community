/**
 * The human API's procedures answer `{ result: X }`. This is the single place that assumption lives: a
 * procedure that answers `X` directly still types and reads correctly.
 */
export type Unwrapped<T> = T extends { result: infer R } ? R : T

export const unwrapResult = <T>(response: T): Unwrapped<T> => {
	if (response !== null && typeof response === "object" && "result" in response) {
		return (response as { result: unknown }).result as Unwrapped<T>
	}
	return response as Unwrapped<T>
}
