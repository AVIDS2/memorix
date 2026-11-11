/**
 * Significance Filter
 *
 * Determines if content is significant enough to be stored as memory.
 * Inspired by Cipher's isSignificantKnowledge() — filters out trivial content
 * while preserving technical knowledge, decisions, and problem-solving.
 *
 * Performance: O(n) regex matching, ~0.1-0.5ms per call.
 * No external dependencies, pure TypeScript.
 */

// ─── Skip Patterns (content that should NOT be stored) ───

const SKIP_PATTERNS: RegExp[] = [
  // Personal information and identity (privacy)
  /\b(my name|user['']?s? name|find my name|who am i|what['']?s my name)\b/i,
  /\b(password|secret|api[_-]?key|access[_-]?token|private[_-]?key)\b/i,

  // Simple greetings and social interactions
  /^(user:|assistant:)?\s*(hello|hi|hey|good morning|good afternoon|good evening|thanks|thank you|please|sorry|excuse me|bye|goodbye|你好|谢谢|再见)\b/i,

  // Generic status messages
  /^(task completed|operation successful|processing|loading|waiting|done|finished|ready|完成|成功|处理中)\b/i,

  // Simple yes/no or acknowledgment responses
  /^(user:|assistant:)?\s*(yes|no|ok|okay|sure|fine|great|good|right|correct|wrong|true|false|是|否|好的|对|错)\s*[.!?]?\s*$/i,

  // Tool results with no meaningful content
  /^(memorix_search|memorix_store|memorix_detail):\s*(found|completed|no results|error|stored)/i,

  // Empty or whitespace-only
  /^\s*$/,

  // Very short content (less than 10 chars after trimming)
  /^.{0,9}$/,
];

// ─── Technical Patterns (content that SHOULD be stored) ───

