import test from "node:test";
import assert from "node:assert/strict";

import { buildRainbowPalette } from "../scripts/ids-ui-helpers.js";

test("maps numeric chart values across the requested rainbow gradient", () => {
  assert.deepEqual(buildRainbowPalette(["1", "4", "8"], 8), [
    "rgb(225, 29, 72)",
    "rgb(249, 140, 22)",
    "rgb(22, 163, 74)"
  ]);
  assert.deepEqual(buildRainbowPalette(["4", "5", "6"], 6), [
    "rgb(250, 186, 21)",
    "rgb(159, 188, 42)",
    "rgb(22, 163, 74)"
  ]);
});
