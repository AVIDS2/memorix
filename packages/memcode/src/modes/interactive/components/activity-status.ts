import { Text, type TUI } from "@memorix/tui";
import { theme } from "../theme/theme.ts";

export const ACTIVITY_WORDS = [
	"Thinking",
	"Tracing",
	"Brewing",
	"Simmering",
	"Refining",
	"Reviewing",
	"Distilling",
	"Drafting",
	"Whirring",
	"Shaping",
] as const;

export const ACTIVITY_DONE_WORDS = ["Finished", "Resolved", "Distilled", "Refined", "Shipped", "Settled"] as const;

export interface ActivityTextOptions {
	word: string;
	frame: number;
	elapsedMs: number;
	thinking?: boolean;
	outputTokens?: number;
}

export interface ActivityCompletionOptions {
	word: string;
	durationMs: number;
}

function randomItem<const T extends readonly string[]>(items: T): T[number] {
	return items[Math.floor(Math.random() * items.length)] ?? items[0];
}

export function pickActivityWord(): string {
	return randomItem(ACTIVITY_WORDS);
}

export function pickActivityDoneWord(): string {
	return randomItem(ACTIVITY_DONE_WORDS);
}

export function formatDuration(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) {
		return `${totalSeconds}s`;
	}
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatTokenCount(tokens: number): string {
	return `${tokens.toLocaleString()} ${tokens === 1 ? "token" : "tokens"}`;
}

function formatDetails(options: { elapsedMs?: number; outputTokens?: number; thinking?: boolean }): string {
	const parts: string[] = [];
	if (options.elapsedMs !== undefined) {
		parts.push(formatDuration(options.elapsedMs));
	}
	if (options.outputTokens !== undefined && options.outputTokens > 0) {
		parts.push(`↓ ${formatTokenCount(options.outputTokens)}`);
	}
	if (options.thinking) {
		parts.push("thinking");
	}
	return parts.join(" · ");
}

function renderWaveWord(word: string, frame: number): string {
	const chars = [...word];
	if (chars.length === 0) {
		return "";
	}
	const active = frame % (chars.length + 3);
	return chars
		.map((char, index) => {
			if (index === active) {
				return theme.bold(theme.fg("warning", char));
			}
			if (Math.abs(index - active) === 1) {
				return theme.fg("mdHeading", char);
			}
			return theme.fg("warning", char);
		})
		.join("");
}

export function renderActivityText(options: ActivityTextOptions): string {
	const details = formatDetails({
		elapsedMs: options.elapsedMs,
		outputTokens: options.outputTokens,
		thinking: options.thinking,
	});
	const suffix = details ? theme.fg("muted", ` (${details})`) : "";
	return `${theme.fg("warning", "✶")} ${renderWaveWord(options.word, options.frame)}${theme.fg("warning", "...")}${suffix}`;
}

export function formatActivityCompletion(options: ActivityCompletionOptions): string {
	return theme.fg("dim", `✻ ${options.word} for ${formatDuration(options.durationMs)}`);
}

export class ActivityStatus extends Text {
	private readonly ui: Pick<TUI, "requestRender">;
	private readonly word: string;
	private readonly intervalMs: number;
	private readonly startedAt: number;
	private frame = 0;
	private intervalId: NodeJS.Timeout | null = null;
	private thinking = false;
	private outputTokens: number | undefined;

	constructor(ui: Pick<TUI, "requestRender">, options?: { word?: string; intervalMs?: number; startedAt?: number }) {
		super("", 1, 0);
		this.ui = ui;
		this.word = options?.word ?? pickActivityWord();
		this.intervalMs = options?.intervalMs ?? 90;
		this.startedAt = options?.startedAt ?? Date.now();
	}

	start(): void {
		this.updateDisplay();
		this.stop();
		this.intervalId = setInterval(() => {
			this.frame++;
			this.updateDisplay();
		}, this.intervalMs);
	}

	stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
	}

	setThinking(thinking: boolean): void {
		this.thinking = thinking;
		this.updateDisplay();
	}

	setOutputTokens(outputTokens: number | undefined): void {
		this.outputTokens = outputTokens;
		this.updateDisplay();
	}

	complete(options: ActivityCompletionOptions): void {
		this.stop();
		this.setText(formatActivityCompletion(options));
		this.ui.requestRender();
	}

	private updateDisplay(): void {
		this.setText(
			renderActivityText({
				word: this.word,
				frame: this.frame,
				elapsedMs: Date.now() - this.startedAt,
				thinking: this.thinking,
				outputTokens: this.outputTokens,
			}),
		);
		this.ui.requestRender();
	}
}
