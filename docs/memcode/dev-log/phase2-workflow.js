export const meta = {
  name: 'phase2-memory-integration',
  description: 'Phase 2: Integrate Memorix memory system into memcode — 7 integration points',
  phases: [
    { title: 'Config', detail: 'Session path, AGENTS.md, TUI branding' },
    { title: 'Memory', detail: 'Memory injection, storage, native tools, system prompt' },
    { title: 'Verify', detail: 'Build, real test with DeepSeek' },
  ],
}

const ROOT = 'E:/my_idea_cc/my_copilot/memorix'

// ── Phase A: Config changes (parallel) ────────────────────────────
phase('Config')

await parallel([
  // A1: Session path ~/.pi/ → ~/.memorix/
  () => agent(
    `Change the memcode session storage path from ~/.pi/agent/sessions/ to ~/.memorix/sessions/.

Find where the session directory is configured in packages/memcode/. Look for:
- "sessionsRoot" or "sessionDir" or ".pi" or "agent/sessions" in config.ts, session-manager.ts, or similar files
- Any hardcoded paths referencing ".pi" or "~/.pi"

Change them to use ~/.memorix/sessions/ instead.

Also check packages/memcode/src/config.ts for CONFIG_DIR_NAME — it currently defaults to ".pi". Change the default to ".memorix".

Be surgical — only change path-related config, don't restructure anything.
`,
    { label: 'session-path', phase: 'Config', mode: 'bypassPermissions' }
  ),

  // A2: AGENTS.md discovery path
  () => agent(
    `Change the AGENTS.md discovery path in memcode from ~/.pi/agent/AGENTS.md to ~/.memorix/AGENTS.md.

Search packages/memcode/ for references to "AGENTS.md" discovery or loading. Look in:
- ResourceLoader or resource-loader files
- system-prompt.ts or similar
- config.ts

Change the global AGENTS.md path from .pi/agent/ to .memorix/.

Also look for any .pi directory references in the agent rules/config path discovery and change to .memorix.
`,
    { label: 'agents-md', phase: 'Config', mode: 'bypassPermissions' }
  ),

  // A3: TUI branding — remove Pi references
  () => agent(
    `Remove Pi branding from the memcode TUI and replace with memorix branding.

Search packages/memcode/src/ for:
1. "pi" in display strings, welcome messages, help text, version output
2. "pi" in TUI component titles, headers, status bars
3. "pi" in error messages or log output
4. The binary name "pi" in CLI help text

Replace with "memcode" or "memorix" as appropriate. For example:
- "Pi v0.79.0" → "memcode v0.79.0"
- "Welcome to Pi" → "Welcome to memcode"
- "pi --help" → "memcode --help"

Do NOT change:
- Internal variable names (piConfig, etc.) — those are code, not user-facing
- Package names in package.json — already done in Phase 1
- Import paths — leave as is

Focus on USER-FACING text only.
`,
    { label: 'tui-brand', phase: 'Config', mode: 'bypassPermissions' }
  ),
])

// ── Phase B: Memory integration (parallel) ────────────────────────
phase('Memory')

