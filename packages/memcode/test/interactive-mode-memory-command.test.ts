import { Container } from "@memorix/tui";
import { afterEach, describe, expect, test, vi } from "vitest";
import { MEMORY_COMMANDS } from "../src/tui/commands/memory-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

type MemoryCommandContext = {
	chatContainer: Container;
	ui: { requestRender: ReturnType<typeof vi.fn> };
	runtimeHost: unknown;
	getMarkdownThemeWithSettings: () => any;
	showStatus: ReturnType<typeof vi.fn>;
	showError: ReturnType<typeof vi.fn>;
};

const prototype = InteractiveMode.prototype as unknown as {
	handleMemoryCommand(this: MemoryCommandContext, text: string): Promise<void> | void;
};

function createContext(): MemoryCommandContext {
	initTheme("dark");
	return Object.assign(Object.create(prototype), {
		chatContainer: new Container(),
		ui: { requestRender: vi.fn() },
		runtimeHost: { session: { messages: [], sessionManager: { getCwd: () => "E:\\project\\memorix" } } },
		getMarkdownThemeWithSettings: () => undefined,
		showStatus: vi.fn(),
		showError: vi.fn(),
	});
}

function renderContext(context: MemoryCommandContext): string {
	return stripAnsi(context.chatContainer.render(120).join("\n"));
}

describe("InteractiveMode /memory command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("dispatches /memory stats to the shared memory command handler", async () => {
		const context = createContext();
		const original = MEMORY_COMMANDS.stats;
		const handler = vi.fn(async (_args, ctx) => {
			ctx.addMessage("Memory Stats\nType distribution:\n  decision: 2");
			return { toast: { msg: "stats ready", type: "info" as const } };
		});
		MEMORY_COMMANDS.stats = handler;
		try {
			await prototype.handleMemoryCommand.call(context, "/memory stats");
		} finally {
			MEMORY_COMMANDS.stats = original;
		}

		expect(handler).toHaveBeenCalledWith(
			"",
			expect.objectContaining({
				cwd: "E:\\project\\memorix",
				runtime: context.runtimeHost,
			}),
		);
		expect(renderContext(context)).toContain("Memory Stats");
		expect(context.showStatus).toHaveBeenCalledWith("stats ready");
		expect(context.ui.requestRender).toHaveBeenCalled();
	});

	test("passes search text through without treating it as help", async () => {
		const context = createContext();
		const original = MEMORY_COMMANDS.search;
		const handler = vi.fn(async (args, ctx) => {
			ctx.addMessage(`Search query: ${args}`);
			return {};
		});
		MEMORY_COMMANDS.search = handler;
		try {
			await prototype.handleMemoryCommand.call(context, "/memory search startup card");
		} finally {
			MEMORY_COMMANDS.search = original;
		}

		expect(handler).toHaveBeenCalledWith("startup card", expect.any(Object));
		expect(renderContext(context)).toContain("Search query: startup card");
	});
});
