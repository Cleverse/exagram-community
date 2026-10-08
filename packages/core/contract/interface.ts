import { z } from "zod"

export const responseSchema = <T extends z.ZodType>(resultSchema: T) => z.object({ result: resultSchema })

export interface Response<T> {
	result: T
}
