import test from "node:test";
import assert from "node:assert/strict";

import {
  buildResultCountsFromRoll,
  buildResultSequencesFromRoll,
  extractActionType,
  isBlindGmRollMessage,
  resolveRollDetailKey
} from "../scripts/ids-data.js";

const roll = { options: {} };

test("classifies PF2e chat rolls and extracts check details", () => {
  const cases = [
    ["attack-roll", "attack", null],
    ["saving-throw", "save", "fortitude"],
    ["skill-check", "skill", "acrobatics"],
    ["initiative", "initiative", null],
    ["damage-roll", "damage", null]
  ];

  for (const [type, expectedAction, detail] of cases) {
    const message = {
      flags: {
        pf2e: {
          context: { type, domains: [type], messageMode: "public" },
          modifierName: detail
        }
      },
      flavor: "<h4>Localized PF2e roll title</h4>"
    };
    const action = extractActionType(message, roll);
    assert.equal(action, expectedAction);
    assert.equal(resolveRollDetailKey(roll, action, message), detail);
  }

  assert.equal(extractActionType({
    flags: { pf2e: { context: { type: "check", domains: ["all", "skill-check"] } } }
  }, roll), "skill");
});

test("respects PF2e blind message mode", () => {
  assert.equal(isBlindGmRollMessage({
    flags: { pf2e: { context: { messageMode: "blind" } } }
  }, "user-1"), true);
});

test("reads PF2e damage dice from the flattened roll dice getter", () => {
  const damageRoll = {
    terms: [{ rolls: [{ terms: [{ faces: 6, results: [{ result: 4 }] }] }] }],
    dice: [
      { faces: 6, results: [{ result: 4 }, { result: 2 }] },
      { faces: 8, results: [{ result: 7 }] }
    ]
  };

  assert.deepEqual(buildResultCountsFromRoll(damageRoll), {
    d6: { 2: 1, 4: 1 },
    d8: { 7: 1 }
  });
  assert.deepEqual(buildResultSequencesFromRoll(damageRoll), {
    d6: [4, 2],
    d8: [7]
  });
});
