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
