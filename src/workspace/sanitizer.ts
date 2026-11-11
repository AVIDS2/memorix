/**
 * Sanitizer — mask sensitive values (tokens, keys, passwords) in output.
 *
 * Patterns detected:
 * - API keys / tokens (github_pat_*, ctx7sk-*, sk-*, ghp_*, ghu_*, etc.)
 * - Generic key=value where key contains "token", "key", "secret", "password"
 * - Bearer tokens
 */

const SENSITIVE_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // GitHub PAT (classic & fine-grained)
  { pattern: /ghp_[A-Za-z0-9_]{36,}/g, replacement: 'ghp_***' },
  { pattern: /github_pat_[A-Za-z0-9_]{60,}/g, replacement: 'github_pat_***' },
  { pattern: /ghu_[A-Za-z0-9_]{36,}/g, replacement: 'ghu_***' },
  { pattern: /ghs_[A-Za-z0-9_]{36,}/g, replacement: 'ghs_***' },
  // OpenAI / Anthropic style keys
  { pattern: /sk-[A-Za-z0-9_-]{20,}/g, replacement: 'sk-***' },
  // Context7 keys
  { pattern: /ctx7sk-[A-Za-z0-9-]{20,}/g, replacement: 'ctx7sk-***' },
  // Generic long hex/base64 tokens (32+ chars) in quoted values
  { pattern: /"([A-Za-z0-9_-]{40,})"/g, replacement: '"***"' },
];

const SENSITIVE_KEY_PATTERN = /(?:token|key|secret|password|credential|auth)/i;

/**
 * Mask sensitive values in a string.
 */
export function sanitize(input: string): string {
  let result = input;

  // Apply known token patterns
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }

  return result;
}

/**
 * Mask sensitive values in MCPServerEntry env/headers objects.
 * Returns a new object with masked values.
 */
export function sanitizeRecord(
  record: Record<string, string> | undefined | null,
): Record<string, string> | undefined {
  if (!record) return undefined;

  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = '***';
    } else {
      masked[key] = value;
    }
  }
  return masked;
}
