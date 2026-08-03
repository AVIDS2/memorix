import { describe, expect, it } from "vitest";
import { disableAmbientLiveCredentials, liveTestsEnabled } from "./live-test-gate.ts";

describe("live test gate", () => {
	it("keeps routine test runs offline even when the shell has provider credentials", () => {
		const env = {
			OPENROUTER_API_KEY: "secret",
			COPILOT_GITHUB_TOKEN: "token",
			GOOGLE_APPLICATION_CREDENTIALS: "C:\\credentials.json",
			KEEP_ME: "safe",
		} as NodeJS.ProcessEnv;

		disableAmbientLiveCredentials(env);

		expect(liveTestsEnabled(env)).toBe(false);
		expect(env.OPENROUTER_API_KEY).toBeUndefined();
		expect(env.COPILOT_GITHUB_TOKEN).toBeUndefined();
		expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
		expect(env.KEEP_ME).toBe("safe");
	});

	it("preserves credentials only when live tests are explicitly enabled", () => {
		const env = {
			MEMORIX_AI_LIVE_TESTS: "1",
			OPENROUTER_API_KEY: "secret",
		} as NodeJS.ProcessEnv;

		disableAmbientLiveCredentials(env);

		expect(liveTestsEnabled(env)).toBe(true);
		expect(env.OPENROUTER_API_KEY).toBe("secret");
	});
});