await parallel([
  // B1: Native memory tools (memorix_search, memorix_store, memorix_detail)
  () => agent(
    `Create native memory tools for memcode that integrate with Memorix.

Create a new file: packages/memcode/src/tools/memory-tools.ts

This file should export 3 tool definitions that call Memorix memory functions directly (NOT via MCP):

1. memorix_search — searches memory using compactSearch from src/compact/engine.ts
2. memorix_store — stores observations using storeObservation from src/memory/observations.ts
3. memorix_detail — gets memory detail using getObservation from src/store/obs-store.ts

Each tool should follow the ToolDefinition interface from packages/memcode/src/core/extensions/types.ts:
- name, label, description, parameters (TypeBox schema), execute function
- execute returns { content: [{ type: 'text', text: ... }], details: ... }

For the imports, use relative paths to the memorix src/ directory:
- import { compactSearch } from '../../../../src/compact/engine.js'
- import { storeObservation } from '../../../../src/memory/observations.js'

Also create a file packages/memcode/src/extensions/memory-extension.ts that registers these tools as an Extension.

IMPORTANT: Look at existing extension examples in packages/memcode/src/extensions/ or packages/memcode/examples/extensions/ to understand the Extension interface pattern.
`,
    { label: 'memory-tools', phase: 'Memory', mode: 'bypassPermissions' }
  ),

  // B2: Memory injection hook (before_agent_start)
  () => agent(
    `Create a memory injection hook that runs before each agent turn.

Create a new file: packages/memcode/src/memory/memory-injection.ts

This module should:
1. Export an async function injectMemories(context, projectId, config) that:
   - Builds a search query from the last user message
   - Calls compactSearch() from ../../../../src/compact/engine.js
   - Formats results as a context block
   - Appends to context.systemPrompt

2. The search query should be the last user message text (simplest approach for now)

3. Config should have: { enabled: boolean, maxResults: number, maxTokens: number }

4. Format injected memories as a section titled "Relevant Memories" with bullet points like:
   - [type] title: narrative excerpt...

Also look at how AgentHarness or ExtensionRunner emits 'before_agent_start' events in packages/agent-core/src/harness/agent-harness.ts. Find the hook point where we can inject memories BEFORE the LLM call.

If there's an Extension event handler pattern, register the injection as an extension handler. If not, document where the hook should be wired up.
`,
    { label: 'memory-inject', phase: 'Memory', mode: 'bypassPermissions' }
  ),

  // B3: Memory storage hook (agent_end)
  () => agent(
    `Create a memory storage hook that runs after each agent turn.

Create a new file: packages/memcode/src/memory/memory-storage.ts

This module should:
1. Export an async function storeMemoryFromTurn(messages, projectId, sessionId, config) that:
   - Extracts a summary from assistant messages in the turn
   - Calls storeObservation() from ../../../../src/memory/observations.js
   - Skips trivial turns (less than 2 messages or very short content)

2. Summary extraction (simplest approach for now):
   - Get the last assistant message text
   - Use first 200 chars as title
   - Use full text as narrative
   - Type: 'how-it-works'

3. Config: { enabled: boolean, minTurnsForStorage: number }

Also look at how ExtensionRunner emits 'agent_end' events. Find the hook point where we can store memories AFTER the agent completes a turn.

If there's an Extension event handler pattern, register the storage as an extension handler. If not, document where the hook should be wired up.
`,
    { label: 'memory-store', phase: 'Memory', mode: 'bypassPermissions' }
  ),

  // B4: System prompt with memory instructions
  () => agent(
    `Add memory usage instructions to the memcode system prompt.

Find where the system prompt is assembled in packages/memcode/. Look for:
- system-prompt.ts or similar
- ResourceLoader that loads/concatenates prompt parts
- Any file that builds the system prompt string

Add a new section to the system prompt with title "Persistent Memory" containing:
- You have access to a persistent memory system (Memorix)
- Search memory (memorix_search) before starting work
- Store important findings (memorix_store): decisions, problem-solution, gotcha
- Get details (memorix_detail) when search results look relevant
- Don't store: greetings, trivial reads, redundant status updates

This should be injected AFTER the base system prompt but BEFORE any project-specific instructions.
`,
    { label: 'system-prompt', phase: 'Memory', mode: 'bypassPermissions' }
  ),
])

// ── Phase C: Verify ───────────────────────────────────────────────
phase('Verify')

await agent(
  `Verify Phase 2 memory integration. Steps:

1. cd ${ROOT}
2. Build all packages: cd packages/tui && npx tsc -p tsconfig.build.json && cd ../ai && npx tsc -p tsconfig.build.json && cd ../agent-core && npx tsc -p tsconfig.build.json && cd ../memcode && npx tsc -p tsconfig.build.json && cd ../..
3. Build root: npm run build
4. Check for TypeScript errors and fix them

5. Verify the new files exist:
   - packages/memcode/src/tools/memory-tools.ts
   - packages/memcode/src/extensions/memory-extension.ts
   - packages/memcode/src/memory/memory-injection.ts
   - packages/memcode/src/memory/memory-storage.ts

6. Check that session path config changed from .pi to .memorix

7. Check that TUI branding changed from "pi" to "memcode"

Report: what compiled, what had errors, what you fixed.
`,
  { label: 'verify-p2', phase: 'Verify', mode: 'bypassPermissions' }
)
