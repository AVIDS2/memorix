# @memorix/agent-core

Core agent runtime used by memcode and related Memorix agent surfaces. It provides a stateful agent loop, tool execution, event streaming, prompt/session helpers, and test harness utilities.

## Install

```bash
npm install @memorix/agent-core @memorix/ai
```

## Basic Usage

```ts
import { getModel } from "@memorix/ai";
import { Agent } from "@memorix/agent-core";

const agent = new Agent({
	initialState: {
		systemPrompt: "You are a helpful coding assistant.",
		model: getModel("openai", "gpt-4o-mini"),
	},
});

agent.subscribe((event) => {
	if (event.type === "message_update") {
		console.log(event);
	}
});
```

## Notes

This package is a Memorix-scoped distribution of the agent runtime layer inherited from the Pi codebase. Public imports should use `@memorix/agent-core`.
