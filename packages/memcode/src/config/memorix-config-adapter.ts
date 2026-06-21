export interface MemorixAgentLaneConfig {
	agent?: {
		provider?: string;
		model?: string;
		baseUrl?: string;
		apiKey?: string;
	};
}

type WritableEnv = Record<string, string | undefined>;

export function applyMemorixAgentDefaults(config: MemorixAgentLaneConfig, env: WritableEnv = process.env): void {
	const agent = config.agent;
	if (!agent) return;

	setDefault(env, "MEMORIX_AGENT_PROVIDER", agent.provider, ["MEMORIX_AGENT_LLM_PROVIDER"]);
	setDefault(env, "MEMORIX_AGENT_MODEL", agent.model, ["MEMORIX_AGENT_LLM_MODEL"]);
	setDefault(env, "MEMORIX_AGENT_BASE_URL", agent.baseUrl, ["MEMORIX_AGENT_LLM_BASE_URL"]);
	setDefault(env, "MEMORIX_AGENT_API_KEY", agent.apiKey, ["MEMORIX_AGENT_LLM_API_KEY"]);
}

function setDefault(env: WritableEnv, key: string, value: string | undefined, legacyKeys: string[]): void {
	if (!value) return;
	if (env[key]) return;
	if (legacyKeys.some((legacyKey) => env[legacyKey])) return;
	env[key] = value;
}
