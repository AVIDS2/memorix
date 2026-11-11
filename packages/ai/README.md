# @memorix/ai

Shared LLM provider toolkit used by Memorix packages. It provides provider registration, model lookup, streaming helpers, tool-call handling, OAuth helpers, and generated model metadata for agent workflows.

## Install

```bash
npm install @memorix/ai
```

## Basic Usage

```ts
import { complete, getModel } from "@memorix/ai";

const model = getModel("openai", "gpt-4o-mini");
const result = await complete({
	model,
	messages: [{ role: "user", content: "Say hello from Memorix." }],
});

console.log(result.message.content);
```

## CLI

```bash
npx memorix-ai list
npx memorix-ai login anthropic
```

## Notes

This package is a Memorix-scoped distribution of the agent provider layer inherited from the Pi codebase. Public imports should use `@memorix/ai`.

## MiniMax text models

The direct global/China catalogs offer `MiniMax-M3.1-Flash` first, then `MiniMax-M3`.
Both have a 1,000,000-token context and 524,288-token output maximum. Flash always
uses adaptive thinking with `low`, `medium`, `high`, `xhigh`, or `max` effort
(default `max`); unsupported efforts normalize to `max`. The generic simple
reasoning selector exposes low through xhigh; use the Anthropic `effort` option
for explicit `max`. Flash removes disabled thinking, `service_tier`, and
`reasoning_split`, including payload-hook overrides. M3 supports adaptive or
disabled thinking; omitted thinking keeps the Anthropic default (disabled).

Flash's USD/M rates are input 0.15, output 0.60, and cache read 0.015. Cache-write
pricing is unpublished; the flat schema's `cacheWrite: 0` means unpriced and
can undercount estimates, not a verified free-write rate. M3's flat card is
Standard input at most 512k (0.30/1.20/0.06); above 512k the rates are
0.60/2.40/0.12, and Priority is 1.5x. The flat estimator does not select these
M3 tiers automatically.

Legacy model metadata remains available via exact `getModel` lookup and
`getModels(provider, { includeLegacy: true })`, including saved memcode sessions.
Ordinary OpenRouter/OpenCode choices hide known older MiniMax text generations
only on those providers' actual hosts. Custom endpoints and media models remain
intact. The OpenRouter Flash `:free` entry comes from its live catalog and uses
its reported pricing; direct API availability does not imply other gateway routes.

Sources: [models](https://platform.minimax.io/docs/guides/models-intro.md),
[pricing](https://platform.minimax.io/docs/pricing/overview.md),
[Anthropic API](https://platform.minimax.io/docs/api-reference/text-chat-anthropic.md),
[OpenRouter catalog](https://openrouter.ai/api/v1/models).

## Testing

`npm test` is intentionally offline and deterministic, even when the shell has provider credentials. To run provider-backed integration tests deliberately, set `MEMORIX_AI_LIVE_TESTS=1` together with the required provider credentials. This can make network requests and incur provider charges.
