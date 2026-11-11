import { describe, expect, test } from "vitest";
import {
	buildMemorySelectionText,
	fuzzyMatch,
	getAtSuggestions,
	getDisplayMode,
	getReverseHistorySuggestions,
	getSlashSuggestions,
} from "../src/tui/components/inputbar-logic.ts";

describe("inputbar logic", () => {
	test("filters slash suggestions from the shared registry", () => {
		const results = getSlashSuggestions("/memory");

		expect(results.some((item) => item.name === "/memory hooks")).toBe(true);
		expect(results.some((item) => item.name === "/memory search")).toBe(true);
	});

	test("builds memory selection text with a contextual memory snippet", () => {
		const text = buildMemorySelectionText("please use @nat", "@native-hooks", [
			{
				id: "1",
				title: "native-hooks",
				type: "decision",
				narrative: "Memcode should use native hooks first.",
			},
		]);

		expect(text).toContain("@native-hooks");
		expect(text).toContain("[memory: native-hooks (decision)");
	});

	test("returns reverse history suggestions in recency order", () => {
		const results = getReverseHistorySuggestions("", ["first", "second", "third"]);

		expect(results.map((item) => item.name)).toEqual(["first", "second", "third"]);
	});

	test("filters reverse history suggestions fuzzily", () => {
		const results = getReverseHistorySuggestions("nat hook", ["native hooks", "session tree", "memory stats"]);

		expect(results.map((item) => item.name)).toEqual(["native hooks"]);
	});

	test("computes display mode labels for visible suggestion panels", () => {
		expect(getDisplayMode("reverse")).toBe("search");
		expect(getDisplayMode("at")).toBe("memory");
		expect(getDisplayMode("slash")).toBe("commands");
		expect(getDisplayMode(null)).toBe(null);
	});

	test("filters @ suggestions using memory results when available", () => {
		const results = getAtSuggestions("@na", [
			{ id: "1", title: "native-hooks", type: "decision", narrative: "Memorix native hooks." },
		]);

		expect(results[0]?.name).toBe("@native-hooks");
		expect(results[0]?.desc).toContain("[decision]");
	});

	test("keeps fuzzy matching behavior for multi-token queries", () => {
		expect(fuzzyMatch("native hook", "Memcode native hooks status")).toBe(true);
		expect(fuzzyMatch("native graph", "Memcode native hooks status")).toBe(false);
	});
});
