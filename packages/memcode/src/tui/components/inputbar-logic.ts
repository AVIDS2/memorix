import { getTuiSlashCommandsByMode } from "../command-registry.ts";

export interface SuggestionItem {
	name: string;
	desc: string;
}

export interface MemoryEntry {
	id: string;
	title: string;
	type: string;
	entityName?: string;
	narrative?: string;
}

export type InputMode = "slash" | "at" | "reverse" | "history" | null;

export const AT_SUGGESTIONS: readonly SuggestionItem[] = [
	{ name: "@file", desc: "Attach a file to context" },
	{ name: "@codebase", desc: "Search entire codebase" },
	{ name: "@git", desc: "Search git history" },
] as const;

export const SLASH_SUGGESTIONS: SuggestionItem[] = getTuiSlashCommandsByMode("no-arg")
	.concat(getTuiSlashCommandsByMode("selector"))
	.concat(getTuiSlashCommandsByMode("text-input"))
	.map((command) => ({
		name: command.name,
		desc: command.description,
	}));

export function fuzzyMatch(query: string, text: string): boolean {
	const q = query.toLowerCase();
	const t = text.toLowerCase();
	if (!q) return true;
	if (t.includes(q)) return true;
	const qTokens = q.split(/\s+/).filter(Boolean);
	const tTokens = t.split(/\s+/);
	return qTokens.every((qt) => tTokens.some((tt) => tt.includes(qt)));
}

export function getSlashSuggestions(query: string): SuggestionItem[] {
	const q = query.trim().toLowerCase();
	if (!q) return SLASH_SUGGESTIONS;
	return SLASH_SUGGESTIONS.filter(
		(command) => command.name.toLowerCase().includes(q) || command.desc.toLowerCase().includes(q),
	);
}

export function getAtSuggestions(inputText: string, memoryResults: MemoryEntry[]): SuggestionItem[] {
	if (memoryResults.length > 0) {
		return memoryResults.map((memory) => ({
			name: `@${memory.title}`,
			desc: `[${memory.type}] ${(memory.narrative ?? "").slice(0, 60)}`,
		}));
	}

	const atIndex = inputText.lastIndexOf("@");
	const query = atIndex >= 0 ? inputText.slice(atIndex).toLowerCase() : "";
	if (!query) return [...AT_SUGGESTIONS];
	return AT_SUGGESTIONS.filter(
		(suggestion) =>
			suggestion.name.toLowerCase().includes(query) || suggestion.desc.toLowerCase().includes(query),
	);
}

export function getReverseHistorySuggestions(query: string, inputHistory: string[]): SuggestionItem[] {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return inputHistory.slice(0, 20).map((entry) => ({
			name: entry,
			desc: "(history)",
		}));
	}

	return inputHistory
		.filter((entry) => fuzzyMatch(normalizedQuery, entry))
		.slice(0, 20)
		.map((entry) => ({
			name: entry,
			desc: "(history)",
		}));
}

export function buildMemorySelectionText(inputText: string, selectedName: string, memoryResults: MemoryEntry[]): string {
	const entry = memoryResults.find((memory) => `@${memory.title}` === selectedName);
	const atIndex = inputText.lastIndexOf("@");
	const contextSnippet = entry
		? `[memory: ${entry.title} (${entry.type})${entry.narrative ? ` — ${entry.narrative.slice(0, 120)}` : ""}]`
		: selectedName;
	const before = atIndex >= 0 ? inputText.slice(0, atIndex) : "";
	return `${before}${selectedName} ${contextSnippet}`;
}

export function getDisplayMode(activeMode: InputMode): "search" | "memory" | "commands" | null {
	if (activeMode === "reverse") return "search";
	if (activeMode === "at") return "memory";
	if (activeMode === "slash") return "commands";
	return null;
}
