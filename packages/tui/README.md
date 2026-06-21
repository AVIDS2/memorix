# @memorix/tui

Terminal UI primitives used by memcode and other Memorix terminal surfaces. The package provides differential rendering, synchronized terminal output, editor/input components, markdown rendering, selection-aware terminal behavior, and native console helpers.

## Install

```bash
npm install @memorix/tui
```

## Basic Usage

```ts
import { ProcessTerminal, Text, TUI } from "@memorix/tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

tui.addChild(new Text("Hello from Memorix TUI"));
tui.render();
```

## Included Pieces

- `TUI` and `ProcessTerminal`
- text, input, editor, markdown, image, box, loader, and select-list components
- keybinding helpers and visible-width utilities
- native prebuilds for supported terminal behaviors on Windows and macOS

This package is a Memorix-scoped distribution of the terminal UI layer inherited from the Pi codebase. Public imports should use `@memorix/tui`.
