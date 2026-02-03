const MODULE_ID = "indy-dice-stats";
const STATS_FLAG = "stats";
const CHART_JS_SRC = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
const FLATTED_SRC = "https://cdn.jsdelivr.net/npm/flatted@3.3.3/min.js";

const ACTION_LABELS = {
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

const ACTION_ORDER = [
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

const FAKE_SESSION_COUNT = 12;
const FAKE_ROLLS_MIN = 30;
const FAKE_ROLLS_MAX = 90;

const FAKE_ACTION_TYPES = [
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

const FAKE_ACTION_POOL = [
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

const FAKE_ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

const FAKE_SKILLS = [
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

const FAKE_DAMAGE_DICE = [
  [{ faces: 6, count: 2 }],
  [{ faces: 8, count: 1 }],
  [{ faces: 10, count: 1 }],
  [{ faces: 12, count: 1 }],
  [{ faces: 4, count: 2 }],
  [{ faces: 6, count: 1 }, { faces: 4, count: 1 }],
  [{ faces: 8, count: 2 }]
];

const FAKE_DAMAGE_FACES = [4, 6, 8, 10, 12];

const FAKE_HEAL_DICE = [
  [{ faces: 4, count: 1 }],
  [{ faces: 8, count: 1 }],
  [{ faces: 10, count: 1 }],
  [{ faces: 4, count: 2 }],
  [{ faces: 6, count: 2 }]
];

const ITEM_ACTION_TYPE_MAP = {
  mwak: "attack",
  rwak: "attack",
  msak: "attack",
  rsak: "attack",
  save: "save",
  heal: "heal",
  util: "other"
};

const state = {
  globalStats: null,
  saveDebounced: null,
  snapshotDebounced: null,
  refreshDebounced: null,
  chartPromise: null,
  flattedPromise: null,
  workflowMeta: new Map(),
  processedMessages: new Set(),
  themeObserver: null,
  themeIsDark: null,
  candlestickRegistered: false,
  uiStateDebounced: null,
  uiStatePending: null
};

function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

function getUiState() {
  return game.settings.get(MODULE_ID, "uiState") || {};
}

function scheduleUiStateSave(partialState) {
  const base = state.uiStatePending || getUiState();
  state.uiStatePending = { ...base, ...partialState };
  if (!state.uiStateDebounced) {
    state.uiStateDebounced = debounce(() => {
      if (!state.uiStatePending) return;
      const value = state.uiStatePending;
      state.uiStatePending = null;
      game.settings.set(MODULE_ID, "uiState", value);
    }, 300);
  }
  state.uiStateDebounced();
}

function createEmptyStats() {
  return {
    v: 1,
    updatedAt: 0,
    totals: {
      rolls: 0,
      dice: 0
    },
    dice: {},
    actions: {},
    streaks: {}
  };
}

function createGlobalStats() {
  return {
    ...createEmptyStats(),
    users: {},
    byDate: {},
    usersByDate: {}
  };
}

function normalizeStats(raw) {
  const base = createEmptyStats();
  if (!raw || typeof raw !== "object") return base;
  base.v = typeof raw.v === "number" ? raw.v : base.v;
  base.updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : base.updatedAt;
  if (raw.totals && typeof raw.totals === "object") {
    base.totals.rolls = Number(raw.totals.rolls) || 0;
    base.totals.dice = Number(raw.totals.dice) || 0;
  }
  base.dice = raw.dice && typeof raw.dice === "object" ? raw.dice : {};
  base.actions = raw.actions && typeof raw.actions === "object" ? raw.actions : {};
  base.streaks = raw.streaks && typeof raw.streaks === "object" ? raw.streaks : {};
  return base;
}

function normalizeGlobalStats(raw) {
  const base = createGlobalStats();
  if (!raw || typeof raw !== "object") return base;
  const normalized = normalizeStats(raw);
  base.v = normalized.v;
  base.updatedAt = normalized.updatedAt;
  base.totals = normalized.totals;
  base.dice = normalized.dice;
  base.actions = normalized.actions;
  base.users = raw.users && typeof raw.users === "object" ? raw.users : {};
  base.byDate = raw.byDate && typeof raw.byDate === "object" ? raw.byDate : {};
  base.usersByDate = raw.usersByDate && typeof raw.usersByDate === "object" ? raw.usersByDate : {};
  for (const [userId, stats] of Object.entries(base.users)) {
    base.users[userId] = normalizeStats(stats);
  }
  for (const [dateKey, stats] of Object.entries(base.byDate)) {
    base.byDate[dateKey] = normalizeStats(stats);
  }
  for (const [userId, byDate] of Object.entries(base.usersByDate)) {
    if (!byDate || typeof byDate !== "object") {
      base.usersByDate[userId] = {};
      continue;
    }
    const normalizedByDate = {};
    for (const [dateKey, stats] of Object.entries(byDate)) {
      normalizedByDate[dateKey] = normalizeStats(stats);
    }
    base.usersByDate[userId] = normalizedByDate;
  }
  return base;
}

function getUserStats(userId) {
  if (!userId) return createEmptyStats();
  const globalStats = getGlobalStats();
  return globalStats.users?.[userId] ? normalizeStats(globalStats.users[userId]) : createEmptyStats();
}

function mergeStats(target, source) {
  if (!source) return target;
  const srcTotals = source.totals || {};
  target.totals.rolls += Number(srcTotals.rolls) || 0;
  target.totals.dice += Number(srcTotals.dice) || 0;

  for (const [dieKey, dieStats] of Object.entries(source.dice || {})) {
    const merged = ensureDie(target.dice, dieKey);
    mergeDieStats(merged, dieStats);
  }

  for (const [actionType, actionStats] of Object.entries(source.actions || {})) {
    const mergedAction = ensureAction(target, actionType);
    mergedAction.rolls += Number(actionStats.rolls) || 0;
    mergedAction.count += Number(actionStats.count) || 0;
    for (const [dieKey, dieStats] of Object.entries(actionStats.dice || {})) {
      const mergedDie = ensureDie(mergedAction.dice, dieKey);
      mergeDieStats(mergedDie, dieStats);
    }
    for (const [detailKey, detailStats] of Object.entries(actionStats.details || {})) {
      const mergedDetail = ensureDetail(mergedAction, detailKey);
      mergedDetail.rolls += Number(detailStats.rolls) || 0;
      mergedDetail.count += Number(detailStats.count) || 0;
      for (const [dieKey, dieStats] of Object.entries(detailStats.dice || {})) {
        const mergedDie = ensureDie(mergedDetail.dice, dieKey);
        mergeDieStats(mergedDie, dieStats);
      }
    }
  }

  return target;
}

function mergeDieStats(target, source) {
  if (!source || typeof source !== "object") return target;
  target.count += Number(source.count) || 0;
  target.sum += Number(source.sum) || 0;
  const srcMin = Number.isFinite(source.min) ? source.min : null;
  const srcMax = Number.isFinite(source.max) ? source.max : null;
  if (srcMin !== null) target.min = target.min === null ? srcMin : Math.min(target.min, srcMin);
  if (srcMax !== null) target.max = target.max === null ? srcMax : Math.max(target.max, srcMax);
  if (source.results && typeof source.results === "object") {
    for (const [face, count] of Object.entries(source.results)) {
      const value = Number(count) || 0;
      target.results[face] = (target.results[face] || 0) + value;
    }
  }
  return target;
}

function ensureAction(stats, actionType) {
  if (!stats.actions[actionType]) {
    stats.actions[actionType] = {
      rolls: 0,
      count: 0,
      dice: {},
      details: {}
    };
  }
  return stats.actions[actionType];
}

function ensureDetail(actionStats, detailKey) {
  if (!actionStats.details[detailKey]) {
    actionStats.details[detailKey] = {
      rolls: 0,
      count: 0,
      dice: {}
    };
  } else if (!actionStats.details[detailKey].dice) {
    actionStats.details[detailKey].dice = {};
  }
  return actionStats.details[detailKey];
}

function ensureDie(container, dieKey) {
  if (!container[dieKey]) {
    container[dieKey] = {
      count: 0,
      sum: 0,
      min: null,
      max: null,
      results: {}
    };
  }
  return container[dieKey];
}

function recordRoll(stats, actionType, roll) {
  if (!stats || !roll) return;
  const actionStats = ensureAction(stats, actionType);

  const diceTerms = Array.isArray(roll.dice) ? roll.dice : [];
  let recorded = false;
  for (const die of diceTerms) {
    const faces = Number(die.faces);
    if (!Number.isFinite(faces) || faces <= 0) continue;
    const dieKey = `d${faces}`;
    const dieStats = ensureDie(stats.dice, dieKey);
    const actionDieStats = ensureDie(actionStats.dice, dieKey);

    const results = Array.isArray(die.results) ? die.results : [];
    for (const result of results) {
      if (result && result.active === false) continue;
      const value = Number(result?.result);
      if (!Number.isFinite(value)) continue;
      recorded = true;
      stats.totals.dice += 1;
      actionStats.count += 1;
      applyDieResult(dieStats, value);
      applyDieResult(actionDieStats, value);
    }
  }

  if (recorded) {
    stats.totals.rolls += 1;
    actionStats.rolls += 1;
  }
}

function recordResultCounts(stats, actionType, resultCounts, rollCount = 1, detailKey = null) {
  if (!stats || !resultCounts) return;
  if (rollCount > 0) {
    stats.totals.rolls += rollCount;
  }
  const actionStats = ensureAction(stats, actionType);
  actionStats.rolls += rollCount;
  if (detailKey) {
    const detail = ensureDetail(actionStats, detailKey);
    detail.rolls += rollCount;
  }

  for (const [dieKey, faces] of Object.entries(resultCounts)) {
    const dieStats = ensureDie(stats.dice, dieKey);
    const actionDieStats = ensureDie(actionStats.dice, dieKey);
    for (const [face, countRaw] of Object.entries(faces)) {
      const count = Number(countRaw) || 0;
      const value = Number(face);
      if (!Number.isFinite(value) || count <= 0) continue;
      stats.totals.dice += count;
      actionStats.count += count;
      if (detailKey) {
        const detail = ensureDetail(actionStats, detailKey);
        if (detail) detail.count += count;
        const detailDieStats = ensureDie(detail.dice, dieKey);
        applyDieResultCount(detailDieStats, value, count);
      }
      applyDieResultCount(dieStats, value, count);
      applyDieResultCount(actionDieStats, value, count);
    }
  }
}

function getDieFacesFromKey(dieKey) {
  const faces = Number(String(dieKey).replace(/\D/g, ""));
  return Number.isFinite(faces) && faces > 0 ? faces : null;
}

function getStreakFilterKey(actionType, detailKey) {
  const action = actionType || "all";
  const detail = detailKey || "all";
  return `${action}|${detail}`;
}

function ensureStreakEntry(stats, actionType, detailKey, dieKey) {
  stats.streaks ??= {};
  const key = getStreakFilterKey(actionType, detailKey);
  const bucket = stats.streaks[key] ??= {};
  const entry = bucket[dieKey] ??= {
    currentMin: 0,
    currentMax: 0,
    longestMin: 0,
    longestMax: 0
  };
  return entry;
}

function applyStreakValue(entry, value, faces) {
  if (value === 1) {
    entry.currentMin += 1;
    if (entry.currentMin > entry.longestMin) entry.longestMin = entry.currentMin;
  } else {
    entry.currentMin = 0;
  }
  if (value === faces) {
    entry.currentMax += 1;
    if (entry.currentMax > entry.longestMax) entry.longestMax = entry.currentMax;
  } else {
    entry.currentMax = 0;
  }
}

function applyStreaksForSequence(stats, actionType, sequenceByDie, detailKey) {
  if (!stats || !sequenceByDie) return;
  const filters = [
    { action: "all", detail: "all" },
    { action: actionType, detail: "all" }
  ];
  if (detailKey) filters.push({ action: actionType, detail: detailKey });

  for (const [dieKey, values] of Object.entries(sequenceByDie)) {
    const faces = getDieFacesFromKey(dieKey);
    if (!faces || !Array.isArray(values) || values.length === 0) continue;
    for (const raw of values) {
      const value = Number(raw);
      if (!Number.isFinite(value)) continue;
      for (const filter of filters) {
        const entry = ensureStreakEntry(stats, filter.action, filter.detail, dieKey);
        applyStreakValue(entry, value, faces);
      }
    }
  }
}

function applyDieResult(dieStats, value) {
  dieStats.count += 1;
  dieStats.sum += value;
  dieStats.min = dieStats.min === null ? value : Math.min(dieStats.min, value);
  dieStats.max = dieStats.max === null ? value : Math.max(dieStats.max, value);
  const key = String(value);
  dieStats.results[key] = (dieStats.results[key] || 0) + 1;
}

function applyDieResultCount(dieStats, value, count) {
  dieStats.count += count;
  dieStats.sum += value * count;
  dieStats.min = dieStats.min === null ? value : Math.min(dieStats.min, value);
  dieStats.max = dieStats.max === null ? value : Math.max(dieStats.max, value);
  const key = String(value);
  dieStats.results[key] = (dieStats.results[key] || 0) + count;
}

function getRollsFromMessage(message) {
  if (!message) return [];
  if (Array.isArray(message.rolls) && message.rolls.length) return message.rolls;
  if (message.rolls?.length) return Array.from(message.rolls);
  if (Array.isArray(message.rolls?.contents) && message.rolls.contents.length) return message.rolls.contents;
  if (message.roll) return [message.roll];
  return [];
}

function safeLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function normalizeActionType(raw) {
  if (!raw) return "other";
  const value = safeLower(String(raw));
  if (ITEM_ACTION_TYPE_MAP[value]) return ITEM_ACTION_TYPE_MAP[value];
  if (value.includes("attack") || value.includes("atk")) return "attack";
  if (value.includes("damage") || value.includes("dmg")) return "damage";
  if (value.includes("save") || value.includes("saving") || value.includes("saving-throw")) return "save";
  if (value.includes("skill") || value.includes("skill-check")) return "skill";
  if (value.includes("perception")) return "skill";
  if (value.includes("ability") || value.includes("check")) return "check";
  if (value.includes("initiative") || value === "init") return "initiative";
  if (value.includes("death")) return "deathsave";
  if (value.includes("tool")) return "tool";
  if (value.includes("heal")) return "heal";
  if (value.includes("spell")) return "spell";
  return "other";
}

function extractActionType(message, roll, workflowMeta) {
  const candidates = [];
  const rollOptions = roll?.options || {};
  if (rollOptions.type) candidates.push(rollOptions.type);
  if (rollOptions.rollType) candidates.push(rollOptions.rollType);

  const midiFlags = message?.flags?.["midi-qol"];
  if (midiFlags?.rollType) candidates.push(midiFlags.rollType);
  if (midiFlags?.type) candidates.push(midiFlags.type);
  if (midiFlags?.workflowType) candidates.push(midiFlags.workflowType);

  const pf2eFlags = message?.flags?.pf2e;
  if (pf2eFlags?.context?.type) candidates.push(pf2eFlags.context.type);
  if (pf2eFlags?.context?.domains) candidates.push(...pf2eFlags.context.domains);

  const dndFlags = message?.flags?.dnd5e;
  if (dndFlags?.roll?.type) candidates.push(dndFlags.roll.type);
  if (dndFlags?.roll?.rollType) candidates.push(dndFlags.roll.rollType);
  if (dndFlags?.rollType) candidates.push(dndFlags.rollType);
  if (dndFlags?.context?.type) candidates.push(dndFlags.context.type);

  if (workflowMeta?.actionType) candidates.push(workflowMeta.actionType);
  if (message?.flavor) candidates.push(message.flavor);

  for (const candidate of candidates) {
    const normalized = normalizeActionType(candidate);
    if (normalized !== "other") return normalized;
  }

  return "other";
}

function shouldTrackMessage(message, userId) {
  if (!game.settings.get(MODULE_ID, "enabled")) return false;
  //if (!["dnd5e", "pf2e"].includes(game.system?.id)) return false;
  if (!message) return false;
  const originUserId = resolveUserIdFromMessage(message, userId);
  if (originUserId && originUserId !== game.user?.id) return false;
  if (!originUserId && !game.user?.isGM) return false;
  const rolls = getRollsFromMessage(message);
  return rolls.length > 0;
}

async function saveLocalStats() {
  if (!game.user?.isGM || !state.globalStats) return;
  state.globalStats.updatedAt = Date.now();
  await game.settings.set(MODULE_ID, "globalStats", state.globalStats);
  game.socket.emit(`module.${MODULE_ID}`, { type: "statsUpdated" });
}

function getGlobalStats() {
  if (state.globalStats) return state.globalStats;
  const stored = game.settings.get(MODULE_ID, "globalStats");
  state.globalStats = normalizeGlobalStats(stored);
  return state.globalStats;
}

function markGlobalStatsDirty() {
  state.globalStats = null;
}

function scheduleSave() {
  if (!state.saveDebounced) {
    state.saveDebounced = debounce(saveLocalStats, 4000);
  }
  state.saveDebounced();
}

function scheduleSnapshotBroadcast() {
  if (!state.snapshotDebounced) {
    state.snapshotDebounced = debounce(() => {
      if (!game.user?.isGM || !state.globalStats) return;
      game.socket.emit(`module.${MODULE_ID}`, {
        type: "statsSnapshot",
        data: state.globalStats,
        senderId: game.user?.id
      });
    }, 250);
  }
  state.snapshotDebounced();
}

function scheduleRefresh() {
  if (!state.refreshDebounced) {
    state.refreshDebounced = debounce(() => refreshOpenDashboards(), 50);
  }
  state.refreshDebounced();
}

async function ensureChartJs() {
  if (globalThis.Chart) return;
  if (!state.chartPromise) {
    state.chartPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHART_JS_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load Chart.js"));
      document.head.appendChild(script);
    });
  }
  return state.chartPromise;
}

async function ensureFlatted() {
  if (globalThis.Flatted) return globalThis.Flatted;
  if (!state.flattedPromise) {
    state.flattedPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = FLATTED_SRC;
      script.async = true;
      script.onload = () => resolve(globalThis.Flatted);
      script.onerror = () => reject(new Error("Failed to load flatted."));
      document.head.appendChild(script);
    });
  }
  return state.flattedPromise;
}

function safeStringify(value, maxLength = 200000) {
  const seen = new WeakSet();
  const serialized = JSON.stringify(value, (key, val) => {
    if (typeof val === "function") return `[Function ${val.name || "anonymous"}]`;
    if (val instanceof Map) return { __type: "Map", value: Array.from(val.entries()) };
    if (val instanceof Set) return { __type: "Set", value: Array.from(val.values()) };
    if (val && typeof val === "object") {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    return val;
  });
  if (!serialized) return "";
  return serialized.length > maxLength ? `${serialized.slice(0, maxLength)}...<truncated>` : serialized;
}

function markMessageProcessed(messageId) {
  if (!messageId) return;
  state.processedMessages.add(messageId);
  state.workflowMeta.delete(messageId);
  setTimeout(() => state.processedMessages.delete(messageId), 60000);
}

function collectWorkflowRolls(workflow) {
  const rolls = [];
  if (!workflow) return rolls;
  const candidates = [
    workflow.attackRoll,
    workflow.damageRoll,
    workflow.damageRolls,
    workflow.saveRoll,
    workflow.checkRoll,
    workflow.abilityRoll,
    workflow.skillRoll,
    workflow.roll
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const roll of candidate) {
        if (roll?.dice) rolls.push(roll);
      }
      continue;
    }
    if (candidate?.dice) rolls.push(candidate);
  }

  return rolls;
}

