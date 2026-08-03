export const LIVE_TESTS_ENV_VAR = "MEMORIX_AI_LIVE_TESTS";

export function liveTestsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[LIVE_TESTS_ENV_VAR] === "1";
}

/**
 * Provider integration tests must opt in. Developers commonly have credentials
 * in their shell, and a routine unit-test run must not unexpectedly make paid
 * network requests or depend on a provider's current response wording.
 */
export function disableAmbientLiveCredentials(env: NodeJS.ProcessEnv = process.env): void {
	if (liveTestsEnabled(env)) return;

	for (const key of Object.keys(env)) {
		if (
			key === "GOOGLE_APPLICATION_CREDENTIALS" ||
			key.endsWith("_API_KEY") ||
			key.endsWith("_TOKEN") ||
			key.endsWith("_SECRET")
		) {
			delete env[key];
		}
	}
}
