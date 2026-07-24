import assert from "node:assert/strict";
import test from "node:test";

import { parseToggle } from "../src/toggle.mjs";

test("accepts only explicit boolean values", () => {
  assert.equal(parseToggle(true), true);
  assert.equal(parseToggle(false), false);
  assert.equal(parseToggle("true"), true);
  assert.equal(parseToggle("false"), false);
  assert.equal(parseToggle("TRUE"), undefined);
  assert.equal(parseToggle(""), undefined);
  assert.equal(parseToggle(1), undefined);
});
