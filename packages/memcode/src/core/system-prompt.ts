/**
 * System prompt construction and project context loading
 */

import { getReadmePath } from "../config.ts";
import { formatSkillsForPrompt, type Skill } from "./skills.ts";

const MEMORIX_GUIDANCE = `Memorix guidance:
- Memorix is the native memory layer for this agent.
- Use memory when it helps the current task: prior decisions, bugs, changes, or project context.
- Skip it for greetings, small talk, identity questions, jokes, and one-off replies.
- Use memorix_graph_context for broad memory overview, memory graph, or project-memory grounding questions.
- Use memorix_status only when the user asks about Memorix itself or runtime memory state.
- When memory is relevant, search first, then detail only what you need, and store only durable learnings.
- If a memory detail call cannot find refs returned by search, do not retry the same refs in alternate formats or inspect storage with shell commands. Summarize what is already available and ask whether to run diagnostics.`;

function formatMemorixSection(): string {
	return `\n\n${MEMORIX_GUIDANCE}`;
}

export interface BuildSystemPromptOptions {
	/** Custom system prompt (replaces default). */
	customPrompt?: string;
	/** Tools to include in prompt. Default: [read, bash, edit, write] */
	selectedTools?: string[];
	/** Optional one-line tool snippets keyed by tool name. */
	toolSnippets?: Record<string, string>;
	/** Additional guideline bullets appended to the default system prompt guidelines. */
	promptGuidelines?: string[];
	/** Text to append to system prompt. */
	appendSystemPrompt?: string;
	/** Working directory. */
	cwd: string;
	/** Current runtime model, used for factual identity answers. */
	runtimeModel?: {
		provider: string;
		id: string;
		name?: string;
	};
	/** Pre-loaded context files. */
	contextFiles?: Array<{ path: string; content: string }>;
	/** Pre-loaded skills. */
	skills?: Skill[];
}

/** Build the system prompt with tools, guidelines, and context */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const {
		customPrompt,
		selectedTools,
		toolSnippets,
		promptGuidelines,
		appendSystemPrompt,
		cwd,
		runtimeModel,
		contextFiles: providedContextFiles,
		skills: providedSkills,
	} = options;
	const resolvedCwd = cwd;
	const promptCwd = resolvedCwd.replace(/\\/g, "/");
	const isWindows = process.platform === "win32";

	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const date = `${year}-${month}-${day}`;

	const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
	const runtimeIdentitySection = runtimeModel
		? `\n\nRuntime identity:\n- You are memcode, the Memorix-native coding agent.\n- Current model: ${runtimeModel.provider}/${runtimeModel.id}${runtimeModel.name ? ` (${runtimeModel.name})` : ""}.\n- If asked what model you are, answer from the current model above. Do not claim to be Claude, GPT, or another provider unless that is the current model/provider.`
		: "\n\nRuntime identity:\n- You are memcode, the Memorix-native coding agent.\n- If asked what model you are, say the current model is not available in this prompt rather than guessing a provider identity.";

	const contextFiles = providedContextFiles ?? [];
	const skills = providedSkills ?? [];

	if (customPrompt) {
		let prompt = customPrompt;

		if (appendSection) {
			prompt += appendSection;
		}

		// Persistent memory section (Memorix)
		prompt += formatMemorixSection();
		prompt += runtimeIdentitySection;

		// Append project context files
		if (contextFiles.length > 0) {
			prompt += "\n\n<project_context>\n\n";
			prompt += "Project-specific instructions and guidelines:\n\n";
			for (const { path: filePath, content } of contextFiles) {
				prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
			}
			prompt += "</project_context>\n";
		}

		// Append skills section (only if read tool is available)
		const customPromptHasRead = !selectedTools || selectedTools.includes("read");
		if (customPromptHasRead && skills.length > 0) {
			prompt += formatSkillsForPrompt(skills);
		}

		// Add date and working directory last
		prompt += `\nCurrent date: ${date}`;
		prompt += `\nCurrent working directory: ${promptCwd}`;

		return prompt;
	}

	// Get absolute path to the package README.
	const readmePath = getReadmePath();

	// Build tools list based on selected tools.
	// A tool appears in Available tools only when the caller provides a one-line snippet.
	const tools = selectedTools || ["read", "bash", "edit", "write"];
	const visibleTools = tools.filter((name) => !!toolSnippets?.[name]);
	const toolsList =
		visibleTools.length > 0 ? visibleTools.map((name) => `- ${name}: ${toolSnippets![name]}`).join("\n") : "(none)";

	// Build guidelines based on which tools are actually available
	const guidelinesList: string[] = [];
	const guidelinesSet = new Set<string>();
	const addGuideline = (guideline: string): void => {
		if (guidelinesSet.has(guideline)) {
			return;
		}
		guidelinesSet.add(guideline);
		guidelinesList.push(guideline);
	};

	const hasBash = tools.includes("bash");
	const hasGrep = tools.includes("grep");
	const hasFind = tools.includes("find");
	const hasLs = tools.includes("ls");
	const hasRead = tools.includes("read");

	// File exploration guidelines
	if (hasBash && !hasGrep && !hasFind && !hasLs) {
		addGuideline(
			isWindows
				? "Use the shell tool with Windows/PowerShell-compatible commands. Prefer `rg` and `rg --files` when available; otherwise use `Get-ChildItem` and `Select-String`. Quote Windows paths, keep searches scoped to the current project, and never run Unix root scans like `find /`."
				: "Use bash for scoped file operations. Prefer `rg` and `rg --files` when available; keep searches inside the current project unless the user explicitly asks otherwise.",
		);
	}

	for (const guideline of promptGuidelines ?? []) {
		const normalized = guideline.trim();
		if (normalized.length > 0) {
			addGuideline(normalized);
		}
	}

	// Always include these
	addGuideline("Be concise in your responses");
	addGuideline("Show file paths clearly when working with files");

	const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

	let prompt = `You are an expert coding assistant operating inside memcode, a coding agent harness. You help users by reading files, executing commands, editing code, and writing new files.

Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.

Guidelines:
${guidelines}

Memcode documentation (read only when the user asks about memcode itself):
- Package README: ${readmePath}
- For project-internal memcode development, prefer repository docs under docs/memcode/ when they are present in the current working tree.
- Do not assume package-installed docs/examples exist; npm releases ship the runtime and README, while detailed development notes live in the Memorix repository.`;

	if (appendSection) {
		prompt += appendSection;
	}

	// Persistent memory section (Memorix)
	prompt += formatMemorixSection();
	prompt += runtimeIdentitySection;

	// Append project context files
	if (contextFiles.length > 0) {
		prompt += "\n\n<project_context>\n\n";
		prompt += "Project-specific instructions and guidelines:\n\n";
		for (const { path: filePath, content } of contextFiles) {
			prompt += `<project_instructions path="${filePath}">\n${content}\n</project_instructions>\n\n`;
		}
		prompt += "</project_context>\n";
	}

	// Append skills section (only if read tool is available)
	if (hasRead && skills.length > 0) {
		prompt += formatSkillsForPrompt(skills);
	}

	// Add date and working directory last
	prompt += `\nCurrent date: ${date}`;
	prompt += `\nCurrent working directory: ${promptCwd}`;

	return prompt;
}
