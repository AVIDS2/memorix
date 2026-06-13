function isTruthyEnvFlag(value: string | undefined): boolean {
	if (!value) return false;
	return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

export function shouldUseExperimentalTui(env: NodeJS.ProcessEnv = process.env): boolean {
	return isTruthyEnvFlag(env.MEMCODE_EXPERIMENTAL_TUI ?? env.PI_EXPERIMENTAL_TUI);
}
