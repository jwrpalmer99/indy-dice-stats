export const MODULE_ID = "indy-dice-stats";
export const STATS_FLAG = "stats";
export const CHART_JS_SRC = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
export const FLATTED_SRC = "https://cdn.jsdelivr.net/npm/flatted@3.3.3/min.js";

export const ACTION_LABELS = {
  attack: "Attack Rolls",
  damage: "Damage Rolls",
  save: "Saving Throw",
  check: "Ability Check",
  skill: "Skill Check",
  ability: "Ability Check",
  initiative: "Initiative",
  deathsave: "Death Save",
  tool: "Tool Check",
  heal: "Healing",
  spell: "Spell",
  other: "Other"
};

export const ACTION_ORDER = [
  "attack",
  "damage",
  "save",
  "check",
  "skill",
  "ability",
  "initiative",
  "deathsave",
  "tool",
  "heal",
  "spell",
  "other"
];

export const FAKE_SESSION_COUNT = 12;
export const FAKE_ROLLS_MIN = 30;
export const FAKE_ROLLS_MAX = 90;

export const FAKE_ACTION_TYPES = [
  "attack",
  "damage",
  "save",
  "check",
  "skill",
  "ability",
  "initiative",
  "deathsave",
  "tool",
  "heal",
  "spell",
  "other"
];

export const FAKE_ACTION_POOL = [
  "attack",
  "attack",
  "attack",
  "damage",
  "damage",
  "damage",
  "save",
  "skill",
  "skill",
  "check",
  "ability",
  "initiative",
  "spell",
  "heal",
  "tool",
  "other"
];

export const FAKE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

export const FAKE_SKILLS = [
  "acrobatics",
  "animal-handling",
  "arcana",
  "athletics",
  "deception",
  "history",
  "insight",
  "intimidation",
  "investigation",
  "medicine",
  "nature",
  "perception",
  "performance",
  "persuasion",
  "religion",
  "sleight-of-hand",
  "stealth",
  "survival"
];

export const FAKE_DAMAGE_DICE = [
  [{ faces: 6, count: 2 }],
  [{ faces: 8, count: 1 }],
  [{ faces: 10, count: 1 }],
  [{ faces: 12, count: 1 }],
  [{ faces: 4, count: 2 }],
  [{ faces: 6, count: 1 }, { faces: 4, count: 1 }],
  [{ faces: 8, count: 2 }]
];

export const FAKE_DAMAGE_FACES = [4, 6, 8, 10, 12];

export const FAKE_HEAL_DICE = [
  [{ faces: 4, count: 1 }],
  [{ faces: 8, count: 1 }],
  [{ faces: 10, count: 1 }],
  [{ faces: 4, count: 2 }],
  [{ faces: 6, count: 2 }]
];

export const ITEM_ACTION_TYPE_MAP = {
  mwak: "attack",
  rwak: "attack",
  msak: "attack",
  rsak: "attack",
  save: "save",
  heal: "heal",
  util: "other"
};
