import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../src/core/system-prompt.ts";

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("does not assume package-installed memcode docs and examples exist", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Package README:");
			expect(prompt).toContain("Do not assume package-installed docs/examples exist");
		});

		test("describes memcode as a Memorix-native agent with shared project memory", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Memorix is the native memory layer for this agent.");
			expect(prompt).toContain("memorix_graph_context");
			expect(prompt).toContain("memorix_status");
			expect(prompt).toContain("runtime memory state");
		});

		test("keeps Memorix guidance short and conditional", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Memorix guidance:");
			expect(prompt).toContain("Use memory when it helps the current task");
			expect(prompt).toContain("Skip it for greetings, small talk, identity questions, jokes, and one-off replies");
			expect(prompt).toContain("do not retry the same refs in alternate formats");
			expect(prompt).not.toContain("Before starting non-trivial development work, search memory");
		});

		test("uses Windows-safe shell guidance on Windows", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					bash: "Execute shell commands",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			if (process.platform === "win32") {
				expect(prompt).toContain("PowerShell-compatible commands");
				expect(prompt).toContain("never run Unix root scans like `find /`");
			}
		});

		test("anchors identity to the current runtime model", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
				runtimeModel: {
					provider: "deepseek",
					id: "deepseek-v4-flash",
					name: "DeepSeek V4 Flash",
				},
			});

			expect(prompt).toContain("Runtime identity:");
			expect(prompt).toContain("You are memcode, the Memorix-native coding agent.");
			expect(prompt).toContain("Current model: deepseek/deepseek-v4-flash (DeepSeek V4 Flash).");
			expect(prompt).toContain("Do not claim to be Claude, GPT, or another provider unless that is the current model/provider.");
		});

		test("does not duplicate Memorix guidance for custom prompts", () => {
			const prompt = buildSystemPrompt({
				customPrompt: "Custom base prompt.",
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/Memorix guidance:/g)).toHaveLength(1);
			expect(prompt).toContain("Custom base prompt.");
			expect(prompt).toContain("Current working directory:");
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});
});
