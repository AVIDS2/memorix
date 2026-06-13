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

export const TUI_SLASH_COMMANDS: readonly TuiSlashCommandEntry[] = [
	{ name: "/clear", description: "Clear conversation history", mode: "no-arg" },
	{ name: "/help", description: "Show available commands", mode: "no-arg" },
	{ name: "/vim", description: "Toggle vim keybindings", mode: "no-arg" },
	{ name: "/doctor", description: "Run diagnostic checks", mode: "no-arg" },
	{ name: "/inspect", description: "Inspect last assistant message", mode: "no-arg" },
	{ name: "/clone", description: "Clone current session", mode: "no-arg" },
	{ name: "/git status", description: "Show git working-tree status", mode: "no-arg" },
	{ name: "/memory status", description: "Show native Memorix runtime status", mode: "no-arg" },
	{ name: "/memory stats", description: "Show memory statistics", mode: "no-arg" },
	{ name: "/memory hooks", description: "Show native hook status", mode: "no-arg" },
	{ name: "/memory diff", description: "Show pending memory changes", mode: "no-arg" },
	{ name: "/session export", description: "Export session to file", mode: "no-arg" },
	{ name: "/session", description: "Show current session info", mode: "no-arg" },
	{ name: "/config", description: "Open configuration", mode: "no-arg" },
	{ name: "/exit", description: "Exit memcode", mode: "no-arg" },
	{ name: "/session load", description: "Load a saved session", mode: "selector" },
	{ name: "/session delete", description: "Delete a saved session", mode: "selector" },
	{ name: "/session new", description: "Create a new session", mode: "selector" },
	{ name: "/resume", description: "Resume a previous session", mode: "selector" },
	{ name: "/tree", description: "Navigate the session tree", mode: "selector" },
	{ name: "/fork", description: "Fork session at a point", mode: "selector" },
	{ name: "/memory show", description: "Browse stored memories", mode: "selector" },
	{ name: "/memory delete", description: "Delete a memory", mode: "selector" },
	{ name: "/memory promote", description: "Promote a memory to permanent", mode: "selector" },
	{ name: "/model switch", description: "Switch AI model", mode: "selector" },
	{ name: "/theme", description: "Switch color theme", mode: "selector" },
	{ name: "/git commit", description: "Create a git commit", mode: "selector" },
	{ name: "/memory search", description: "Search memories by query", mode: "text-input" },
	{ name: "/remember", description: "Store a new memory", mode: "text-input" },
	{ name: "/label", description: "Label the current session", mode: "text-input" },
	{ name: "/git diff", description: "Show diff for a file", mode: "text-input" },
] as const;
