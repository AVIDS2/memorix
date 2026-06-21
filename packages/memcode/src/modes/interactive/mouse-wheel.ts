export interface MouseWheelEvent {
	direction: "up" | "down";
	x: number;
	y: number;
	shift: boolean;
	alt: boolean;
	ctrl: boolean;
}

export interface ViewportWheelUi {
	hasVisibleOverlays(): boolean;
	isViewportScrolled(): boolean;
	scrollViewportBy(lines: number): void;
	resetViewportScroll(): void;
}

export function parseMouseWheelSequence(data: string): MouseWheelEvent | undefined {
	const match = data.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
	if (!match) return undefined;

	const code = Number.parseInt(match[1], 10);
	if ((code & 64) === 0) return undefined;

	return {
		direction: (code & 1) === 0 ? "up" : "down",
		x: Number.parseInt(match[2], 10),
		y: Number.parseInt(match[3], 10),
		shift: (code & 4) !== 0,
		alt: (code & 8) !== 0,
		ctrl: (code & 16) !== 0,
	};
}

export function createViewportWheelInputListener(ui: ViewportWheelUi, linesPerTick = 3) {
	return (data: string): { consume?: boolean } | undefined => {
		const wheel = parseMouseWheelSequence(data);
		if (wheel) {
			if (!ui.hasVisibleOverlays()) {
				ui.scrollViewportBy(wheel.direction === "up" ? linesPerTick : -linesPerTick);
			}
			return { consume: true };
		}

		if (ui.isViewportScrolled()) {
			ui.resetViewportScroll();
		}

		return undefined;
	};
}
