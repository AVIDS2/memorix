/**
 * Memorix Core Types
 *
 * Data model sources:
 * - Entity/Relation/KnowledgeGraph: MCP Official Memory Server (v0.6.3)
 * - Observation/ObservationType: claude-mem Progressive Disclosure
 * - UnifiedRule/RuleSource: Memorix original (rules sync)
 *
 * Designed for extensibility: new agent formats (Kiro, Copilot, Antigravity)
 * can be added by extending RuleSource and adding format adapters.
 */
/** Map from ObservationType to display icon */
export const OBSERVATION_ICONS = {
    'session-request': '[SESSION]',
    'gotcha': '[GOTCHA]',
    'problem-solution': '[FIX]',
    'how-it-works': '[INFO]',
    'what-changed': '[CHANGE]',
    'discovery': '[DISCOVERY]',
    'why-it-exists': '[WHY]',
    'decision': '[DECISION]',
    'trade-off': '[TRADEOFF]',
    'reasoning': '[REASONING]',
    'probe': '[PROBE]',
};
/** Topic key family heuristics for suggesting stable topic keys */
export const TOPIC_KEY_FAMILIES = {
    'architecture': ['architecture', 'design', 'adr', 'structure', 'pattern'],
    'bug': ['bugfix', 'fix', 'error', 'regression', 'crash', 'problem-solution'],
    'decision': ['decision', 'trade-off', 'choice', 'strategy'],
    'config': ['config', 'setup', 'env', 'environment', 'deployment'],
    'discovery': ['discovery', 'learning', 'insight', 'gotcha'],
    'pattern': ['pattern', 'convention', 'standard', 'best-practice'],
};
export const DEFAULT_CONFIG = {
    enableEmbeddings: false,
    enableRulesSync: false,
    watchRuleFiles: false,
};
//# sourceMappingURL=types.js.map