function resolveUserIdFromActor(actor) {
  if (!actor) return null;
  if (actor.hasPlayerOwner === false) {
    const gm = getPrimaryGmUserId();
    if (gm) return gm;
  }
  const owners = game.users.contents.filter((user) => actor.testUserPermission(user, "OWNER"));
  const activePlayer = owners.find((user) => user.active && !user.isGM);
  if (activePlayer) return activePlayer.id;
  const anyPlayer = owners.find((user) => !user.isGM);
  if (anyPlayer) return anyPlayer.id;
  const gmOwner = owners.find((user) => user.isGM);
  if (gmOwner) return gmOwner.id;
  return getPrimaryGmUserId();
}

function resolveUserIdFromMessage(message, fallbackUserId) {
  if (!message) return fallbackUserId || null;
  const direct = message.user?.id || fallbackUserId;
  if (direct) return direct;
  const speakerActorId = message.speaker?.actor;
  if (speakerActorId) {
    const actor = game.actors.get(speakerActorId);
    if (actor?.hasPlayerOwner === false) {
      return getPrimaryGmUserId();
    }
    const owner = resolveUserIdFromActor(actor);
    if (owner) return owner;
  }
  return null;
}

function getPrimaryGmUserId() {
  const activeGm = game.users.contents.find((user) => user.isGM && user.active);
  if (activeGm) return activeGm.id;
  const gm = game.users.contents.find((user) => user.isGM);
  return gm?.id || null;
}

async function resolveUserIdFromWorkflow(workflow) {
  if (!workflow) return null;
  const actor = workflow.actor ?? workflow.token?.actor ?? workflow.damageItem?.actor;
  if (actor?.hasPlayerOwner === false) {
    const gm = getPrimaryGmUserId();
    if (gm) return gm;
  }
  const actorOwner = resolveUserIdFromActor(actor);
  if (actorOwner) return actorOwner;

  const speaker = workflow.speaker;
  const speakerActorId = speaker?.actor;
  if (speakerActorId) {
    const speakerActor = game.actors.get(speakerActorId);
    const speakerOwner = resolveUserIdFromActor(speakerActor);
    if (speakerOwner) return speakerOwner;
  }

  const chatId = workflow.chatMessageId || workflow.messageId;
  if (chatId) {
    const msg = game.messages.get(chatId);
    if (msg?.user?.id) return msg.user.id;
  }

  if (workflow.itemCardUuid && globalThis.fromUuid) {
    try {
      const doc = await fromUuid(workflow.itemCardUuid);
      if (doc?.user?.id) return doc.user.id;
    } catch {
      // ignore
    }
  }

  return null;
}

function handleRollPayloadsLocally(payloads) {
  if (!payloads?.length) return;
  const globalStats = getGlobalStats();
  const dateKey = getDateKey();
  for (const payload of payloads) {
    if (!payload?.results || !payload?.actionType || !payload?.userId) continue;
    const userStats = globalStats.users[payload.userId] ??= createEmptyStats();
    recordResultCounts(userStats, payload.actionType, payload.results, payload.rolls || 1, payload.detailKey);
    recordResultCounts(globalStats, payload.actionType, payload.results, payload.rolls || 1, payload.detailKey);

    const dateStats = globalStats.byDate[dateKey] ??= createEmptyStats();
    recordResultCounts(dateStats, payload.actionType, payload.results, payload.rolls || 1, payload.detailKey);

    const userByDate = globalStats.usersByDate[payload.userId] ??= {};
    const userDateStats = userByDate[dateKey] ??= createEmptyStats();
    recordResultCounts(userDateStats, payload.actionType, payload.results, payload.rolls || 1, payload.detailKey);

    if (payload.sequence && Object.keys(payload.sequence).length) {
      applyStreaksForSequence(userStats, payload.actionType, payload.sequence, payload.detailKey);
      applyStreaksForSequence(globalStats, payload.actionType, payload.sequence, payload.detailKey);
      applyStreaksForSequence(dateStats, payload.actionType, payload.sequence, payload.detailKey);
      applyStreaksForSequence(userDateStats, payload.actionType, payload.sequence, payload.detailKey);
    }
  }
  scheduleSnapshotBroadcast();
  scheduleRefresh();
  scheduleSave();
}

function getAggregateStats() {
  return getGlobalStats();
}

function getHiddenUserIds() {
  return new Set(game.settings.get(MODULE_ID, "hiddenPlayers") || []);
}

function getVisibleSessionDates(globalStats, hiddenSet) {
  if (!globalStats) return [];
  if (!hiddenSet || hiddenSet.size === 0) {
    return Object.keys(globalStats.byDate || {});
  }
  const dates = new Set();
  for (const [uid, byDate] of Object.entries(globalStats.usersByDate || {})) {
    if (hiddenSet.has(uid)) continue;
    for (const [dateKey, stats] of Object.entries(byDate || {})) {
      const totals = stats?.totals || {};
      if ((Number(totals.rolls) || 0) > 0 || (Number(totals.dice) || 0) > 0) {
        dates.add(dateKey);
      }
    }
  }
  return Array.from(dates);
}

async function resetUserStats(userId) {
  if (!game.user?.isGM) return;
  const stats = getGlobalStats();
  if (userId === "all") {
    state.globalStats = createGlobalStats();
  } else {
    stats.users[userId] = createEmptyStats();
    if (stats.usersByDate) stats.usersByDate[userId] = {};
  }
  recomputeGlobalStats();
  scheduleSave();
}

