/**
 * .env Loader for Memorix
 *
 * Loads secrets from project-level .env file.
 * This is the "secrets-only" complement to memorix.yml (behavior config).
 *
 * Design principle:
 *   memorix.yml = behavior configuration (structured YAML)
 *   .env        = secrets only (API keys, base URLs, tokens)
 *
 * Priority (highest wins):
 *   1. System environment variables (from MCP host `env` field or shell)
 *   2. Project .env file (./  .env in project root)
 *   3. User .env file (~/.memorix/.env) — advanced, not promoted
 *
 * Unlike Cipher which puts EVERYTHING in .env (178 lines of flat config),
 * Memorix only uses .env for sensitive values. Structured settings stay in YAML.
 */
interface DotenvLoadOptions {
    userHomeDir?: string;
}
/**
 * Load .env files into process.env.
 * Called once during startup. Does NOT override existing env vars.
 *
 * @param projectRoot - Project root directory (for project-level .env)
 */
export declare function loadDotenv(projectRoot?: string, options?: DotenvLoadOptions): void;
/**
 * Reset dotenv state (for testing or project switch).
 */
export declare function resetDotenv(): void;
/**
 * Get list of .env files that were loaded (for diagnostics).
 */
export declare function getLoadedEnvFiles(): readonly string[];
export {};
//# sourceMappingURL=dotenv-loader.d.ts.map