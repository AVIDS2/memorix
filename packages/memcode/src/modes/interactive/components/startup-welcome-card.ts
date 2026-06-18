import { type Component, truncateToWidth, visibleWidth } from "@memorix/tui";
import { theme } from "../theme/theme.ts";

export interface StartupWelcomeCardOptions {
	appName: string;
	version: string;
	getProjectLabel: () => string;
	getModelLabel: () => string;
	getDetailsKey: () => string;
	compactInstructions: string;
	expandedInstructions: string;
}

const PIXEL_RESET = "\x1b[0m";

const PIXEL_PALETTE: Record<string, string> = {
	O: "#ff8c4a",
	B: "#ff6b3d",
	W: "#fff7e8",
	d: "#c94f2f",
	E: "#111111",
};

const CRAB_PIXEL_ROWS = [
	"  OOO          OOO  ",
	" OBBBO        OBBBO ",
	"   OBO        OBO   ",
	"    OBBO    OBBO    ",
	"      OOOOOOOO      ",
	"    OBBBBBBBBBBO    ",
	"   OBBBWBBBBWBBBO   ",
	"  OBBBBEBBBBEBBBBO  ",
	"  OBBBBBBBBBBBBBBO  ",
	" OBBBBBBBBBBBBBBBBO ",
	"  OBBBBOBBBBBOBBBO  ",
	"   OBBBOOOOOOBBBO   ",
	"  OBO          OBO  ",
	" OBO            OBO ",
	"OBdO            OBdO",
	" OO              OO ",
] as const;

function ansiFg(color: string): string {
	const [r, g, b] = hexToRgb(color);
	return `\x1b[38;2;${r};${g};${b}m`;
}

function ansiBg(color: string): string {
	const [r, g, b] = hexToRgb(color);
	return `\x1b[48;2;${r};${g};${b}m`;
}

function hexToRgb(hex: string): [number, number, number] {
	return [
		parseInt(hex.slice(1, 3), 16),
		parseInt(hex.slice(3, 5), 16),
		parseInt(hex.slice(5, 7), 16),
	];
}

function pixelColor(pixel: string): string | undefined {
	return PIXEL_PALETTE[pixel];
}

function renderCrabSprite(): string[] {
	const width = Math.max(...CRAB_PIXEL_ROWS.map((row) => row.length));
	const rows = CRAB_PIXEL_ROWS.map((row) => row.padEnd(width, " "));
	const rendered: string[] = [];
	for (let y = 0; y < rows.length; y += 2) {
		const upper = rows[y] ?? "";
		const lower = rows[y + 1] ?? "";
		let line = "";
		for (let x = 0; x < width; x++) {
			const upperColor = pixelColor(upper[x] ?? " ");
			const lowerColor = pixelColor(lower[x] ?? " ");
			if (upperColor && lowerColor) {
				line += `${ansiBg(upperColor)}${ansiFg(lowerColor)}▄`;
			} else if (upperColor) {
				line += `${ansiFg(upperColor)}▀`;
			} else if (lowerColor) {
				line += `${ansiFg(lowerColor)}▄`;
			} else {
				line += `${PIXEL_RESET} `;
			}
		}
		rendered.push(`${line}${PIXEL_RESET}`);
	}
	return rendered;
}

function padAnsi(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function centerAnsi(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "…");
	const left = Math.max(0, Math.floor((width - visibleWidth(clipped)) / 2));
	return padAnsi(`${" ".repeat(left)}${clipped}`, width);
}

function formatCommand(command: string, description: string): string {
	return `${theme.fg("accent", command)} ${theme.fg("text", description)}`;
}

function formatMeta(label: string, value: string): string {
	return `${theme.fg("dim", label)} ${theme.fg("muted", value)}`;
}

function divider(width: number): string {
	return theme.fg("dim", "─".repeat(Math.max(8, width - 2)));
}

export class StartupWelcomeCard implements Component {
	private expanded = false;
	private readonly options: StartupWelcomeCardOptions;

	constructor(options: StartupWelcomeCardOptions) {
		this.options = options;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const cardWidth = Math.max(48, width);
		if (cardWidth < 92) {
			return this.renderSingleColumn(cardWidth);
		}
		return this.renderTwoColumn(cardWidth);
	}

	private renderTwoColumn(width: number): string[] {
		const innerWidth = width - 2;
		const leftWidth = 30;
		const rightWidth = innerWidth - leftWidth - 1;
		const left = this.leftPanel(leftWidth);
		const right = this.rightPanel(rightWidth);
		const rowCount = Math.max(left.length, right.length);
		const rows = [this.topBorder(width)];
		for (let i = 0; i < rowCount; i++) {
			rows.push(
				`${theme.fg("warning", "│")}${padAnsi(left[i] ?? "", leftWidth)}${theme.fg("warning", "│")}${padAnsi(
					right[i] ?? "",
					rightWidth,
				)}${theme.fg("warning", "│")}`,
			);
		}
		rows.push(this.bottomBorder(width));
		return rows;
	}

	private renderSingleColumn(width: number): string[] {
		const innerWidth = width - 2;
		const content = [
			...this.leftPanel(innerWidth),
			"",
			...this.rightPanel(innerWidth),
		];
		return [
			this.topBorder(width),
			...content.map((line) => `${theme.fg("warning", "│")}${padAnsi(line, innerWidth)}${theme.fg("warning", "│")}`),
			this.bottomBorder(width),
		];
	}

	private leftPanel(width: number): string[] {
		const model = theme.fg("muted", this.options.getModelLabel());
		const project = theme.fg("muted", this.options.getProjectLabel());
		return [
			centerAnsi(theme.bold(theme.fg("text", "Ready when you are")), width),
			centerAnsi(theme.fg("dim", "native memory inside memcode"), width),
			"",
			...renderCrabSprite().map((line) => centerAnsi(line, width)),
			"",
			padAnsi(formatMeta("model", this.options.getModelLabel()), width),
			padAnsi(formatMeta("project", this.options.getProjectLabel()), width),
		];
	}

	private rightPanel(width: number): string[] {
		const detailsKey = this.options.getDetailsKey();
		const lines = [
			theme.bold(theme.fg("warning", "Start here")),
			formatCommand("/commands", "browse the full command surface"),
			formatCommand("/model", "switch model or thinking profile"),
			formatCommand("/memory search", "recover project context"),
			formatCommand("/tree", "jump branches and resume threads"),
			divider(width),
			theme.bold(theme.fg("warning", "Memorix native")),
			theme.fg("text", "auto context injection before each turn"),
			theme.fg("text", "native hooks capture durable project knowledge"),
			formatCommand("/memory hooks", "inspect hook capture status"),
			divider(width),
			theme.bold(theme.fg("warning", "This build")),
			theme.fg("text", "legacy interactive mode remains the release path"),
			theme.fg("text", "mouse selection and wheel scroll stay enabled"),
			theme.fg("muted", `${detailsKey} startup details and hotkeys`),
		];
		if (this.expanded) {
			lines.push(
				divider(width),
				theme.bold(theme.fg("warning", "Hotkeys")),
				this.options.compactInstructions,
				"",
				this.options.expandedInstructions,
			);
		}
		return lines;
	}

	private topBorder(width: number): string {
		const title = ` ${this.options.appName} v${this.options.version} `;
		const prefix = "───";
		const titleWidth = visibleWidth(prefix) + visibleWidth(title);
		const fill = "─".repeat(Math.max(0, width - titleWidth - 2));
		return theme.fg("warning", `╭${prefix}${title}${fill}╮`);
	}

	private bottomBorder(width: number): string {
		return theme.fg("warning", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
	}
}