function recomputeGlobalStats() {
  const globalStats = getGlobalStats();
  const rebuilt = createGlobalStats();
  for (const [userId, userStats] of Object.entries(globalStats.users || {})) {
    rebuilt.users[userId] = normalizeStats(userStats);
    mergeStats(rebuilt, rebuilt.users[userId]);
  }
  for (const [userId, byDate] of Object.entries(globalStats.usersByDate || {})) {
    if (!byDate || typeof byDate !== "object") continue;
    rebuilt.usersByDate[userId] ??= {};
    for (const [dateKey, stats] of Object.entries(byDate)) {
      const normalized = normalizeStats(stats);
      rebuilt.usersByDate[userId][dateKey] = normalized;
      rebuilt.byDate[dateKey] ??= createEmptyStats();
      mergeStats(rebuilt.byDate[dateKey], normalized);
    }
  }
  rebuilt.updatedAt = globalStats.updatedAt;
  state.globalStats = rebuilt;
}

function buildResultCountsFromRoll(roll) {
  const results = {};
  const diceTerms = Array.isArray(roll?.dice) ? roll.dice : [];
  if (diceTerms.length) {
    collectResultsFromDiceTerms(diceTerms, results);
    return results;
  }
  const termDice = Array.isArray(roll?.terms)
    ? roll.terms.filter((term) => term?.class && term.class.includes("Die"))
    : [];
  collectResultsFromDiceTerms(termDice, results);
  return results;
}

function collectResultsFromDiceTerms(terms, results) {
  for (const die of terms) {
    const faces = Number(die.faces);
    if (!Number.isFinite(faces) || faces <= 0) continue;
    const dieKey = `d${faces}`;
    const dieResults = results[dieKey] ??= {};
    const termResults = Array.isArray(die.results) ? die.results : [];
    for (const result of termResults) {
      if (result && result.active === false) continue;
      const value = Number(result?.result);
      if (!Number.isFinite(value)) continue;
      const count = Number(result?.count) || 1;
      const key = String(value);
      dieResults[key] = (dieResults[key] || 0) + count;
    }
  }
}

function mergeResultCounts(target, source) {
  for (const [dieKey, faces] of Object.entries(source)) {
    const destFaces = target[dieKey] ??= {};
    for (const [face, count] of Object.entries(faces)) {
      destFaces[face] = (destFaces[face] || 0) + (Number(count) || 0);
    }
  }
}

function buildResultSequencesFromRoll(roll) {
  const sequences = {};
  const diceTerms = Array.isArray(roll?.dice) ? roll.dice : [];
  if (diceTerms.length) {
    collectSequencesFromDiceTerms(diceTerms, sequences);
    return sequences;
  }
  const termDice = Array.isArray(roll?.terms)
    ? roll.terms.filter((term) => term?.class && term.class.includes("Die"))
    : [];
  collectSequencesFromDiceTerms(termDice, sequences);
  return sequences;
}

function collectSequencesFromDiceTerms(terms, sequences) {
  for (const die of terms) {
    const faces = Number(die.faces);
    if (!Number.isFinite(faces) || faces <= 0) continue;
    const dieKey = `d${faces}`;
    const dieSeq = sequences[dieKey] ??= [];
    const termResults = Array.isArray(die.results) ? die.results : [];
    for (const result of termResults) {
      if (result && result.active === false) continue;
      const value = Number(result?.result);
      if (!Number.isFinite(value)) continue;
      const count = Number(result?.count) || 1;
      for (let i = 0; i < count; i += 1) {
        dieSeq.push(value);
      }
    }
  }
}

function mergeResultSequences(target, source) {
  for (const [dieKey, values] of Object.entries(source || {})) {
    if (!Array.isArray(values) || values.length === 0) continue;
    const dest = target[dieKey] ??= [];
    dest.push(...values);
  }
}

function shuffleArray(values) {
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function buildSequenceFromResults(results) {
  const sequences = {};
  for (const [dieKey, faces] of Object.entries(results || {})) {
    const values = [];
    for (const [face, countRaw] of Object.entries(faces || {})) {
      const value = Number(face);
      const count = Number(countRaw) || 0;
      if (!Number.isFinite(value) || count <= 0) continue;
      for (let i = 0; i < count; i += 1) values.push(value);
    }
    if (values.length) sequences[dieKey] = shuffleArray(values);
  }
  return sequences;
}

function buildPayloadFromRolls(rolls, actionType, userId) {
  const payload = {
    userId,
    actionType,
    rolls: 0,
    results: {},
    sequence: {}
  };
  for (const roll of rolls) {
    const results = buildResultCountsFromRoll(roll);
    const sequences = buildResultSequencesFromRoll(roll);
    if (Object.keys(results).length === 0 && Object.keys(sequences).length === 0) continue;
    payload.rolls += 1;
    mergeResultCounts(payload.results, results);
    mergeResultSequences(payload.sequence, sequences);
  }
  if (Object.keys(payload.sequence).length === 0) {
    delete payload.sequence;
  }
  return payload.rolls > 0 ? payload : null;
}

function resolveRollActionType(roll, fallbackAction) {
  const rollType = roll?.options?.rollType
    || roll?.options?.type
    || roll?.options?.["midi-qol"]?.rollType
    || roll?.options?.["midi-qol"]?.type;
  if (rollType) return normalizeActionType(rollType);
  const cls = roll?.class || "";
  if (cls.includes("DamageRoll")) return "damage";
  if (cls.includes("D20Roll")) return "attack";
  return normalizeActionType(fallbackAction);
}

function resolveRollDetailKey(roll, actionType, message, workflowMeta) {
  const rollOptions = roll?.options || {};
  const dndFlags = message?.flags?.dnd5e;
  const pf2eContext = message?.flags?.pf2e?.context;
  const pf2eDetail = getPf2eDetailFromContext(pf2eContext, actionType);
  const candidate =
    rollOptions.abilityId
    || rollOptions.ability
    || rollOptions.saveId
    || rollOptions.skillId
    || rollOptions.skill
    || dndFlags?.roll?.abilityId
    || dndFlags?.roll?.skillId
    || dndFlags?.roll?.saveId
    || workflowMeta?.abilityId
    || workflowMeta?.skillId
    || workflowMeta?.saveId
    || pf2eDetail
    || pf2eContext?.save?.type
    || pf2eContext?.skill
    || pf2eContext?.ability
    || pf2eContext?.statistic
    || pf2eContext?.statistic?.slug
    || pf2eContext?.dc?.statistic
    || pf2eContext?.dc?.slug
    || message?.flavor;

  if (!candidate) return null;
  const key = String(candidate);
  if (actionType === "save") return `save:${key}`;
  if (actionType === "skill") return `skill:${key}`;
  if (actionType === "check" || actionType === "ability") return `ability:${key}`;
  return null;
}

function getPf2eDetailFromContext(context, actionType) {
  if (!context) return null;
  const candidates = [];
  if (typeof context.title === "string") candidates.push(context.title);
  if (context.statistic?.slug) candidates.push(context.statistic.slug);
  if (context.skill) candidates.push(context.skill);
  if (context.ability) candidates.push(context.ability);
  if (context.save?.type) candidates.push(context.save.type);
  if (context.domains) candidates.push(...context.domains);
  if (context.dc?.statistic) candidates.push(context.dc.statistic);
  if (context.dc?.slug) candidates.push(context.dc.slug);

  const saveMatch = candidates.map((entry) => String(entry)).find((entry) => /fortitude|reflex|will/i.test(entry));
  if (saveMatch && actionType === "save") {
    return saveMatch.match(/fortitude|reflex|will/i)[0].toLowerCase();
  }

  const skillMatch = candidates.map((entry) => String(entry)).find((entry) => /skill:([a-z-]+)/i.test(entry));
  if (skillMatch && actionType === "skill") {
    return skillMatch.match(/skill:([a-z-]+)/i)[1].toLowerCase();
  }

  const statisticMatch = candidates.map((entry) => String(entry)).find((entry) => /check:statistic:([a-z-]+)/i.test(entry));
  if (statisticMatch && (actionType === "check" || actionType === "ability" || actionType === "skill")) {
    return statisticMatch.match(/check:statistic:([a-z-]+)/i)[1].toLowerCase();
  }

  if (actionType === "skill") {
    const domainMatch = candidates
      .map((entry) => String(entry))
      .find((entry) => /-check$/.test(entry) || /^[a-z-]+$/.test(entry));
    if (domainMatch) {
      const cleaned = domainMatch.replace(/-check$/i, "").toLowerCase();
      if (cleaned && cleaned !== "all" && cleaned !== "check" && cleaned !== "skill") return cleaned;
    }
  }

  if (context.title && typeof context.title === "string") {
    const lowered = context.title.toLowerCase();
    if (actionType === "save") {
      if (lowered.includes("fortitude")) return "fortitude";
      if (lowered.includes("reflex")) return "reflex";
      if (lowered.includes("will")) return "will";
    }
    if (actionType === "skill") {
      const match = lowered.match(/([a-z-]+)\s+check/);
      if (match?.[1]) return match[1];
    }
  }

  return null;
}

function buildPayloadsFromRolls(rolls, fallbackAction, userId, message, workflowMeta) {
  const grouped = new Map();
  for (const roll of rolls) {
    const actionType = resolveRollActionType(roll, fallbackAction);
    const detailKey = resolveRollDetailKey(roll, actionType, message, workflowMeta);
    const groupKey = `${actionType}:${detailKey || ""}`;
    if (!grouped.has(groupKey)) grouped.set(groupKey, { actionType, detailKey, rolls: [] });
    grouped.get(groupKey).rolls.push(roll);
  }
  const payloads = [];
  for (const group of grouped.values()) {
    const payload = buildPayloadFromRolls(group.rolls, group.actionType, userId);
    if (payload) payloads.push(payload);
    if (payload && group.detailKey) payload.detailKey = group.detailKey;
  }
  return payloads;
}

function getDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(list) {
  return list[randomInt(0, list.length - 1)];
}

function buildFakeSessionDates(count) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    dates.push(getDateKey(date));
  }
  return dates;
}

function buildResultCountsFromDiceSpecs(diceSpecs) {
  const results = {};
  for (const spec of diceSpecs) {
    const faces = Number(spec.faces);
    const count = Number(spec.count) || 1;
    if (!Number.isFinite(faces) || faces <= 0) continue;
    const dieKey = `d${faces}`;
    const dieResults = results[dieKey] ??= {};
    for (let i = 0; i < count; i += 1) {
      const value = randomInt(1, faces);
      const key = String(value);
      dieResults[key] = (dieResults[key] || 0) + 1;
    }
  }
  return results;
}

function sanitizeDamageDiceSpecs(diceSpecs) {
  const sanitized = (diceSpecs || [])
    .map((spec) => ({
      faces: Number(spec.faces),
      count: Number(spec.count) || 1
    }))
    .filter((spec) => Number.isFinite(spec.faces) && FAKE_DAMAGE_FACES.includes(spec.faces));

  return sanitized.length ? sanitized : [{ faces: 8, count: 1 }];
}

function buildFakeResultsForAction(actionType) {
  if (actionType === "damage") {
    return buildResultCountsFromDiceSpecs(sanitizeDamageDiceSpecs(pickRandom(FAKE_DAMAGE_DICE)));
  }
  if (actionType === "heal") {
    return buildResultCountsFromDiceSpecs(pickRandom(FAKE_HEAL_DICE));
  }
  if (actionType === "spell") {
    const useAttack = Math.random() < 0.4;
    const diceSpecs = useAttack
      ? [{ faces: 20, count: 1 }]
      : sanitizeDamageDiceSpecs(pickRandom(FAKE_DAMAGE_DICE));
    return buildResultCountsFromDiceSpecs(diceSpecs);
  }
  return buildResultCountsFromDiceSpecs([{ faces: 20, count: 1 }]);
}

function getNextFromList(list, state, key) {
  const idx = state[key] ?? 0;
  const value = list[idx % list.length];
  state[key] = idx + 1;
  return value;
}

function buildFakeDetailKey(actionType, state, useRandom) {
  if (actionType === "save") {
    const ability = useRandom ? pickRandom(FAKE_ABILITIES) : getNextFromList(FAKE_ABILITIES, state, "saveIndex");
    return `save:${ability}`;
  }
  if (actionType === "skill") {
    const skill = useRandom ? pickRandom(FAKE_SKILLS) : getNextFromList(FAKE_SKILLS, state, "skillIndex");
    return `skill:${skill}`;
  }
  if (actionType === "check" || actionType === "ability") {
    const ability = useRandom ? pickRandom(FAKE_ABILITIES) : getNextFromList(FAKE_ABILITIES, state, "abilityIndex");
    return `ability:${ability}`;
  }
  return null;
}

function allocateSkillsForSession(skillQueue, remainingSessions) {
  if (skillQueue.length === 0) return [];
  const skills = [skillQueue.shift()];
  if (skillQueue.length === 0) return skills;
  const sessionsLeftAfter = remainingSessions - 1;
  if (sessionsLeftAfter <= 0) {
    while (skillQueue.length) skills.push(skillQueue.shift());
    return skills;
  }
  const extraNeeded = Math.max(0, skillQueue.length - sessionsLeftAfter);
  for (let i = 0; i < extraNeeded; i += 1) {
    if (skillQueue.length === 0) break;
    skills.push(skillQueue.shift());
  }
  return skills;
}

