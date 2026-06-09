/**
 * memorix.yml Configuration Loader
 *
 * Loads YAML configuration from project-level and user-level paths.
 * This is the platform-grade config format — Memorix as a central hub,
 * not just an MCP plugin.
 *
 * Priority chain (highest wins):
 *   1. Environment variables
 *   2. ./memorix.yml (project-level, in project root)
 *   3. ~/.memorix/memorix.yml (user-level, global defaults)
 *   4. ~/.memorix/config.json (legacy, backward compat)
 *   5. Hardcoded defaults
 *
 * Inspired by: Cipher's cipher.yml, Docker's docker-compose.yml
 */
export interface MemorixYamlConfig {
    /** LLM provider configuration */
    llm?: {
        provider?: 'openai' | 'anthropic' | 'openrouter' | string;
        model?: string;
        apiKey?: string;
        baseUrl?: string;
    };
    /** TUI / chat agent LLM provider configuration */
    agent?: {
        provider?: 'openai' | 'anthropic' | 'openrouter' | string;
        model?: string;
        apiKey?: string;
        baseUrl?: string;
    };
    /** Embedding / vector search configuration */
    embedding?: {
        provider?: 'off' | 'api' | 'fastembed' | 'transformers' | 'auto';
        model?: string;
        apiKey?: string;
        baseUrl?: string;
        dimensions?: number;
    };
    /** Git-Memory pipeline configuration */
    git?: {
        /** Auto-install post-commit hook on first run (default: false) */
        autoHook?: boolean;
        /** Ingest commits as memories on post-commit (default: true when hook installed) */
        ingestOnCommit?: boolean;
        /** Maximum diff size (chars) to include in memory (default: 500) */
        maxDiffSize?: number;
        /** Skip merge commits (default: true) */
        skipMergeCommits?: boolean;
        /** File patterns to exclude from git memory (glob) */
        excludePatterns?: string[];
        /** Additional commit message patterns to treat as noise (regex strings) */
        noiseKeywords?: string[];
    };
    /** Behavior settings */
    behavior?: {
        /** Session start injection mode */
        sessionInject?: 'full' | 'minimal' | 'silent';
        /** Show sync advisory on first search */
        syncAdvisory?: boolean;
        /** Auto-archive expired memories on startup */
        autoCleanup?: boolean;
        /** Formation Pipeline mode */
        formationMode?: 'active' | 'shadow' | 'fallback';
    };
    /** MCP server mode configuration (when Memorix runs as hub) */
    server?: {
        /** Transport: stdio (default) or http */
        transport?: 'stdio' | 'http';
        /** HTTP port (only for http transport) */
        port?: number;
        /** Enable Web Dashboard */
        dashboard?: boolean;
        /** Dashboard port (default: 3210) */
        dashboardPort?: number;
    };
    /** Autonomous Agent Team settings */
    team?: {
        /** Enable autonomous Agent Team features */
        enabled?: boolean;
        /** Shared workspace memory collection */
        workspaceCollection?: string;
    };
    /** Additional MCP servers to aggregate (Memorix as hub) */
    mcpServers?: Record<string, {
        type?: 'stdio' | 'sse';
        command?: string;
        args?: string[];
        env?: Record<string, string>;
        url?: string;
    }>;
}
/**
 * Set the project root for YAML config resolution.
 * Call this once during server init so all config getters
 * (which call loadYamlConfig() without args) pick up project-level memorix.yml.
 *
 * In HTTP mode, this is called per-session/switchProject — the Map cache
 * preserves configs for all projects simultaneously.
 */
export declare function initProjectRoot(root: string): void;
/**
 * Clear the global project root used by no-arg loadYamlConfig().
 * Useful when a long-lived process switches to a project whose root is unknown.
 */
export declare function clearProjectRoot(): void;
/**
 * Load memorix.yml from project root and/or user home.
 * Project-level overrides user-level (shallow merge per top-level key).
 */
export declare function loadYamlConfig(projectRoot?: string | null): MemorixYamlConfig;
/**
 * Reset cached YAML config (for testing or project switching).
 * Invalidates all cached entries, or a specific projectRoot if provided.
 */
export declare function resetYamlConfigCache(projectRoot?: string | null): void;
//# sourceMappingURL=yaml-loader.d.ts.map