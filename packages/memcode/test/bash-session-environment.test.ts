import { afterEach, describe, expect, test } from "vitest";
import type { ExtensionContext } from "../src/core/extensions/types.ts";
import { createBashToolDefinition, type BashOperations } from "../src/core/tools/bash.ts";

const PI_ENV_KEYS = ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"] as const;

const originalPiEnvironment = Object.fromEntries(PI_ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
	for (const key of PI_ENV_KEYS) {
		const originalValue = originalPiEnvironment[key];
		if (originalValue === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = originalValue;
		}
	}
});

function createContext(): ExtensionContext {
	return {
		sessionManager: {
			getSessionId: () => "session-123",
			getSessionFile: () => "E:\\sessions\\session-123.jsonl",
		},
		model: { provider: "openrouter", id: "qwen/qwen3-coder" },
		thinkingLevel: "high",
	} as unknown as ExtensionContext;
}

function captureEnvironment(options?: Parameters<typeof createBashToolDefinition>[1]) {
	let capturedEnvironment: NodeJS.ProcessEnv | undefined;
	const operations: BashOperations = {
		exec: async (_command, _cwd, { env }) => {
			capturedEnvironment = env;
			return { exitCode: 0 };
		},
	};
	const tool = createBashToolDefinition(process.cwd(), { ...options, operations });
	return {
		tool,
		getEnvironment: () => capturedEnvironment,
	};
}

describe("bash session environment", () => {
	test("exposes current session, model, and thinking metadata to LLM bash calls", async () => {
		const seenByHook: NodeJS.ProcessEnv[] = [];
		const { tool, getEnvironment } = captureEnvironment({
			spawnHook: (context) => {
				seenByHook.push(context.env);
				return context;
			},
		});

		await tool.execute("call-1", { command: "echo ok" }, undefined, undefined, createContext());

		expect(getEnvironment()).toMatchObject({
			PI_SESSION_ID: "session-123",
			PI_SESSION_FILE: "E:\\sessions\\session-123.jsonl",
			PI_PROVIDER: "openrouter",
			PI_MODEL: "qwen/qwen3-coder",
			PI_REASONING_LEVEL: "high",
		});
		expect(seenByHook[0]).toMatchObject(getEnvironment());
		expect(tool.promptGuidelines).toContain("Inspect PI_* environment variables for current model and session details.");
	});

	test("does not leak stale PI metadata into a new call without a session context", async () => {
		for (const key of PI_ENV_KEYS) {
			process.env[key] = "stale";
		}
		const { tool, getEnvironment } = captureEnvironment();

		await tool.execute("call-2", { command: "echo ok" });

		for (const key of PI_ENV_KEYS) {
			expect(getEnvironment()?.[key]).toBeUndefined();
		}
	});

	test("allows extensions to disable session metadata exposure", async () => {
		const { tool, getEnvironment } = captureEnvironment({ exposeSessionEnvironment: false });

		await tool.execute("call-3", { command: "echo ok" }, undefined, undefined, createContext());

		for (const key of PI_ENV_KEYS) {
			expect(getEnvironment()?.[key]).toBeUndefined();
		}
		expect(tool.promptGuidelines).toBeUndefined();
	});
});