function applyFakeStreaks(userStats, userDateStats, actionType, results, detailKey) {
  const sequence = buildSequenceFromResults(results);
  if (Object.keys(sequence).length === 0) return;
  applyStreaksForSequence(userStats, actionType, sequence, detailKey);
  applyStreaksForSequence(userDateStats, actionType, sequence, detailKey);
}

function generateFakeDataForUser(userId) {
  if (!userId) return null;
  const globalStats = getGlobalStats();
  const userStats = globalStats.users[userId] ??= createEmptyStats();
  const userByDate = globalStats.usersByDate[userId] ??= {};
  const detailState = { abilityIndex: 0, skillIndex: 0, saveIndex: 0 };
  const skillQueue = [...FAKE_SKILLS];
  const sessionDates = buildFakeSessionDates(FAKE_SESSION_COUNT);
  let totalRolls = 0;

  for (let idx = 0; idx < sessionDates.length; idx += 1) {
    const dateKey = sessionDates[idx];
    const userDateStats = userByDate[dateKey] ??= createEmptyStats();
    const remainingSessions = sessionDates.length - idx;
    const skillsThisSession = allocateSkillsForSession(skillQueue, remainingSessions);
    const extraSkills = Math.max(0, skillsThisSession.length - 1);
    const minRolls = FAKE_ACTION_TYPES.length + extraSkills;
    let targetRolls = randomInt(FAKE_ROLLS_MIN, FAKE_ROLLS_MAX);
    if (targetRolls < minRolls) targetRolls = minRolls;
    let sessionRolls = 0;
    let skillIndex = 0;

    for (const actionType of FAKE_ACTION_TYPES) {
      let detailKey = null;
      if (actionType === "skill") {
        const skill = skillsThisSession[skillIndex];
        if (skill) {
          detailKey = `skill:${skill}`;
          skillIndex += 1;
        } else {
          detailKey = buildFakeDetailKey("skill", detailState, false);
        }
      } else {
        detailKey = buildFakeDetailKey(actionType, detailState, false);
      }
      const results = buildFakeResultsForAction(actionType);
      recordResultCounts(userStats, actionType, results, 1, detailKey);
      recordResultCounts(userDateStats, actionType, results, 1, detailKey);
      applyFakeStreaks(userStats, userDateStats, actionType, results, detailKey);
      sessionRolls += 1;
    }

    while (skillIndex < skillsThisSession.length) {
      const skill = skillsThisSession[skillIndex];
      const detailKey = skill ? `skill:${skill}` : null;
      const results = buildFakeResultsForAction("skill");
      recordResultCounts(userStats, "skill", results, 1, detailKey);
      recordResultCounts(userDateStats, "skill", results, 1, detailKey);
      applyFakeStreaks(userStats, userDateStats, "skill", results, detailKey);
      sessionRolls += 1;
      skillIndex += 1;
    }

    while (sessionRolls < targetRolls) {
      const actionType = pickRandom(FAKE_ACTION_POOL);
      const detailKey = buildFakeDetailKey(actionType, detailState, true);
      const results = buildFakeResultsForAction(actionType);
      recordResultCounts(userStats, actionType, results, 1, detailKey);
      recordResultCounts(userDateStats, actionType, results, 1, detailKey);
      applyFakeStreaks(userStats, userDateStats, actionType, results, detailKey);
      sessionRolls += 1;
    }

    totalRolls += sessionRolls;
  }

  globalStats.updatedAt = Date.now();
  recomputeGlobalStats();
  scheduleSnapshotBroadcast();
  scheduleRefresh();
  scheduleSave();

  return { sessions: sessionDates.length, rolls: totalRolls };
}

class DiceStatsApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "indy-dice-stats",
    classes: ["indy-dice-stats"],
    window: {
      title: "Indy Dice Stats",
      icon: "fas fa-chart-column",
      resizable: true
    },
    position: {
      width: 980,
      height: 720
    }
  };

  static PARTS = {
    root: {
      template: `modules/${MODULE_ID}/templates/indy-dice-stats.hbs`,
      root: true
    }
  };

  constructor(options = {}) {
    super(options);
    this._charts = {};
    this._chartState = { distributionMode: "distribution" };
    this._heatmapObserver = null;
    this._windowObservers = null;
  }

  async _prepareContext() {
    const isGM = game.user?.isGM;
    const hidden = getHiddenUserIds();
    const users = game.users.contents
      .filter((user) => !hidden.has(user.id))
      .map((user) => ({
        id: user.id,
        name: user.name || user.id
      }));

    const combined = getStatsForSession(getGlobalStats(), "all", "all", hidden);
    const diceOptions = Object.keys(combined.dice || {}).sort(sortDiceKeys);
    const actionOptions = Object.keys(combined.actions || {})
      .sort(sortActionKeys)
      .map((key) => ({ key, label: ACTION_LABELS[key] || key }));

    if (!diceOptions.length) diceOptions.push("d20", "d6");

    return {
      isGM,
      users,
      diceOptions,
      actionOptions,
      defaultUserId: isGM ? "all" : game.user?.id,
      defaultAction: "all",
      defaultDie: diceOptions[0]
    };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    this._restoreWindowState();
    this._activateListeners();
    this._bindWindowPersistence();
    this._refreshCharts({ restoreFilters: true });
  }

  _activateListeners() {
    if (this._listenersBound) return;
    const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
    if (!scope) return;
    this._listenersBound = true;
    scope.addEventListener("change", (event) => {
      if (event.target?.matches?.("select[data-filter], input[data-filter='normalize'], input[data-filter='candles'], input[data-filter='streakType']")) {
        this._refreshCharts({ persistFilters: true });
      }
    });
    scope.addEventListener("click", (event) => {
      const title = event.target?.closest?.("[data-chart-title='distribution']");
      if (!title) return;
      const modes = ["distribution", "trend", "streaks"];
      const current = this._chartState.distributionMode || "distribution";
      const idx = modes.indexOf(current);
      this._chartState.distributionMode = modes[(idx + 1) % modes.length];
      this._refreshCharts({ persistFilters: true });
    });
  }

  _restoreWindowState() {
    const saved = getUiState()?.window;
    if (!saved || typeof this.setPosition !== "function") return;
    const position = {};
    if (Number.isFinite(saved.left)) position.left = saved.left;
    if (Number.isFinite(saved.top)) position.top = saved.top;
    if (Number.isFinite(saved.width)) position.width = saved.width;
    if (Number.isFinite(saved.height)) position.height = saved.height;
    if (Object.keys(position).length > 0) {
      this.setPosition(position);
    }
  }

  _bindWindowPersistence() {
    if (this._windowObservers) return;
    const windowEl = this.window?.element ?? this.element;
    if (!windowEl || typeof ResizeObserver === "undefined") return;

    const savePosition = () => {
      const pos = this.position || {};
      const windowState = {};
      if (Number.isFinite(pos.left)) windowState.left = Math.round(pos.left);
      if (Number.isFinite(pos.top)) windowState.top = Math.round(pos.top);
      if (Number.isFinite(pos.width)) windowState.width = Math.round(pos.width);
      if (Number.isFinite(pos.height)) windowState.height = Math.round(pos.height);
      if (Object.keys(windowState).length) {
        scheduleUiStateSave({ window: windowState });
      }
    };

    const resizeObserver = new ResizeObserver(() => savePosition());
    resizeObserver.observe(windowEl);

    const mutationObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "style")) {
        savePosition();
      }
    });
    mutationObserver.observe(windowEl, { attributes: true, attributeFilter: ["style"] });

    this._windowObservers = { resizeObserver, mutationObserver };
  }

  _getRootElement() {
    const content = this.window?.content ?? this.element;
    if (content) {
      return content.querySelector(".ids-root") ?? content;
    }
    return document.querySelector(`#${this.id} .ids-root`)
      ?? document.querySelector(`#${this.id}`);
  }

  async _refreshCharts(options = {}) {
    const forceThemeRefresh = !!options.forceThemeRefresh;
    const restoreFilters = !!options.restoreFilters;
    const persistFilters = !!options.persistFilters;
    let chartsReady = true;
    try {
      await ensureChartJs();
    } catch (err) {
      chartsReady = false;
      console.warn("Indy Dice Stats | Chart.js failed to load.", err);
    }
    const root = this._getRootElement();
    if (!root) return;

    const scope = root ?? this.window?.content ?? this.element ?? document.getElementById(this.id);
    if (!scope) return;
    const userSelect = scope.querySelector("select[data-filter='user']");
    const actionSelect = scope.querySelector("select[data-filter='action']");
    const detailSelect = scope.querySelector("select[data-filter='detail']");
    const dieSelect = scope.querySelector("select[data-filter='die']");
    const sessionSelect = scope.querySelector("select[data-filter='session']");
    const compareSelect = scope.querySelector("select[data-filter='compare']");
    const normalizeToggle = scope.querySelector("input[data-filter='normalize']");
    const candlesToggle = scope.querySelector("input[data-filter='candles']");
    const streakTypeToggle = scope.querySelector("input[data-filter='streakType']");
    const savedState = restoreFilters ? getUiState() : null;
    if (savedState?.distributionMode) {
      this._chartState.distributionMode = savedState.distributionMode;
    }
    if (normalizeToggle && typeof savedState?.normalize === "boolean") {
      normalizeToggle.checked = savedState.normalize;
    }
    if (candlesToggle && typeof savedState?.showCandles === "boolean") {
      candlesToggle.checked = savedState.showCandles;
    }
    if (streakTypeToggle && savedState?.streakType) {
      streakTypeToggle.checked = savedState.streakType === "max";
    }

    let userId = savedState?.userId || userSelect?.value || (game.user?.isGM ? "all" : game.user?.id);
    if (userId !== "all" && userId && !game.users.get(userId)) {
      userId = game.user?.isGM ? "all" : game.user?.id;
    }
    let actionFilter = savedState?.actionFilter || actionSelect?.value || "all";
    let detailFilter = savedState?.detailFilter || detailSelect?.value || "all";
    let dieFilter = savedState?.dieFilter || dieSelect?.value || "d20";
    let sessionFilter = savedState?.sessionFilter || sessionSelect?.value || "all";
    let compareIds = savedState?.compareIds || getMultiSelectValues(compareSelect);
    if (!Array.isArray(compareIds)) compareIds = [];
    compareIds = compareIds.filter((id) => id && game.users.get(id));
    if (userId !== "all") compareIds = compareIds.filter((id) => id !== userId);
    const compareMode = userId !== "all" && compareIds.length > 0;
    const normalize = !!normalizeToggle?.checked;
    const showCandles = !!candlesToggle?.checked;
    const streakType = streakTypeToggle?.checked ? "max" : "min";
    const streakLabel = scope.querySelector("[data-toggle='streaks'] .ids-toggle__label");
    if (streakLabel) streakLabel.textContent = streakType === "max" ? "Max Streak" : "Min Streak";

    const globalStats = getGlobalStats();
    const baseStats = getStatsForSession(globalStats, userId, sessionFilter, getHiddenUserIds());
    let scopedStats = actionFilter === "all" ? baseStats : buildScopedStats(baseStats, actionFilter);

    this._syncFilterOptions(scope, globalStats, baseStats, scopedStats, actionFilter, dieFilter, savedState);
    actionFilter = actionSelect?.value || actionFilter;
    detailFilter = detailSelect?.value || detailFilter;
    dieFilter = dieSelect?.value || dieFilter;
    sessionFilter = sessionSelect?.value || sessionFilter;
    compareIds = getMultiSelectValues(compareSelect);
    const compareStats = compareMode
      ? buildCompareStats(globalStats, [userId, ...compareIds], sessionFilter, actionFilter, detailFilter)
      : null;
    const filteredBaseStats = compareMode ? compareStats.merged : baseStats;
    scopedStats = actionFilter === "all" ? filteredBaseStats : buildScopedStats(filteredBaseStats, actionFilter);
    scopedStats = applyDetailFilter(scopedStats, actionFilter, detailFilter);

    const mode = this._chartState.distributionMode || "distribution";
    const showTrend = mode === "trend";
    const showStreaks = mode === "streaks";
    const distributionCanvas = root.querySelector("canvas[data-chart='distribution']");
    const streakContainer = root.querySelector("[data-chart='streaks']");
    if (distributionCanvas) distributionCanvas.hidden = showStreaks;
    if (streakContainer) streakContainer.hidden = !showStreaks;

    const hidden = getHiddenUserIds();
    const compareUserIds = compareMode ? [userId, ...compareIds] : null;
    const visibleUserIds = game.users.contents
      .filter((user) => !hidden.has(user.id))
      .map((user) => user.id);
    const streakUserIds = compareUserIds
      ? compareUserIds
      : (userId === "all" ? visibleUserIds : [userId]);
    const streakSource = buildStreakSource(globalStats, streakUserIds, sessionFilter);

    this._renderSummary(root, scopedStats, dieFilter);
    this._renderTable(root, scopedStats, actionFilter, detailFilter, streakSource);
    this._renderComparisonTable(scope, compareStats, dieFilter);
    this._renderDistributionHeader(scope, dieFilter, normalize, mode);
    if (showStreaks) {
      this._renderStreakHeatmap(
        root,
        globalStats,
        userId,
        compareIds,
        actionFilter,
        detailFilter,
        dieFilter,
        streakType
      );
    }
    if (chartsReady) {
      if (forceThemeRefresh) {
        this._chartState.breakdownKey = null;
      }
      if (showTrend) {
        this._renderTrendChart(
          root,
          globalStats,
          userId,
          compareIds,
          actionFilter,
          detailFilter,
          dieFilter,
          showCandles
        );
      } else if (!showStreaks) {
        this._renderDistributionChart(root, scopedStats, dieFilter, compareStats, normalize);
      }
      this._renderBreakdownChart(root, filteredBaseStats, actionFilter, dieFilter, detailFilter);
    }

    if (persistFilters) {
      scheduleUiStateSave({
        userId,
        actionFilter,
        detailFilter,
        dieFilter,
        sessionFilter,
        compareIds,
        normalize,
        showCandles,
        streakType,
        distributionMode: this._chartState.distributionMode
      });
    }
  }

  _syncFilterOptions(scope, globalStats, baseStats, scopedStats, actionFilter, dieFilter, uiState = null) {
    const actionSelect = scope.querySelector("select[data-filter='action']");
    if (actionSelect) {
      const preferred = uiState?.actionFilter ?? actionSelect.value;
      const selected = preferred || "all";
      const options = Object.keys(baseStats.actions || {})
        .sort(sortActionKeys)
        .map((key) => ({ value: key, label: ACTION_LABELS[key] || key }));
      this._replaceSelectOptions(actionSelect, [
        { value: "all", label: "All Actions" },
        ...options
      ], selected);
    }

    const detailSelect = scope.querySelector("select[data-filter='detail']");
    if (detailSelect) {
      const preferred = uiState?.detailFilter ?? detailSelect.value;
      const selected = preferred || "all";
      const detailOptions = buildDetailOptions(actionFilter, scopedStats);
      const disabled = detailOptions.length === 0;
      detailSelect.disabled = disabled;
      const options = [
        { value: "all", label: "All" },
        ...detailOptions
      ];
      this._replaceSelectOptions(detailSelect, options, selected);
    }

    const dieSelect = scope.querySelector("select[data-filter='die']");
    if (dieSelect) {
      const preferred = uiState?.dieFilter ?? dieFilter ?? dieSelect.value;
      const selected = preferred;
      const diceSource = actionFilter === "all" ? baseStats : scopedStats;
      const diceOptions = Object.keys(diceSource?.dice || {})
        .sort(sortDiceKeys)
        .map((key) => ({ value: key, label: key }));
      const fallback = diceOptions[0]?.value || "d20";
      const nextSelected = diceOptions.some((opt) => opt.value === selected) ? selected : fallback;
      this._replaceSelectOptions(dieSelect, diceOptions, nextSelected);
    }

    const sessionSelect = scope.querySelector("select[data-filter='session']");
    if (sessionSelect) {
      const preferred = uiState?.sessionFilter ?? sessionSelect.value;
      const selected = preferred || "all";
      const todayKey = getDateKey();
      const dates = getVisibleSessionDates(globalStats, getHiddenUserIds())
        .filter((key) => key !== todayKey)
        .sort()
        .reverse();
      const options = [
        { value: "all", label: "All Time" },
        { value: "today", label: "Today" },
        ...dates.map((dateKey) => ({ value: dateKey, label: dateKey }))
      ];
      const validSelected = options.some((opt) => opt.value === selected) ? selected : "all";
      this._replaceSelectOptions(sessionSelect, options, validSelected);
    }

    const hidden = getHiddenUserIds();
    const visibleUsers = game.users.contents
      .filter((user) => !hidden.has(user.id))
      .map((user) => ({ id: user.id, name: user.name || user.id }));

    const userSelect = scope.querySelector("select[data-filter='user']");
    if (userSelect) {
      const preferred = uiState?.userId ?? userSelect.value;
      const selected = preferred || (game.user?.isGM ? "all" : null);
      const options = [
        ...(game.user?.isGM ? [{ value: "all", label: "All Players" }] : []),
        ...visibleUsers.map((user) => ({ value: user.id, label: user.name }))
      ];
      const fallback = game.user?.isGM ? "all" : options[0]?.value;
      const nextSelected = options.some((opt) => opt.value === selected) ? selected : fallback;
      this._replaceSelectOptions(userSelect, options, nextSelected);
    }

    const compareSelect = scope.querySelector("select[data-filter='compare']");
    if (compareSelect) {
      const isAll = userSelect?.value === "all";
      compareSelect.disabled = !!isAll;
      if (isAll) {
        Array.from(compareSelect.options).forEach((option) => (option.selected = false));
      }
      const selected = uiState?.compareIds ?? getMultiSelectValues(compareSelect);
      const options = [
        { value: "", label: "None" },
        ...visibleUsers.map((user) => ({ value: user.id, label: user.name }))
      ];
      this._replaceMultiSelectOptions(compareSelect, options, selected);
    }
  }

  _replaceSelectOptions(select, options, selected) {
    const fragment = document.createDocumentFragment();
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      if (opt.value === selected) option.selected = true;
      fragment.appendChild(option);
    }
    select.replaceChildren(fragment);
  }

  _replaceMultiSelectOptions(select, options, selectedValues) {
    const fragment = document.createDocumentFragment();
    const selected = new Set(selectedValues || []);
    for (const opt of options) {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      if (selected.has(opt.value)) option.selected = true;
      fragment.appendChild(option);
    }
    select.replaceChildren(fragment);
  }

  _renderSummary(root, stats, dieKey) {
    const totalDice = stats.totals?.dice || 0;
    const dieStats = stats.dice?.[dieKey];
    const filteredDice = dieStats?.count || 0;
    const avg = dieStats && dieStats.count ? dieStats.sum / dieStats.count : 0;

    setText(root, "[data-stat-label='filtered-dice']", `Filtered Dice (${dieKey.toUpperCase()})`);
    setText(root, "[data-stat='total-dice']", formatNumber(totalDice));
    setText(root, "[data-stat='filtered-dice']", formatNumber(filteredDice));
    setText(root, "[data-stat='die-average']", avg ? avg.toFixed(2) : "-");

    const mostAction = getMostFrequentAction(stats.actions || {});
    setText(root, "[data-stat='top-action']", mostAction ? ACTION_LABELS[mostAction] || mostAction : "-");
  }

  _renderTable(root, stats, actionFilter, detailFilter, streakSource = null) {
    const tbody = root.querySelector("[data-table='die-summary']");
    if (!tbody) return;
    const rows = Object.entries(stats.dice || {})
      .sort(([a], [b]) => sortDiceKeys(a, b))
      .map(([dieKey, dieStats]) => {
        const avg = dieStats.count ? (dieStats.sum / dieStats.count).toFixed(2) : "-";
        const streakStats = streakSource || stats;
        const streakEntry = getStreakEntryForFilters(streakStats, actionFilter, detailFilter, dieKey);
        const minStreak = streakEntry?.longestMin ?? 0;
        const maxStreak = streakEntry?.longestMax ?? 0;
        return `<tr>
          <td>${dieKey.toUpperCase()}</td>
          <td>${formatNumber(dieStats.count)}</td>
          <td>${avg}</td>
          <td>${dieStats.min ?? "-"}</td>
          <td>${dieStats.max ?? "-"}</td>
          <td>${minStreak || "-"}</td>
          <td>${maxStreak || "-"}</td>
        </tr>`;
      });

    tbody.innerHTML = rows.length
      ? rows.join("")
      : "<tr><td colspan='7'>No rolls captured yet.</td></tr>";
  }

  _renderDistributionChart(root, stats, dieKey, compareStats, normalize) {
    const canvas = root.querySelector("canvas[data-chart='distribution']");
    if (!canvas) return;

    const faces = Number(String(dieKey).replace(/\D/g, ""));
    const labels = Number.isFinite(faces) && faces > 0 ? Array.from({ length: faces }, (_, i) => String(i + 1)) : [];

    const context = canvas.getContext("2d");
    if (!context) return;

    this._destroyChart("distribution");

    let datasets = [];
    let yMax = undefined;
    if (compareStats?.byUser) {
      const colors = buildPalette(Object.keys(compareStats.byUser).length);
      let idx = 0;
      for (const [userId, userStats] of Object.entries(compareStats.byUser)) {
        const dieStats = userStats.dice?.[dieKey];
        const counts = labels.map((label) => Number(dieStats?.results?.[label]) || 0);
        const total = counts.reduce((sum, value) => sum + value, 0);
        const data = normalize && total > 0
          ? counts.map((value) => Number(((value / total) * 100).toFixed(2)))
          : counts;
        if (normalize) {
          for (const value of data) {
            if (Number.isFinite(value)) {
              yMax = yMax === undefined ? value : Math.max(yMax, value);
            }
          }
        }
        datasets.push({
          label: compareStats.labels[userId] || userId,
          data,
          backgroundColor: colors[idx % colors.length],
          borderRadius: 6,
          borderSkipped: false
        });
        idx += 1;
      }
    } else {
      const dieStats = stats.dice?.[dieKey];
      const counts = labels.map((label) => Number(dieStats?.results?.[label]) || 0);
      const total = counts.reduce((sum, value) => sum + value, 0);
      const data = normalize && total > 0
        ? counts.map((value) => Number(((value / total) * 100).toFixed(2)))
        : counts;
      if (normalize) {
        for (const value of data) {
          if (Number.isFinite(value)) {
            yMax = yMax === undefined ? value : Math.max(yMax, value);
          }
        }
      }
      datasets = [
        {
          label: `${dieKey.toUpperCase()} Results`,
          data,
          backgroundColor: buildGradient(context, "#0f766e", "#f97316"),
          borderRadius: 8,
          borderSkipped: false
        }
      ];
    }

    const gridColor = getChartGridColor();
    const tickColor = getChartTickColor();
    const titleColor = getChartTitleColor();
    const titleSuffix = normalize ? " (Normalized)" : "";
    const maxCeil = normalize && Number.isFinite(yMax) ? Math.ceil(yMax) : undefined;

    this._charts.distribution = new Chart(context, {
      type: "bar",
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, ticks: { color: tickColor } },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              callback: normalize ? (value) => `${value}%` : undefined
            },
            max: maxCeil
          }
        },
        plugins: {
          legend: {
            display: !!compareStats,
            position: "bottom",
            labels: { color: tickColor }
          },
          title: {
            display: false,
            text: `Distribution: ${dieKey.toUpperCase()}${titleSuffix}`,
            color: titleColor,
            font: { size: 16, family: "Fraunces" }
          },
          tooltip: { enabled: true }
        }
      }
    });
  }

  _renderTrendChart(root, globalStats, userId, compareIds, actionFilter, detailFilter, dieKey, showCandles) {
    const canvas = root.querySelector("canvas[data-chart='distribution']");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    this._destroyChart("distribution");
    ensureChartPlugins();

    const hidden = getHiddenUserIds();
    const compareMode = userId !== "all" && compareIds.length > 0;
    const seriesIds = compareMode ? [userId, ...compareIds] : [userId];
    const series = [];
    const dateSet = new Set();

    for (const seriesId of seriesIds) {
      const byDate = getAllSessionStats(globalStats, seriesId, hidden);
      series.push({ userId: seriesId, byDate });
      for (const dateKey of Object.keys(byDate || {})) {
        dateSet.add(dateKey);
      }
    }

    const labels = Array.from(dateSet).sort();
    const palette = buildPalette(series.length);
    const datasets = series.map((entry, index) => {
      const color = palette[index % palette.length];
      const label = entry.userId === "all"
        ? "All Players"
        : (game.users.get(entry.userId)?.name || entry.userId);
      const data = [];
      const candles = [];
      for (const dateKey of labels) {
        const rawStats = entry.byDate?.[dateKey];
        if (!rawStats) {
          data.push(null);
          candles.push(null);
          continue;
        }
        const filtered = getFilteredStats(normalizeStats(rawStats), actionFilter, detailFilter);
        const summary = computeDieSummary(filtered.dice?.[dieKey]);
        if (!summary) {
          data.push(null);
          candles.push(null);
          continue;
        }
        data.push(summary.avg);
        candles.push(summary);
      }

      return {
        label,
        data,
        idsCandles: candles,
        borderColor: color,
        backgroundColor: color,
        tension: 0.25,
        pointRadius: 3,
        pointHoverRadius: 4,
        spanGaps: true
      };
    });

    const gridColor = getChartGridColor();
    const tickColor = getChartTickColor();
    const faces = Number(String(dieKey).replace(/\D/g, ""));
    const yMin = Number.isFinite(faces) && faces > 0 ? 1 : undefined;
    const yMax = Number.isFinite(faces) && faces > 0 ? faces : undefined;

    const showCandlesFlag = !!showCandles;

    this._charts.distribution = new Chart(context, {
      type: "line",
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              maxTicksLimit: 10
            },
            offset: true
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor },
            min: yMin,
            max: yMax
          }
        },
        layout: {
          padding: { right: 8 }
        },
        plugins: {
          legend: {
            display: compareMode,
            position: "bottom",
            labels: { color: tickColor }
          },
          title: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const candle = context.dataset?.idsCandles?.[context.dataIndex];
                if (!candle) return `${context.dataset.label || "Avg"}: -`;
                const avg = Number.isFinite(candle.avg) ? candle.avg.toFixed(2) : "-";
                const min = Number.isFinite(candle.min) ? candle.min : "-";
                const max = Number.isFinite(candle.max) ? candle.max : "-";
                if (!showCandlesFlag) {
                  return `${context.dataset.label || "Avg"}: avg ${avg}, min ${min}, max ${max}`;
                }
                const q1 = Number.isFinite(candle.q1) ? candle.q1 : "-";
                const q3 = Number.isFinite(candle.q3) ? candle.q3 : "-";
                return `${context.dataset.label || "Avg"}: avg ${avg}, min ${min}, max ${max}, q1 ${q1}, q3 ${q3}`;
              }
            }
          },
          idsCandlesticks: {
            enabled: !!showCandles,
            fillAlpha: 0.22,
            lineWidth: 2,
            overlapFactor: 1
          }
        }
      }
    });
  }

  _renderStreakHeatmap(root, globalStats, userId, compareIds, actionFilter, detailFilter, dieKey, streakType) {
    const container = root.querySelector("[data-chart='streaks']");
    if (!container) return;
    const hidden = getHiddenUserIds();
    const visibleUsers = game.users.contents
      .filter((user) => !hidden.has(user.id))
      .map((user) => user.id);
    const seriesIds = ["all", ...visibleUsers];
    const series = seriesIds.map((seriesId) => {
      const label = seriesId === "all"
        ? "All Players"
        : (game.users.get(seriesId)?.name || seriesId);
      return { id: seriesId, label, byDate: getAllSessionStats(globalStats, seriesId, hidden) };
    });

    const dateSet = new Set();
    for (const entry of series) {
      for (const dateKey of Object.keys(entry.byDate || {})) {
        dateSet.add(dateKey);
      }
    }
    const dates = Array.from(dateSet).sort();
    if (dates.length === 0) {
      container.innerHTML = "<div class=\"ids-heatmap__empty\">No streak data yet.</div>";
      return;
    }
    container.dataset.heatmapColumns = String(dates.length);

    const rows = [];
    let maxValue = 0;
    for (const entry of series) {
      const row = { label: entry.label, values: [] };
      for (const dateKey of dates) {
        const stats = entry.byDate?.[dateKey];
        const normalized = stats ? normalizeStats(stats) : null;
        const streakEntry = normalized
          ? getStreakEntryForFilters(normalized, actionFilter, detailFilter, dieKey)
          : null;
        const value = streakType === "max"
          ? (Number(streakEntry?.longestMax) || 0)
          : (Number(streakEntry?.longestMin) || 0);
        row.values.push(value);
        if (value > maxValue) maxValue = value;
      }
      rows.push(row);
    }

    const baseRgb = streakType === "max" ? "249, 115, 22" : "15, 118, 110";

    let html = "<div class=\"ids-heatmap__scroll\"><table><tbody>";

    let cellIndex = 0;
    for (const row of rows) {
      html += "<tr>";
      html += `<td class=\"ids-heatmap__row-label\">${row.label}</td>`;
      row.values.forEach((value, idx) => {
        const color = buildHeatmapColor(baseRgb, value, maxValue);
        const dateLabel = dates[idx];
        const title = `${row.label} ${streakType.toUpperCase()} streak on ${dateLabel}: ${value || 0}`;
        const delay = Math.min(260, cellIndex * 6);
        html += `<td class=\"ids-heatmap__cell ids-heatmap__cell--animate\" title=\"${title}\" style=\"background-color: ${color}; --ids-heatmap-delay: ${delay}ms;\"></td>`;
        cellIndex += 1;
      });
      html += "</tr>";
    }

    html += "</tbody></table></div>";
    container.innerHTML = html;

    updateHeatmapCellSize(container, dates.length);
    if (!this._heatmapObserver && typeof ResizeObserver !== "undefined") {
      this._heatmapObserver = new ResizeObserver(() => {
        const cols = Number(container.dataset.heatmapColumns) || dates.length;
        updateHeatmapCellSize(container, cols);
      });
      this._heatmapObserver.observe(container);
    }
  }

  _renderDistributionHeader(scope, dieKey, normalize, mode = "distribution") {
    const title = scope.querySelector("[data-chart-title='distribution']");
    if (!title) return;
    const normalizeToggle = scope.querySelector("[data-toggle='normalize']");
    const candlesToggle = scope.querySelector("[data-toggle='candles']");
    const streaksToggle = scope.querySelector("[data-toggle='streaks']");
    if (normalizeToggle) normalizeToggle.classList.toggle("is-hidden", mode !== "distribution");
    if (candlesToggle) candlesToggle.classList.toggle("is-hidden", mode !== "trend");
    if (streaksToggle) streaksToggle.classList.toggle("is-hidden", mode !== "streaks");
    if (mode === "trend") {
      title.textContent = `Trend ${dieKey.toUpperCase()}`;
    } else if (mode === "streaks") {
      title.textContent = `Streaks ${dieKey.toUpperCase()}`;
    } else {
      const suffix = normalize ? " (Normalized)" : "";
      title.textContent = `Distribution ${dieKey.toUpperCase()}${suffix}`;
    }
    title.setAttribute("title", "Click to toggle distribution, trend, and streaks view.");
  }

  _renderComparisonTable(scope, compareStats, dieKey) {
    const section = scope.querySelector("[data-compare]");
    if (!section) return;
    if (!compareStats) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    const tbody = section.querySelector("[data-table='compare-summary']");
    if (!tbody) return;
    const rows = Object.entries(compareStats.byUser).map(([userId, stats]) => {
      const dieStats = stats.dice?.[dieKey];
      const avg = dieStats && dieStats.count ? (dieStats.sum / dieStats.count).toFixed(2) : "-";
      return `<tr>
        <td>${compareStats.labels[userId] || userId}</td>
        <td>${formatNumber(stats.totals?.rolls || 0)}</td>
        <td>${formatNumber(stats.totals?.dice || 0)}</td>
        <td>${avg}</td>
      </tr>`;
    });
    tbody.innerHTML = rows.length
      ? rows.join("")
      : "<tr><td colspan='4'>Select two or more players to compare.</td></tr>";
  }

  _renderBreakdownChart(root, stats, actionFilter, dieFilter, detailFilter) {
    const canvas = root.querySelector("canvas[data-chart='breakdown']");
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let labels = [];
    let values = [];
    let title = "Action Breakdown";
    const hasDetailAction = ["save", "skill", "check", "ability"].includes(actionFilter);
    const scopedStats = actionFilter === "all" ? stats : buildScopedStats(stats, actionFilter);

    if (actionFilter === "all") {
      const actions = stats.actions || {};
      const sortedActions = Object.keys(actions).sort(sortActionKeys);
      const entries = sortedActions.map((key) => ({
        label: ACTION_LABELS[key] || key,
        value: Number(actions[key]?.dice?.[dieFilter]?.count) || 0
      }));
      const filtered = entries.filter((entry) => entry.value > 0);
      labels = filtered.map((entry) => entry.label);
      values = filtered.map((entry) => entry.value);
      title = `Action Breakdown (${dieFilter.toUpperCase()})`;
    } else if (hasDetailAction && detailFilter === "all") {
      const details = stats.actions?.[actionFilter]?.details || {};
      const detailKeys = Object.keys(details).sort();
      labels = detailKeys.map((key) => formatDetailLabel(key));
      values = detailKeys.map((key) => Number(details[key]?.count) || 0);
      title = `${ACTION_LABELS[actionFilter] || actionFilter} Types`;
    } else {
      const diceKeys = Object.keys(scopedStats.dice || {}).sort(sortDiceKeys);
      labels = diceKeys.map((key) => key.toUpperCase());
      values = diceKeys.map((key) => Number(scopedStats.dice[key]?.count) || 0);
      title = `Dice Mix: ${ACTION_LABELS[actionFilter] || actionFilter}`;
    }

    if (!hasDetailAction && labels.length <= 1 && detailFilter === "all") {
      const dieStats = scopedStats.dice?.[dieFilter];
      const faces = Number(String(dieFilter).replace(/\D/g, ""));
      if (Number.isFinite(faces) && faces > 0 && dieStats?.results) {
        labels = Array.from({ length: faces }, (_, i) => String(i + 1));
        values = labels.map((label) => Number(dieStats.results?.[label]) || 0);
        title = `Distribution ${dieFilter.toUpperCase()}`;
      }
    }

    const entries = labels.map((label, index) => ({
      label,
      value: Number(values[index]) || 0
    }));
    const nonZero = entries.filter((entry) => entry.value > 0);
    if (nonZero.length) {
      labels = nonZero.map((entry) => entry.label);
      values = nonZero.map((entry) => entry.value);
    }

    const dataKey = JSON.stringify({ labels, values, actionFilter, dieFilter, detailFilter });
    if (this._chartState.breakdownKey === dataKey && this._charts.breakdown) return;
    this._chartState.breakdownKey = dataKey;

    this._destroyChart("breakdown");

    const palette = buildPalette(values.length);

    const legendColor = getChartTickColor();
    const titleColor = getChartTitleColor();

    this._charts.breakdown = new Chart(context, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: palette,
            borderColor: "rgba(255,255,255,0.6)",
            borderWidth: 1.5,
            hoverOffset: 6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 14, color: legendColor }
          },
          title: {
            display: true,
            text: title,
            color: titleColor,
            font: { size: 16, family: "Fraunces" }
          }
        }
      }
    });
  }

  _destroyChart(key) {
    if (this._charts[key]) {
      this._charts[key].destroy();
      delete this._charts[key];
    }
  }
}

class DiceStatsResetApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "indy-dice-stats-reset",
    classes: ["indy-dice-stats-reset"],
    window: {
      title: "Reset Dice Stats",
      icon: "fas fa-rotate-left",
      resizable: false
    },
    position: {
      width: 420,
      height: "auto"
    }
  };

  static PARTS = {
    root: {
      template: `modules/${MODULE_ID}/templates/indy-dice-stats-reset.hbs`,
      root: true
    }
  };

  async _prepareContext() {
    const users = game.users.contents.map((user) => ({
      id: user.id,
      name: user.name || user.id
    }));
    return { users };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
    if (!scope) return;
    scope.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-action='reset-selected']");
      if (button) this._onReset(scope);
    });
  }

  async _onReset(scope) {
    if (!game.user?.isGM) return;
    const userId = scope.querySelector("[data-reset='user']")?.value || "all";
    const message = userId === "all"
      ? "This clears stats for every player. Continue?"
      : "This clears stored stats for the selected player. Continue?";
    const confirmed = await Dialog.confirm({
      title: "Reset Dice Stats",
      content: `<p>${message}</p>`
    });
    if (!confirmed) return;
    await resetUserStats(userId);
    this.close();
  }
}

class DiceStatsVisibilityApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "indy-dice-stats-visibility",
    classes: ["indy-dice-stats-reset", "indy-dice-stats-visibility"],
    window: {
      title: "Player Visibility",
      icon: "fas fa-user-slash",
      resizable: true
    },
    position: {
      width: 520,
      height: 520
    }
  };

  static PARTS = {
    root: {
      template: `modules/${MODULE_ID}/templates/indy-dice-stats-visibility.hbs`,
      root: true
    }
  };

  async _prepareContext() {
    const hidden = new Set(game.settings.get(MODULE_ID, "hiddenPlayers") || []);
    const users = game.users.contents.map((user) => ({
      id: user.id,
      name: user.name || user.id,
      hidden: hidden.has(user.id)
    }));
    return { users };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
    if (!scope) return;
    scope.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-action='save-visibility']");
      if (button) this._onSave(scope);
    });
  }

  async _onSave(scope) {
    if (!game.user?.isGM) return;
    const select = scope.querySelector("[data-visibility='users']");
    const selected = Array.from(select?.selectedOptions || []).map((opt) => opt.value).filter(Boolean);
    await game.settings.set(MODULE_ID, "hiddenPlayers", selected);
    refreshOpenDashboards();
    this.close();
  }
}

class DiceStatsFakerApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "indy-dice-stats-faker",
    classes: ["indy-dice-stats-reset", "indy-dice-stats-faker"],
    window: {
      title: "Generate Fake Data",
      icon: "fas fa-dice",
      resizable: false
    },
    position: {
      width: 460,
      height: "auto"
    }
  };

  static PARTS = {
    root: {
      template: `modules/${MODULE_ID}/templates/indy-dice-stats-faker.hbs`,
      root: true
    }
  };

  async _prepareContext() {
    const users = game.users.contents.map((user) => ({
      id: user.id,
      name: user.name || user.id
    }));
    return { users, defaultUserId: game.user?.id };
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
    if (!scope) return;
    scope.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-action='generate-fake-data']");
      if (button) this._onGenerate(scope);
    });
  }

  async _onGenerate(scope) {
    if (!game.user?.isGM) return;
    const userId = scope.querySelector("[data-fake='user']")?.value;
    if (!userId) return;
    const user = game.users.get(userId);
    const name = user?.name || userId;
    const confirmed = await Dialog.confirm({
      title: "Generate Fake Data",
      content: `<p>Add fake dice stats for <strong>${name}</strong> across ${FAKE_SESSION_COUNT} sessions (${FAKE_ROLLS_MIN}-${FAKE_ROLLS_MAX} rolls each). Existing stats are not cleared. Continue?</p>`
    });
    if (!confirmed) return;
    const result = generateFakeDataForUser(userId);
    if (result) {
      ui.notifications?.info?.(
        `Indy Dice Stats | Added ${result.rolls} fake rolls across ${result.sessions} sessions for ${name}.`
      );
    }
    this.close();
  }
}

function buildScopedStats(base, actionType) {
  const scoped = createEmptyStats();
  const actionStats = base.actions?.[actionType];
  if (!actionStats) return scoped;
  scoped.totals.rolls = Number(actionStats.rolls) || 0;
  scoped.totals.dice = Number(actionStats.count) || 0;
  scoped.actions[actionType] = actionStats;
  scoped.dice = actionStats.dice || {};
  return scoped;
}

function applyDetailFilter(stats, actionFilter, detailFilter) {
  if (!stats || !detailFilter || detailFilter === "all") return stats;
  if (!["save", "check", "ability", "skill"].includes(actionFilter)) return stats;
  const actionStats = stats.actions?.[actionFilter];
  if (!actionStats?.details) return createEmptyStats();
  const detail = actionStats.details[detailFilter];
  if (!detail) return createEmptyStats();
  const detailStats = createEmptyStats();
  detailStats.totals.rolls = Number(detail.rolls) || 0;
  detailStats.totals.dice = Number(detail.count) || 0;
  detailStats.actions[actionFilter] = {
    rolls: detailStats.totals.rolls,
    count: detailStats.totals.dice,
    dice: detail.dice || {},
    details: { [detailFilter]: detail }
  };
  detailStats.dice = detail.dice || {};
  return detailStats;
}

function getFilteredStats(stats, actionFilter, detailFilter) {
  if (!stats) return createEmptyStats();
  let scoped = actionFilter === "all" ? stats : buildScopedStats(stats, actionFilter);
  scoped = applyDetailFilter(scoped, actionFilter, detailFilter);
  return scoped;
}

function getStatsForSession(globalStats, userId, sessionFilter, hiddenSet = null) {
  if (!globalStats) return createEmptyStats();
  if (sessionFilter === "all") {
    if (userId !== "all") {
      return globalStats.users?.[userId] ? normalizeStats(globalStats.users[userId]) : createEmptyStats();
    }
    if (!hiddenSet || hiddenSet.size === 0) return globalStats;
    const merged = createEmptyStats();
    for (const [uid, stats] of Object.entries(globalStats.users || {})) {
      if (hiddenSet.has(uid)) continue;
      mergeStats(merged, normalizeStats(stats));
    }
    return merged;
  }
  const dateKey = sessionFilter === "today" ? getDateKey() : sessionFilter;
  if (userId === "all") {
    if (!hiddenSet || hiddenSet.size === 0) {
      return globalStats.byDate?.[dateKey] ? normalizeStats(globalStats.byDate[dateKey]) : createEmptyStats();
    }
    const merged = createEmptyStats();
    for (const [uid, byDate] of Object.entries(globalStats.usersByDate || {})) {
      if (hiddenSet.has(uid)) continue;
      const stats = byDate?.[dateKey];
      if (stats) mergeStats(merged, normalizeStats(stats));
    }
    return merged;
  }
  const userByDate = globalStats.usersByDate?.[userId];
  if (!userByDate) return createEmptyStats();
  return userByDate[dateKey] ? normalizeStats(userByDate[dateKey]) : createEmptyStats();
}

function getAllSessionStats(globalStats, userId, hiddenSet = null) {
  if (!globalStats) return {};
  if (userId === "all") {
    const mergedByDate = {};
    for (const [uid, byDate] of Object.entries(globalStats.usersByDate || {})) {
      if (hiddenSet && hiddenSet.has(uid)) continue;
      if (!byDate || typeof byDate !== "object") continue;
      for (const [dateKey, stats] of Object.entries(byDate)) {
        mergedByDate[dateKey] ??= createEmptyStats();
        mergeStats(mergedByDate[dateKey], normalizeStats(stats));
        mergeStreaksMax(mergedByDate[dateKey], normalizeStats(stats));
      }
    }
    return mergedByDate;
  }
  return globalStats.usersByDate?.[userId] || {};
}

function mergeStreaksMax(target, source) {
  const srcStreaks = source?.streaks;
  if (!srcStreaks || typeof srcStreaks !== "object") return;
  target.streaks ??= {};
  for (const [filterKey, dieMap] of Object.entries(srcStreaks)) {
    if (!dieMap || typeof dieMap !== "object") continue;
    const targetMap = target.streaks[filterKey] ??= {};
    for (const [dieKey, entry] of Object.entries(dieMap)) {
      if (!entry || typeof entry !== "object") continue;
      const targetEntry = targetMap[dieKey] ??= {
        currentMin: 0,
        currentMax: 0,
        longestMin: 0,
        longestMax: 0
      };
      const longestMin = Number(entry.longestMin) || 0;
      const longestMax = Number(entry.longestMax) || 0;
      if (longestMin > targetEntry.longestMin) targetEntry.longestMin = longestMin;
      if (longestMax > targetEntry.longestMax) targetEntry.longestMax = longestMax;
    }
  }
}

function buildStreakSource(globalStats, userIds, sessionFilter) {
  const merged = createEmptyStats();
  merged.streaks = {};
  if (!globalStats || !Array.isArray(userIds) || userIds.length === 0) return merged;
  const dateKey = sessionFilter === "all"
    ? null
    : (sessionFilter === "today" ? getDateKey() : sessionFilter);
  for (const userId of userIds) {
    if (!userId) continue;
    const stats = dateKey
      ? globalStats.usersByDate?.[userId]?.[dateKey]
      : globalStats.users?.[userId];
    if (!stats) continue;
    mergeStreaksMax(merged, normalizeStats(stats));
  }
  return merged;
}

function computeQuantileFromResults(results, quantile) {
  if (!results || typeof results !== "object") return null;
  const entries = Object.entries(results)
    .map(([face, count]) => ({ value: Number(face), count: Number(count) || 0 }))
    .filter((entry) => Number.isFinite(entry.value) && entry.count > 0)
    .sort((a, b) => a.value - b.value);
  if (!entries.length) return null;
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  if (total <= 0) return null;
  const threshold = quantile * total;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.count;
    if (cumulative >= threshold) return entry.value;
  }
  return entries[entries.length - 1].value;
}

function computeDieSummary(dieStats) {
  if (!dieStats || !Number.isFinite(dieStats.count) || dieStats.count <= 0) return null;
  const count = Number(dieStats.count) || 0;
  if (count <= 0) return null;
  const sum = Number(dieStats.sum) || 0;
  const avg = sum / count;
  const min = Number.isFinite(dieStats.min) ? dieStats.min : avg;
  const max = Number.isFinite(dieStats.max) ? dieStats.max : avg;
  const q1 = computeQuantileFromResults(dieStats.results, 0.25) ?? min;
  const q3 = computeQuantileFromResults(dieStats.results, 0.75) ?? max;
  return { avg, min, max, q1, q3, count };
}

function getStreakEntryForFilters(stats, actionFilter, detailFilter, dieKey) {
  if (!stats || !dieKey) return null;
  const actionKey = actionFilter && actionFilter !== "all" ? actionFilter : "all";
  const hasDetailAction = ["save", "skill", "check", "ability"].includes(actionKey);
  const detailKey = hasDetailAction && detailFilter && detailFilter !== "all"
    ? detailFilter
    : "all";
  const filterKey = getStreakFilterKey(actionKey, detailKey);
  return stats.streaks?.[filterKey]?.[dieKey] || null;
}

function buildHeatmapColor(baseRgb, value, maxValue) {
  if (!value || !maxValue) return "transparent";
  const ratio = Math.min(1, value / maxValue);
  const alpha = 0.12 + ratio * 0.68;
  return `rgba(${baseRgb}, ${alpha.toFixed(2)})`;
}

function readCssNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function updateHeatmapCellSize(container, columns) {
  if (!container || !Number.isFinite(columns) || columns <= 0) return;
  const styles = getComputedStyle(container);
  const labelWidth = readCssNumber(styles.getPropertyValue("--ids-heatmap-label-width"), 110);
  const minCell = readCssNumber(styles.getPropertyValue("--ids-heatmap-cell-min"), 6);
  const maxCell = readCssNumber(styles.getPropertyValue("--ids-heatmap-cell-max"), 16);
  const minLabelFont = 9;
  const maxLabelFont = 12;
  const scroll = container.querySelector(".ids-heatmap__scroll");
  const width = scroll?.clientWidth || container.clientWidth || 0;
  const available = Math.max(0, width - labelWidth - 12);
  const rawSize = Math.floor(available / columns);
  let size = Math.max(minCell, Math.min(maxCell, rawSize || minCell));
  if (!scroll) {
    container.style.setProperty("--ids-heatmap-cell", `${size}px`);
    const labelFont = Math.max(minLabelFont, Math.min(maxLabelFont, Math.floor(size * 0.95)));
    container.style.setProperty("--ids-heatmap-label-font", `${labelFont}px`);
    return;
  }

  for (let i = 0; i < 30; i += 1) {
    container.style.setProperty("--ids-heatmap-cell", `${size}px`);
    const labelFont = Math.max(minLabelFont, Math.min(maxLabelFont, Math.floor(size * 0.95)));
    container.style.setProperty("--ids-heatmap-label-font", `${labelFont}px`);

    const hasOverflow = scroll.scrollWidth > scroll.clientWidth || scroll.scrollHeight > scroll.clientHeight;
    if (!hasOverflow || size <= minCell) break;
    size -= 1;
  }
}

function getMultiSelectValues(select) {
  if (!select) return [];
  return Array.from(select.selectedOptions || []).map((option) => option.value).filter(Boolean);
}

function buildCompareStats(globalStats, userIds, sessionFilter, actionFilter, detailFilter) {
  const byUser = {};
  const labels = {};
  const merged = createEmptyStats();
  for (const userId of userIds) {
    let stats = getStatsForSession(globalStats, userId, sessionFilter);
    if (actionFilter && actionFilter !== "all") {
      stats = buildScopedStats(stats, actionFilter);
    }
    if (detailFilter && detailFilter !== "all") {
      stats = applyDetailFilter(stats, actionFilter, detailFilter);
    }
    byUser[userId] = stats;
    mergeStats(merged, stats);
    const user = game.users.get(userId);
    labels[userId] = user?.name || userId;
  }
  return { byUser, labels, merged };
}

function buildDetailOptions(actionFilter, scopedStats) {
  if (!["save", "check", "ability", "skill"].includes(actionFilter)) return [];
  const actionStats = scopedStats?.actions?.[actionFilter];
  if (!actionStats?.details) return [];
  return Object.keys(actionStats.details)
    .sort()
    .map((key) => ({
      value: key,
      label: formatDetailLabel(key)
    }));
}

