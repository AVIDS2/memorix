import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRetryConfig } from "../src/retry-config.mjs";

test("the current config uses retries and omits the retired field", () => {
  assert.deepEqual(normalizeRetryConfig({ retryCount: 2 }), { retries: 2 });
  assert.deepEqual(normalizeRetryConfig({ retries: 4, retryCount: 2 }), { retries: 4 });
  assert.deepEqual(normalizeRetryConfig({}), {});
});
