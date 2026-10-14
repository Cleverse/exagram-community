import { expect } from "vitest"

export const TAP_TARGET = 44

/**
 * jsdom has no layout, so a control's size is what its inline style declares. A "100%" height does not count:
 * the border of the box around it takes 2px, which is how a 44px field came to hold a 42px input.
 */
const declared = (element: HTMLElement, side: "width" | "height"): number => {
	const value = element.style[side]
	return value.endsWith("px") ? Number.parseFloat(value) : Number.NaN
}

export const expectTapHeight = (element: HTMLElement) =>
	expect(declared(element, "height"), "height").toBeGreaterThanOrEqual(TAP_TARGET)

export const expectTapTarget = (element: HTMLElement) => {
	expectTapHeight(element)
	expect(declared(element, "width"), "width").toBeGreaterThanOrEqual(TAP_TARGET)
}