function formatDetailLabel(detailKey) {
  const [kind, value] = detailKey.split(":");
  const label = value ? toPascalCase(value) : detailKey;
  if (kind === "save") return `${label} Save`;
  if (kind === "skill") return `${label} Skill`;
  if (kind === "ability") return `${label} Check`;
  return detailKey;
}

function toPascalCase(value) {
  return String(value)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
}

function getMostFrequentAction(actions) {
  let top = null;
  let best = -1;
  for (const [actionType, stats] of Object.entries(actions)) {
    const count = Number(stats.count) || 0;
    if (count > best) {
      best = count;
      top = actionType;
    }
  }
  return top;
}

function setText(root, selector, value) {
  const element = root?.querySelector?.(selector)
    ?? document.querySelector(`#${MODULE_ID}`)?.querySelector(selector)
    ?? document.querySelector(`#${DiceStatsApp?.DEFAULT_OPTIONS?.id}`)?.querySelector(selector);
  if (element) element.textContent = value;
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function sortDiceKeys(a, b) {
  const numA = Number(String(a).replace(/\D/g, "")) || 0;
  const numB = Number(String(b).replace(/\D/g, "")) || 0;
  return numA - numB;
}

function sortActionKeys(a, b) {
  const idxA = ACTION_ORDER.indexOf(a);
  const idxB = ACTION_ORDER.indexOf(b);
  if (idxA === -1 && idxB === -1) return a.localeCompare(b);
  if (idxA === -1) return 1;
  if (idxB === -1) return -1;
  return idxA - idxB;
}

function buildGradient(context, start, end) {
  const gradient = context.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  return gradient;
}

function buildPalette(count) {
  const palette = [
    "#0f766e",
    "#f97316",
    "#16a34a",
    "#e11d48",
    "#0284c7",
    "#facc15",
    "#334155",
    "#14b8a6",
    "#fb7185"
  ];
  const colors = [];
  for (let i = 0; i < count; i += 1) {
    colors.push(palette[i % palette.length]);
  }
  return colors;
}

function getChartGridColor() {
  return document.body.classList.contains("theme-dark")
    ? "rgba(148, 163, 184, 0.35)"
    : "rgba(15, 118, 110, 0.15)";
}

function getChartTickColor() {
  return document.body.classList.contains("theme-dark")
    ? "#e2e8f0"
    : "#1f2937";
}

function getChartTitleColor() {
  return document.body.classList.contains("theme-dark")
    ? "#e2e8f0"
    : "#0f172a";
}

const idsCandlesticksPlugin = {
  id: "idsCandlesticks",
  afterDatasetsDraw(chart, args, pluginOptions) {
    if (!pluginOptions?.enabled) return;
    const xScale = chart.scales?.x;
    const yScale = chart.scales?.y;
    if (!xScale || !yScale) return;
    const datasets = chart.data?.datasets || [];
    const labels = chart.data?.labels || [];
    if (!labels.length) return;
    const datasetCount = datasets.length;
    let step = 0;
    if (typeof xScale.getPixelForTick === "function" && xScale.ticks?.length > 1) {
      step = Math.abs(xScale.getPixelForTick(1) - xScale.getPixelForTick(0));
    } else if (labels.length > 1 && typeof xScale.getPixelForValue === "function") {
      step = Math.abs(xScale.getPixelForValue(1) - xScale.getPixelForValue(0));
    } else {
      step = xScale.width || 40;
    }
    const groupWidth = step * 0.82;
    const slotWidth = groupWidth / Math.max(datasetCount, 1);
    const boxWidth = Math.max(4, Math.min(16, slotWidth * 0.9));

    const ctx = chart.ctx;
    datasets.forEach((dataset, datasetIndex) => {
      if (dataset.hidden) return;
      const candles = dataset.idsCandles || [];
      const baseColor = Array.isArray(dataset.borderColor)
        ? dataset.borderColor[0]
        : (dataset.borderColor || dataset.backgroundColor || "#0f766e");
      const lineWidth = Number(pluginOptions.lineWidth) || 2;
      const fillAlpha = Number.isFinite(pluginOptions.fillAlpha) ? pluginOptions.fillAlpha : 0.2;
      const overlapFactor = Number.isFinite(pluginOptions.overlapFactor) ? pluginOptions.overlapFactor : 0;
      const offset = (datasetIndex - (datasetCount - 1) / 2) * slotWidth * (1 - overlapFactor);

      candles.forEach((candle, index) => {
        if (!candle || !Number.isFinite(candle.avg)) return;
        const baseX = typeof xScale.getPixelForValue === "function"
          ? xScale.getPixelForValue(labels[index])
          : xScale.getPixelForTick(index);
        if (!Number.isFinite(baseX)) return;
        const x = baseX + offset;
        const q1 = Number.isFinite(candle.q1) ? candle.q1 : candle.avg;
        const q3 = Number.isFinite(candle.q3) ? candle.q3 : candle.avg;
        const yLow = yScale.getPixelForValue(q1);
        const yHigh = yScale.getPixelForValue(q3);
        const yMinLine = yScale.getPixelForValue(candle.min);
        const yMaxLine = yScale.getPixelForValue(candle.max);

        ctx.save();
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        ctx.moveTo(x, yMinLine);
        ctx.lineTo(x, yLow);
        ctx.moveTo(x, yHigh);
        ctx.lineTo(x, yMaxLine);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - boxWidth / 2, yMinLine);
        ctx.lineTo(x + boxWidth / 2, yMinLine);
        ctx.moveTo(x - boxWidth / 2, yMaxLine);
        ctx.lineTo(x + boxWidth / 2, yMaxLine);
        ctx.stroke();

        const top = Math.min(yLow, yHigh);
        const height = Math.max(2, Math.abs(yHigh - yLow));
        ctx.globalAlpha = fillAlpha;
        ctx.fillStyle = baseColor;
        ctx.fillRect(x - boxWidth / 2, top, boxWidth, height);
        ctx.globalAlpha = 1;
        ctx.strokeRect(x - boxWidth / 2, top, boxWidth, height);
        ctx.restore();
      });
    });
  }
};

function ensureChartPlugins() {
  if (!globalThis.Chart || state.candlestickRegistered) return;
  Chart.register(idsCandlesticksPlugin);
  state.candlestickRegistered = true;
}

Hooks.once("init", () => {
  if (!Handlebars.helpers.eq) {
    Handlebars.registerHelper("eq", (a, b) => a === b);
  }
  game.settings.register(MODULE_ID, "enabled", {
    name: "Enable dice tracking",
    hint: "Track dice rolls for DnD 5e and Midi-QOL workflows.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "globalStats", {
    name: "Global Dice Stats",
    scope: "world",
    config: false,
    type: Object,
    default: createGlobalStats(),
    onChange: (value) => {
      state.globalStats = normalizeGlobalStats(value);
    }
  });

  game.settings.register(MODULE_ID, "hiddenPlayers", {
    name: "Hidden Players",
    hint: "Hide selected players from the dice stats dashboard.",
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "uiState", {
    name: "Indy Dice Stats UI State",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.registerMenu(MODULE_ID, "viewer", {
    name: "Indy Dice Stats",
    label: "Open Dice Dashboard",
    hint: "View dice statistics for players and actions.",
    icon: "fas fa-chart-column",
    type: DiceStatsApp,
    restricted: false
  });

  game.settings.registerMenu(MODULE_ID, "reset", {
    name: "Reset Dice Stats",
    label: "Reset Dice Stats",
    hint: "Clear dice statistics for players.",
    icon: "fas fa-rotate-left",
    type: DiceStatsResetApp,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "visibility", {
    name: "Player Visibility",
    label: "Configure Hidden Players",
    hint: "Choose players to hide from the dice stats dashboard.",
    icon: "fas fa-user-slash",
    type: DiceStatsVisibilityApp,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "faker", {
    name: "Generate Fake Data",
    label: "Generate Fake Data",
    hint: "Create fake dice stats for a selected player.",
    icon: "fas fa-dice",
    type: DiceStatsFakerApp,
    restricted: true
  });

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = {
      open: () => new DiceStatsApp().render(true),
      getUserStats,
      resetUserStats
    };
  }
});

Hooks.once("ready", async () => {
  getGlobalStats();
  watchThemeChanges();
  game.socket.on(`module.${MODULE_ID}`, async (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "statsUpdated") {
      state.globalStats = normalizeGlobalStats(game.settings.get(MODULE_ID, "globalStats"));
      return;
    }
    if (message.type === "statsSnapshot") {
      if (message.senderId && message.senderId === game.user?.id) return;
      state.globalStats = normalizeGlobalStats(message.data);
      scheduleRefresh();
      return;
    }
    if (message.type !== "roll") return;
    if (!game.user?.isGM) return;
    const payload = message.data;
    if (!payload?.results || !payload?.actionType || !payload?.userId) return;
    handleRollPayloadsLocally([payload]);
  });
});

Hooks.on("createChatMessage", async (message, options, userId) => {
  if (!shouldTrackMessage(message, userId)) return;
  const rolls = getRollsFromMessage(message);
  const actionType = extractActionType(message, rolls[0], state.workflowMeta.get(message.id));
  const originUserId = resolveUserIdFromMessage(message, userId) || game.user?.id;
  const payloads = buildPayloadsFromRolls(rolls, actionType, originUserId, message, state.workflowMeta.get(message.id));
  if (!payloads.length) return;
  if (game.user?.isGM) {
    handleRollPayloadsLocally(payloads);
  } else {
    for (const payload of payloads) {
      game.socket.emit(`module.${MODULE_ID}`, { type: "roll", data: payload });
    }
  }
  markMessageProcessed(message.id);
});



Hooks.on("midi-qol.RollComplete", async (workflow) => {
  if (!workflow || !game.settings.get(MODULE_ID, "enabled")) return;
  //if (game.system?.id !== "dnd5e") return;

  // try {
  //   const flatted = await ensureFlatted();
  //   let stringified = "";
  //   try {
  //     stringified = flatted?.stringify ? flatted.stringify(workflow) : "";
  //   } catch (innerErr) {
  //     stringified = safeStringify(workflow);
  //     console.warn("Indy Dice Stats | Flatted failed, using safe stringify.", innerErr);
  //   }
  //   if (stringified) console.log("Indy Dice Stats | Midi-QOL workflow", stringified);
  // } catch (err) {
  //   console.warn("Indy Dice Stats | Failed to serialize Midi-QOL workflow", err);
  // }
  
  const workflowUserId = await resolveUserIdFromWorkflow(workflow);
  if (!game.user?.isGM && workflowUserId && workflowUserId !== game.user?.id) return;

  const messageId = workflow?.itemCardId || workflow?.chatMessageId || workflow?.messageId;
  const actionType = normalizeActionType(
    workflow?.rollType || workflow?.workflowType || workflow?.item?.system?.actionType
  );

  if (messageId) {
    state.workflowMeta.set(messageId, { actionType });
    if (state.processedMessages.has(messageId)) return;
  }

  const rolls = collectWorkflowRolls(workflow);
  if (!rolls.length) return;
  const payloads = buildPayloadsFromRolls(
    rolls,
    actionType,
    workflowUserId || game.user?.id,
    null,
    workflow
  );
  if (!payloads.length) return;
  if (game.user?.isGM) {
    handleRollPayloadsLocally(payloads);
  } else {
    for (const payload of payloads) {
      game.socket.emit(`module.${MODULE_ID}`, { type: "roll", data: payload });
    }
  }
});

function refreshOpenDashboards(options = {}) {
  const windows = Object.values(ui.windows ?? {});
  for (const app of windows) {
    if (app instanceof DiceStatsApp) app._refreshCharts(options);
  }
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    if (app instanceof DiceStatsApp) app._refreshCharts(options);
  }
}

function watchThemeChanges() {
  if (state.themeObserver) return;
  if (typeof MutationObserver === "undefined") return;
  const body = document.body;
  if (!body) return;
  state.themeIsDark = body.classList.contains("theme-dark");
  state.themeObserver = new MutationObserver(() => {
    const isDark = body.classList.contains("theme-dark");
    if (isDark === state.themeIsDark) return;
    state.themeIsDark = isDark;
    refreshOpenDashboards({ forceThemeRefresh: true });
  });
  state.themeObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!controls) return;
  const tokenControls = controls.tokens ?? controls.token ?? controls.drawings;
  if (!tokenControls) return;
  tokenControls.tools ??= {};
  tokenControls.tools.indyDiceStats = {
    name: "indyDiceStats",
    title: "Indy Dice Stats",
    icon: "fas fa-chart-column",
    button: true,
    visible: true,
    onChange: () => new DiceStatsApp().render(true)
  };
});