const TECHNICAL_PATTERNS: RegExp[] = [
  // Programming concepts and patterns
  /\b(function|method|class|interface|module|library|framework|algorithm|data structure|design pattern)\b/i,
  /\b(variable|constant|parameter|argument|return|async|await|promise|callback|closure|scope)\b/i,
  /\b(loop|iteration|recursion|condition|exception|error handling|debugging|testing|optimization)\b/i,

  // Code elements and syntax
  /\b(import|export|require|include|package|dependency|api|endpoint|request|response)\b/i,
  /\b(database|query|sql|nosql|schema|table|index|transaction|orm|migration)\b/i,
  /\b(git|version control|commit|merge|branch|pull request|repository|deployment)\b/i,

  // Technical implementations
  /\b(implements?|extends?|inherits?|overrides?|polymorphism|encapsulation|abstraction)\b/i,
  /\b(sort|search|filter|map|reduce|transform|parse|serialize|encrypt|decrypt)\b/i,
  /\b(authentication|authorization|security|validation|sanitization|middleware)\b/i,

  // Code blocks and technical syntax
  /```[\s\S]*```/,
  /`[^`]+`/,

  // Package managers and build tools
  /\b(npm|yarn|pnpm|pip|composer|cargo|go get|mvn|gradle|webpack|vite|rollup|tsup)\b/i,

  // File and system operations
  /\b(file|directory|path|config|environment|server|client|host|port|url|http|https|ssl|tls)\b/i,
  /\b(dockerfile|docker|container|kubernetes|cloud|aws|azure|gcp|ci\/cd|pipeline)\b/i,

  // Programming languages and technologies
  /\b(javascript|typescript|python|java|c\+\+|c#|rust|go|php|ruby|swift|kotlin|scala)\b/i,
  /\b(react|vue|angular|node|express|django|flask|spring|rails|laravel|fastapi|nextjs)\b/i,
  /\b(html|css|scss|sass|tailwind|bootstrap)\b/i,

  // Error messages and debugging
  /\b(error|exception|traceback|stack trace|compilation|syntax error|runtime error|bug|fix)\b/i,
  /(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|AggregateError)/,

  // Technical explanations and problem-solving
  /\b(solution|approach|implementation|technique|strategy|pattern|best practice|optimization)\b/i,
  /\b(performance|scalability|maintainability|refactoring|code review|documentation)\b/i,

  // Decision and architecture keywords
  /\b(decision|chose|选择|决定|architecture|设计|trade-?off|权衡|因为|because|reason|原因)\b/i,

  // Chinese technical terms (no word boundary - Chinese doesn't use spaces)
  /(函数|方法|类|接口|模块|框架|算法|数据结构|设计模式|变量|常量|参数|返回|异步|回调|闭包|作用域)/,
  /(循环|迭代|递归|条件|异常|错误处理|调试|测试|优化|导入|导出|依赖|接口|端点|请求|响应)/,
  /(数据库|查询|表|索引|事务|迁移|版本控制|提交|合并|分支|部署|实现|继承|重写|多态|封装|抽象)/,
];

// ─── Code-like Patterns ───

const CODE_PATTERNS: RegExp[] = [
  /[{}[\]()]/, // Brackets and parentheses
  /[=><!&|]{2}/, // Double operators (==, !=, &&, ||, etc.)
  /\w+\.\w+\(/, // Method calls (obj.method()
  /\w+\s*=\s*\w+/, // Assignment
  /\/\*[\s\S]*?\*\/|\/\/.*$/m, // Comments
  /\$[a-zA-Z_][a-zA-Z0-9_]*/, // Shell/PHP variables
  /@\w+/, // Decorators/annotations
];

// ─── Technical Words (for density calculation) ───

const TECHNICAL_WORDS = new Set([
  'api', 'sdk', 'cli', 'gui', 'ui', 'ux', 'ide', 'editor', 'compiler', 'interpreter',
  'runtime', 'virtual', 'machine', 'container', 'image', 'build', 'deploy', 'release',
  'version', 'update', 'patch', 'bug', 'feature', 'enhancement', 'issue', 'ticket',
  'workflow', 'process', 'pipeline', 'automation', 'script', 'batch', 'cron', 'job',
  'service', 'microservice', 'monolith', 'architecture', 'pattern', 'design', 'system',
  'network', 'protocol', 'tcp', 'udp', 'http', 'https', 'ssl', 'tls', 'dns', 'cdn',
  'cache', 'redis', 'memcached', 'session', 'cookie', 'token', 'jwt', 'oauth', 'auth',
  'encrypt', 'decrypt', 'hash', 'salt', 'key', 'certificate', 'binary', 'buffer',
  'json', 'xml', 'yaml', 'toml', 'csv', 'markdown', 'html', 'css', 'regex', 'parser',
  'lexer', 'ast', 'ir', 'bytecode', 'jit', 'gc', 'heap', 'stack', 'memory', 'cpu',
  'thread', 'process', 'async', 'sync', 'concurrent', 'parallel', 'mutex', 'lock',
  'semaphore', 'deadlock', 'race', 'condition', 'atomic', 'volatile', 'immutable',
]);

// ─── Main Filter Function ───

export interface SignificanceResult {
  /** Whether the content is significant enough to store */
  isSignificant: boolean;
  /** Reason for the decision (for debugging/logging) */
  reason: string;
  /** Confidence score 0-1 (higher = more confident in decision) */
  confidence: number;
}

/**
 * Determine if content is significant enough to be stored as memory.
 *
 * @param content - The text content to evaluate
 * @returns SignificanceResult with decision, reason, and confidence
 */
export function isSignificantKnowledge(content: string): SignificanceResult {
  if (!content || typeof content !== 'string') {
    return { isSignificant: false, reason: 'empty_content', confidence: 1.0 };
  }

  const text = content.trim();
  const textLower = text.toLowerCase();

  // ─── Phase 1: Skip patterns (fast rejection) ───
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(text)) {
      return { isSignificant: false, reason: 'skip_pattern', confidence: 0.9 };
    }
  }

  // ─── Phase 2: Technical patterns (fast acceptance) ───
  for (const pattern of TECHNICAL_PATTERNS) {
    if (pattern.test(text)) {
      return { isSignificant: true, reason: 'technical_pattern', confidence: 0.85 };
    }
  }

  // ─── Phase 3: Code-like patterns ───
  let codePatternMatches = 0;
  for (const pattern of CODE_PATTERNS) {
    if (pattern.test(text)) {
      codePatternMatches++;
    }
  }
  if (codePatternMatches >= 2) {
    return { isSignificant: true, reason: 'code_patterns', confidence: 0.75 };
  }

  // ─── Phase 4: Technical word density ───
  const words = textLower.split(/\s+/).filter(w => w.length > 1);
  if (words.length > 5) {
    const technicalWordCount = words.filter(word =>
      TECHNICAL_WORDS.has(word.replace(/[^\w]/g, ''))
    ).length;
    const density = technicalWordCount / words.length;

    if (density > 0.15) {
      return { isSignificant: true, reason: 'high_technical_density', confidence: 0.7 };
    }
    if (density > 0.08 && words.length > 20) {
      return { isSignificant: true, reason: 'moderate_technical_density', confidence: 0.6 };
    }
  }

  // ─── Phase 5: Length-based heuristic ───
  // Longer content is more likely to be significant
  if (text.length > 200) {
    return { isSignificant: true, reason: 'substantial_length', confidence: 0.5 };
  }

  // ─── Default: not significant ───
  return { isSignificant: false, reason: 'no_technical_indicators', confidence: 0.6 };
}

/**
 * Check if content is a retrieved/search result that shouldn't be re-stored.
 * Prevents memory pollution from search results being stored as new memories.
 */
export function isRetrievedResult(content: string): boolean {
  if (!content || typeof content !== 'string') return false;
  const text = content.toLowerCase();

  const retrievedPatterns = [
    /^(memorix_search|memorix_detail|memorix_timeline|search_nodes|read_graph):/i,
    /^(retrieved|result|results|found|matches|nodes|edges|search completed):/i,
    /^(observation #\d+|stored observation|memory #\d+)/i,
    /^(id:|timestamp:|similarity:|source:|type:)/i,
    /^(totalresults:|searchtime:|tokens:)/i,
  ];

  for (const pattern of retrievedPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Quick check for trivial commands that should never be stored.
 * Faster than full isSignificantKnowledge for common cases.
 */
export function isTrivialCommand(command: string): boolean {
  if (!command || typeof command !== 'string') return true;

  const trivialPatterns = [
    /^(ls|dir|cd|pwd|echo|cat|type|head|tail|wc|which|where|whoami)(\s|$)/i,
    /^(Get-Content|Test-Path|Get-Item|Get-ChildItem|Set-Location|Write-Host)(\s|$)/i,
    /^(git\s+(status|log|diff|show|branch|remote|stash\s+list))(\s|$)/i,
    /^(npm\s+(list|ls|view|info|outdated))(\s|$)/i,
    /^(pip\s+(list|show|freeze)|python\s+--?version|node\s+--?version)(\s|$)/i,
    /^(env|printenv|set|export)(\s|$)/i,
    /^(clear|cls|exit|quit)(\s|$)/i,
  ];

  const cmd = command.trim();

  for (const pattern of trivialPatterns) {
    if (pattern.test(cmd)) {
      return true;
    }
  }

  // Self-referential: inspecting memorix's own data files
  if (/\.memorix[/\\]|observations\.json|memorix.*data/i.test(cmd)) {
    return true;
  }

  return false;
}
