import assert from "node:assert/strict";
import test from "node:test";

import { formatApiKey } from "../src/keys.mjs";

test("current credential migration uses the key prefix", () => {
  assert.equal(formatApiKey("abc123"), "key_abc123");
});
