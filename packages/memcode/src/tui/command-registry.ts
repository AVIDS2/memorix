import { BUILTIN_SLASH_COMMANDS } from "../core/slash-commands.ts";

export type TuiSlashCommandMode = "no-arg" | "selector" | "text-input";

export interface TuiSlashCommandEntry {
	name: string;
	description: string;
	mode: TuiSlashCommandMode;
}

export interface TuiSlashCommandRow {
	name: string;
	description: string;
	source: "tui-discovery";
	mode: TuiSlashCommandMode;
}

export function getTuiSlashCommandsByMode(mode: TuiSlashCommandMode): TuiSlashCommandEntry[] {
	return TUI_SLASH_COMMANDS.filter((command) => command.mode === mode);
}

export function getTuiSlashCommandRows(): TuiSlashCommandRow[] {
	return TUI_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		description: command.description,
		mode: command.mode,
		source: "tui-discovery" as const,
	}));
}

const BUILTIN_COMMAND_MODES: Readonly<Partial<Record<string, TuiSlashCommandMode>>> = {
	commands: "text-input",
	settings: "selector",
	model: "selector",
	"scoped-models": "selector",
	export: "text-input",
	import: "text-input",
	name: "text-input",
	fork: "selector",
	tree: "selector",
	trust: "selector",
	login: "selector",
	logout: "selector",
	compact: "text-input",
	resume: "selector",
};

const MEMORIX_MEMORY_SUBCOMMANDS: readonly TuiSlashCommandEntry[] = [
	{ name: "/memory status", description: "Show native Memorix runtime status", mode: "no-arg" },
	{ name: "/memory stats", description: "Show project memory statistics", mode: "no-arg" },
	{ name: "/memory hooks", description: "Show native hook capture status", mode: "no-arg" },
	{ name: "/memory search", description: "Search shared project memory", mode: "text-input" },
	{ name: "/memory show", description: "List recent project memories", mode: "no-arg" },
	{ name: "/memory diff", description: "Show recent project memory changes", mode: "no-arg" },
	{ name: "/memory promote", description: "Promote the last agent response to memory", mode: "no-arg" },
	{ name: "/memory delete", description: "Resolve a project memory entry by ID", mode: "text-input" },
];

/**
 * The autocomplete and `/commands` surface must only advertise commands that
 * InteractiveMode can execute. Generic commands derive from the canonical
 * Pi-compatible built-in registry; Memorix adds only its native memory verbs.
 */
export const TUI_SLASH_COMMANDS: readonly TuiSlashCommandEntry[] = [
	...BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: `/${command.name}`,
		description: command.description,
		mode: BUILTIN_COMMAND_MODES[command.name] ?? "no-arg",
	})),
	...MEMORIX_MEMORY_SUBCOMMANDS,
];
