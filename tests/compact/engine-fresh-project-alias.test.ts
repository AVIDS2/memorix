import { describe, expect, test, vi } from "vitest";

const getAllObservations = vi.hoisted(() => vi.fn());
const ensureFreshObservations = vi.hoisted(() => vi.fn());
const searchObservations = vi.hoisted(() => vi.fn());
const formatIndexTable = vi.hoisted(() => vi.fn());
const countTextTokens = vi.hoisted(() => vi.fn());

vi.mock("../../src/memory/observations.js", () => ({
	getAllObservations,
	ensureFreshObservations,
}));

vi.mock("../../src/store/orama-store.js", () => ({
	searchObservations,
}));

vi.mock("../../src/compact/index-format.js", () => ({
	formatIndexTable,
}));

vi.mock("../../src/compact/token-budget.js", () => ({
	countTextTokens,
}));

const resolveAliases = vi.hoisted(() => vi.fn());

vi.mock("../../src/project/aliases.js", () => ({
	resolveAliases,
}));

const { compactSearch } = await import("../../src/compact/engine.js");

describe("compactSearch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		ensureFreshObservations.mockResolvedValue(false);
		formatIndexTable.mockReturnValue("index");
		countTextTokens.mockReturnValue(1);
		searchObservations.mockResolvedValue([]);
	});

	test("does not treat alias-backed memories as a fresh project", async () => {
		resolveAliases.mockResolvedValue(["AVIDS2/memorix", "AVIDS2/memorix-alias"]);
		getAllObservations.mockReturnValue([
			{ projectId: "AVIDS2/memorix-alias" },
		]);

		const result = await compactSearch({
			projectId: "AVIDS2/memorix",
			query: "anything",
			limit: 20,
		} as any);

		expect(result.formatted).toContain("This project does have stored Memorix memories");
		expect(result.formatted).not.toContain("This project does not have any Memorix memories yet.");
		expect(result.formatted).not.toContain("fresh project");
	});

	test("still reports fresh project when no canonical or alias memories exist", async () => {
		resolveAliases.mockResolvedValue(["AVIDS2/memorix", "AVIDS2/memorix-alias"]);
		getAllObservations.mockReturnValue([
			{ projectId: "other/project" },
		]);

		const result = await compactSearch({
			projectId: "AVIDS2/memorix",
			query: "anything",
			limit: 20,
		} as any);

		expect(result.formatted).toContain("This project does not have any Memorix memories yet.");
	});
});
