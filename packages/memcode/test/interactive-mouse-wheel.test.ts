import { describe, expect, it, vi } from "vitest";
import { createViewportWheelInputListener, parseMouseWheelSequence } from "../src/modes/interactive/mouse-wheel.ts";

describe("parseMouseWheelSequence", () => {
	it("parses SGR mouse wheel up/down sequences", () => {
		expect(parseMouseWheelSequence("\x1b[<64;20;5M")).toMatchObject({
			direction: "up",
			x: 20,
			y: 5,
		});
		expect(parseMouseWheelSequence("\x1b[<65;20;5M")).toMatchObject({
			direction: "down",
			x: 20,
			y: 5,
		});
	});

	it("returns undefined for non-wheel input", () => {
		expect(parseMouseWheelSequence("j")).toBeUndefined();
		expect(parseMouseWheelSequence("\x1b[A")).toBeUndefined();
	});
});

describe("createViewportWheelInputListener", () => {
	it("consumes wheel events and scrolls the viewport", () => {
		const ui = {
			hasVisibleOverlays: vi.fn(() => false),
			isViewportScrolled: vi.fn(() => false),
			scrollViewportBy: vi.fn(),
			resetViewportScroll: vi.fn(),
		};
		const listener = createViewportWheelInputListener(ui, 4);

		expect(listener("\x1b[<64;20;5M")).toEqual({ consume: true });
		expect(ui.scrollViewportBy).toHaveBeenCalledWith(4);

		expect(listener("\x1b[<65;20;5M")).toEqual({ consume: true });
		expect(ui.scrollViewportBy).toHaveBeenCalledWith(-4);
	});

	it("resets the viewport before forwarding regular input", () => {
		const ui = {
			hasVisibleOverlays: vi.fn(() => false),
			isViewportScrolled: vi.fn(() => true),
			scrollViewportBy: vi.fn(),
			resetViewportScroll: vi.fn(),
		};
		const listener = createViewportWheelInputListener(ui, 3);

		expect(listener("a")).toBeUndefined();
		expect(ui.resetViewportScroll).toHaveBeenCalledTimes(1);
	});
});
