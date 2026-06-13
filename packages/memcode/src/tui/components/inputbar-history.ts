import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const MAX_HISTORY = 100;

let historyPath: string | null = null;

export function getHistoryPath(): string {
	if (historyPath) return historyPath;
	historyPath = join(tmpdir(), `memcode-input-history-${process.pid}.json`);
	return historyPath;
}

export function loadHistoryFromDisk(): string[] {
	try {
		const raw = readFileSync(getHistoryPath(), "utf-8");
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return parsed.slice(0, MAX_HISTORY);
		}
	} catch {
		// First run or corrupt file — start fresh.
	}
	return [];
}

export function saveHistoryToDisk(history: string[]): void {
	try {
		writeFileSync(getHistoryPath(), JSON.stringify(history.slice(0, MAX_HISTORY)), "utf-8");
	} catch {
		// Non-fatal: history just won't persist across restarts.
	}
}
