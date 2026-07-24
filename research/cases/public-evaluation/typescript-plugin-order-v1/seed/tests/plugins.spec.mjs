import assert from "node:assert/strict";
import test from "node:test";

import { mergePlugins } from "../src/plugins.mjs";

test("requested duplicate replaces the first plugin without moving it", () => {
  const merged = mergePlugins(
    [
      { id: "Auth", setting: "default" },
      { id: "cache", setting: "enabled" },
    ],
    [
      { id: "auth", setting: "request" },
      { id: "metrics", setting: "sampled" },
    ],
  );

  assert.deepEqual(merged, [
    { id: "Auth", setting: "request" },
    { id: "cache", setting: "enabled" },
    { id: "metrics", setting: "sampled" },
  ]);
});
