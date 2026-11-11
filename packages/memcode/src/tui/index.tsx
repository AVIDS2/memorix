/**
 * Memcode TUI entry point.
 *
 * Creates the OpenTUI CLI renderer, mounts the React root,
 * and renders the App component. Call startTui() to launch.
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { App } from "./app.tsx";

export async function startTui(runtime: AgentSessionRuntime): Promise<void> {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
	});

	const root = createRoot(renderer);
	root.render(<App runtime={runtime} />);
}
