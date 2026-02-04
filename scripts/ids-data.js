
import {
  FAKE_ABILITIES,
  FAKE_ACTION_POOL,
  FAKE_ACTION_TYPES,
  FAKE_DAMAGE_DICE,
  FAKE_DAMAGE_FACES,
  FAKE_HEAL_DICE,
  FAKE_SKILLS,
  FAKE_ROLLS_MAX,
  FAKE_ROLLS_MIN,
  FAKE_SESSION_COUNT,
  FLATTED_SRC,
  ITEM_ACTION_TYPE_MAP,
  MODULE_ID
} from "./ids-constants.js";
import { debounce, state } from "./ids-state.js";

export function createEmptyStats() {
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

export function createGlobalStats() {
  return {
    ...createEmptyStats(),
    users: {},
    byDate: {},
    usersByDate: {}
  };
}

export function normalizeStats(raw) {
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

export function normalizeGlobalStats(raw) {
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

function cloneLatestRollResults(results) {
  const cloned = {};
  if (!results || typeof results !== "object") return cloned;
  for (const [dieKey, faces] of Object.entries(results)) {
    if (!faces || typeof faces !== "object") continue;
    const faceCounts = {};
    for (const [face, count] of Object.entries(faces)) {
      const value = Number(count) || 0;
      if (value <= 0) continue;
      faceCounts[face] = value;
    }
    if (Object.keys(faceCounts).length > 0) cloned[dieKey] = faceCounts;
  }
  return cloned;
}

function cloneLatestRollSequence(sequence) {
  const cloned = {};
  if (!sequence || typeof sequence !== "object") return cloned;
  for (const [dieKey, list] of Object.entries(sequence)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const values = list.map((value) => Number(value)).filter((value) => Number.isFinite(value));
    if (values.length > 0) cloned[dieKey] = values;
  }
  return cloned;
}

function normalizeLatestRollSegment(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    actionType: raw.actionType || "other",
    detailKey: raw.detailKey || null,
    advantage: raw.advantage === "disadvantage" ? "disadvantage"
      : (raw.advantage === "advantage" ? "advantage" : null),
    results: cloneLatestRollResults(raw.results),
    sequence: cloneLatestRollSequence(raw.sequence)
  };
}

export function normalizeLatestRoll(raw) {
  if (!raw || typeof raw !== "object") return null;
  const rollCount = Number(raw.rolls);
  const entry = {
    userId: raw.userId || null,
    userName: raw.userName ? String(raw.userName) : null,
    actionType: raw.actionType || "other",
    detailKey: raw.detailKey || null,
    advantage: raw.advantage === "disadvantage" ? "disadvantage"
      : (raw.advantage === "advantage" ? "advantage" : null),
    visibility: raw.visibility && typeof raw.visibility === "object"
      ? {
          rollMode: raw.visibility.rollMode ? String(raw.visibility.rollMode) : null,
          whisper: Array.isArray(raw.visibility.whisper) ? raw.visibility.whisper.filter(Boolean) : [],
          blind: !!raw.visibility.blind,
          authorId: raw.visibility.authorId || null,
          userId: raw.visibility.userId || null
        }
      : null,
    rolls: Number.isFinite(rollCount) ? rollCount : 1,
    results: cloneLatestRollResults(raw.results),
    sequence: cloneLatestRollSequence(raw.sequence),
    segments: Array.isArray(raw.segments)
      ? raw.segments.map(normalizeLatestRollSegment).filter(Boolean)
      : null,
    at: Number(raw.at) || Date.now()
  };
  if (!entry.userName && entry.userId) {
    const user = game.users?.get?.(entry.userId);
    if (user?.name) entry.userName = user.name;
  }
  return entry;
}

export function createLatestRollEntry(payload) {
  if (!payload || typeof payload !== "object") return null;
  return normalizeLatestRoll({
    userId: payload.userId,
    userName: payload.userName,
    actionType: payload.actionType,
    detailKey: payload.detailKey || null,
    advantage: payload.advantage || null,
    visibility: payload.visibility || null,
    rolls: payload.rolls,
    results: payload.results,
    sequence: payload.sequence,
    segments: [
      {
        actionType: payload.actionType,
        detailKey: payload.detailKey || null,
        advantage: payload.advantage || null,
        results: payload.results,
        sequence: payload.sequence
      }
    ],
    at: Date.now()
  });
}

function mergeLatestRollSequence(target, source) {
  if (!source || typeof source !== "object") return;
  for (const [dieKey, list] of Object.entries(source)) {
    if (!Array.isArray(list) || list.length === 0) continue;
    const targetList = target[dieKey] ??= [];
    for (const value of list) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) targetList.push(numeric);
    }
  }
}

export function createLatestRollEntryFromPayloads(payloads) {
  if (!Array.isArray(payloads) || payloads.length === 0) return null;
  const base = payloads[0] || {};
  let actionType = base.actionType || null;
  let detailKey = base.detailKey || null;
  let advantage = base.advantage || null;
  let userId = base.userId || null;
  let userName = base.userName || null;
  let visibility = base.visibility || null;
  let rolls = 0;
  const results = {};
  const sequence = {};
  const segments = [];
  let mixedDetail = false;
  let mixedAdvantage = false;

  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") continue;
    rolls += Number(payload.rolls) || 0;
    mergeResultCounts(results, payload.results);
    mergeLatestRollSequence(sequence, payload.sequence);
    segments.push({
      actionType: payload.actionType || "other",
      detailKey: payload.detailKey || null,
      advantage: payload.advantage || null,
      results: payload.results,
      sequence: payload.sequence
    });
    if (payload.userId && !userId) userId = payload.userId;
    if (payload.userName && !userName) userName = payload.userName;
    if (payload.visibility && !visibility) visibility = payload.visibility;
    if (payload.actionType && !actionType) actionType = payload.actionType;
    if ((payload.detailKey || null) !== detailKey) mixedDetail = true;
    if ((payload.advantage || null) !== advantage) mixedAdvantage = true;
  }

  if (!actionType) actionType = "other";
  if (mixedDetail) detailKey = null;
  if (mixedAdvantage) advantage = null;

  return normalizeLatestRoll({
    userId,
    userName,
    actionType,
    detailKey,
    advantage,
    visibility,
    rolls,
    results,
    sequence,
    segments,
    at: Date.now()
  });
}

export function setLatestRoll(entry, options = {}) {
  const normalized = normalizeLatestRoll(entry);
  if (!normalized) return null;
  const hasD20 = (() => {
    const hasKey = (container) => Object.keys(container || {})
      .some((key) => String(key).toLowerCase() === "d20");
    return hasKey(normalized.results) || hasKey(normalized.sequence);
  })();
  state.latestRoll = normalized;
  if (hasD20) {
    state.latestD20Roll = normalized;
  }
  const { broadcast = false, refresh = false } = options;
  if (broadcast && game.socket) {
    game.socket.emit(`module.${MODULE_ID}`, {
      type: "latestRoll",
      data: normalized,
      senderId: game.user?.id
    });
  }
  if (refresh) scheduleRefresh();
  return normalized;
}
export function getUserStats(userId) {
  if (!userId) return createEmptyStats();
  const globalStats = getGlobalStats();
  return globalStats.users?.[userId] ? normalizeStats(globalStats.users[userId]) : createEmptyStats();
}

export function mergeStats(target, source) {
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

  if (source.streaks && typeof source.streaks === "object") {
    target.streaks ??= {};
    for (const [filterKey, dieMap] of Object.entries(source.streaks)) {
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
        targetEntry.longestMin = Math.max(targetEntry.longestMin, Number(entry.longestMin) || 0);
        targetEntry.longestMax = Math.max(targetEntry.longestMax, Number(entry.longestMax) || 0);
      }
    }
  }

  return target;
}

export function mergeDieStats(target, source) {
  if (!source) return target;
  target.count += Number(source.count) || 0;
  target.sum += Number(source.sum) || 0;
  if (source.min !== null && source.min !== undefined) {
    if (target.min === null || target.min === undefined) {
      target.min = source.min;
    } else {
      target.min = Math.min(target.min, source.min);
    }
  }
  if (source.max !== null && source.max !== undefined) {
    if (target.max === null || target.max === undefined) {
      target.max = source.max;
    } else {
      target.max = Math.max(target.max, source.max);
    }
  }
  if (source.results && typeof source.results === "object") {
    target.results ??= {};
    for (const [face, count] of Object.entries(source.results)) {
      const value = Number(count) || 0;
      if (value <= 0) continue;
      target.results[face] = (target.results[face] || 0) + value;
    }
  }
  return target;
}

export function ensureAction(stats, actionType) {
  stats.actions ??= {};
  const action = stats.actions[actionType] ??= {
    rolls: 0,
    count: 0,
    dice: {},
    details: {}
  };
  return action;
}

export function ensureDetail(actionStats, detailKey) {
  actionStats.details ??= {};
  const detail = actionStats.details[detailKey] ??= {
    rolls: 0,
    count: 0,
    dice: {}
  };
  return detail;
}

export function ensureDie(container, dieKey) {
  container ??= {};
  const die = container[dieKey] ??= {
    count: 0,
    sum: 0,
    min: null,
    max: null,
    results: {}
  };
  return die;
}

export function recordRoll(stats, actionType, roll) {
  if (!stats || !roll) return;
  const actionStats = ensureAction(stats, actionType);
  actionStats.rolls += 1;
  stats.totals.rolls += 1;
  if (!Array.isArray(roll.terms)) return;
  for (const term of roll.terms) {
    if (!term || !Array.isArray(term.results)) continue;
    if (!term.faces) continue;
    const dieKey = `d${term.faces}`;
    const dieStats = ensureDie(stats.dice, dieKey);
    const actionDieStats = ensureDie(actionStats.dice, dieKey);
    for (const result of term.results) {
      if (!result || result.result === undefined) continue;
      const value = Number(result.result);
      if (!Number.isFinite(value)) continue;
      applyDieResult(dieStats, value);
      applyDieResult(actionDieStats, value);
      stats.totals.dice += 1;
      actionStats.count += 1;
    }
  }
}

export function recordResultCounts(stats, actionType, resultCounts, rollCount = 1, detailKey = null) {
  if (!stats || !resultCounts) return;
  const actionStats = ensureAction(stats, actionType);
  const detailStats = detailKey ? ensureDetail(actionStats, detailKey) : null;
  actionStats.rolls += Number(rollCount) || 0;
  stats.totals.rolls += Number(rollCount) || 0;

  for (const [dieKey, faces] of Object.entries(resultCounts)) {
    const dieStats = ensureDie(stats.dice, dieKey);
    const actionDieStats = ensureDie(actionStats.dice, dieKey);
    const detailDieStats = detailStats ? ensureDie(detailStats.dice, dieKey) : null;
    for (const [face, count] of Object.entries(faces || {})) {
      const value = Number(face);
      const valueCount = Number(count) || 0;
      if (!Number.isFinite(value) || valueCount <= 0) continue;
      applyDieResultCount(dieStats, value, valueCount);
      applyDieResultCount(actionDieStats, value, valueCount);
      if (detailDieStats) applyDieResultCount(detailDieStats, value, valueCount);
      stats.totals.dice += valueCount;
      actionStats.count += valueCount;
      if (detailStats) detailStats.count += valueCount;
    }
  }
}

export function getDieFacesFromKey(dieKey) {
  if (!dieKey) return null;
  const faces = Number(String(dieKey).replace(/\D/g, ""));
  if (!Number.isFinite(faces) || faces <= 0) return null;
  return faces;
}

export function getStreakFilterKey(actionType, detailKey) {
  const action = actionType || "all";
  const detail = detailKey || "all";
  return `${action}|${detail}`;
}

export function ensureStreakEntry(stats, actionType, detailKey, dieKey) {
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

export function applyStreakValue(entry, value, faces) {
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

export function applyStreaksForSequence(stats, actionType, sequenceByDie, detailKey) {
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

export function applyDieResult(dieStats, value) {
  dieStats.count += 1;
  dieStats.sum += value;
  dieStats.min = dieStats.min === null ? value : Math.min(dieStats.min, value);
  dieStats.max = dieStats.max === null ? value : Math.max(dieStats.max, value);
  const key = String(value);
  dieStats.results[key] = (dieStats.results[key] || 0) + 1;
}

export function applyDieResultCount(dieStats, value, count) {
  dieStats.count += count;
  dieStats.sum += value * count;
  dieStats.min = dieStats.min === null ? value : Math.min(dieStats.min, value);
  dieStats.max = dieStats.max === null ? value : Math.max(dieStats.max, value);
  const key = String(value);
  dieStats.results[key] = (dieStats.results[key] || 0) + count;
}
export function getRollsFromMessage(message) {
  if (!message) return [];
  if (Array.isArray(message.rolls) && message.rolls.length) return message.rolls;
  if (message.rolls?.length) return Array.from(message.rolls);
  if (Array.isArray(message.rolls?.contents) && message.rolls.contents.length) return message.rolls.contents;
  if (message.roll) return [message.roll];
  return [];
}

export function safeLower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function stripAdvantageMarkers(value) {
  if (!value) return "";
  return String(value)
    .replace(/\((disadvantage|advantage)\)/gi, " ")
    .replace(/\bwith\s+(disadvantage|advantage)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stripSaveCheckMarkers(value) {
  if (!value) return "";
  return String(value)
    .replace(/\bsaving throw\b/gi, " ")
    .replace(/\bability check\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeDetailCandidate(value) {
  return stripSaveCheckMarkers(stripAdvantageMarkers(value));
}

function extractVisibilityFromMessage(message, userId) {
  if (!message || typeof message !== "object") return null;
  const rawWhisper = message.whisper
    ?? message.data?.whisper
    ?? message.system?.whisper
    ?? message.flags?.core?.whisper;
  let whisper = [];
  if (Array.isArray(rawWhisper)) {
    whisper = rawWhisper.filter(Boolean);
  } else if (rawWhisper instanceof Set) {
    whisper = Array.from(rawWhisper).filter(Boolean);
  } else if (rawWhisper?.contents && Array.isArray(rawWhisper.contents)) {
    whisper = rawWhisper.contents.filter(Boolean);
  }

  let rollMode = null;
  const rollList = Array.isArray(message.rolls)
    ? message.rolls
    : (Array.isArray(message.rolls?.contents) ? message.rolls.contents : []);
  for (const roll of rollList) {
    if (!roll) continue;
    let options = roll?.options || {};
    if ((!options || Object.keys(options).length === 0) && typeof roll === "string") {
      try {
        const parsed = JSON.parse(roll);
        options = parsed?.options || options;
      } catch (err) {
        // ignore parse errors for non-JSON roll strings
      }
    }
    if (options?.rollMode) {
      rollMode = options.rollMode;
      break;
    }
  }
  rollMode = rollMode
    || message.rollMode
    || message.data?.rollMode
    || message.system?.rollMode
    || message.flags?.core?.rollMode
    || message.flags?.dnd5e?.roll?.rollMode
    || null;
  const authorId = message.user?.id
    || message.author?.id
    || message.author
    || message.userId
    || message.data?.user
    || message.data?.userId
    || null;
  return {
    rollMode: rollMode ? String(rollMode) : null,
    whisper,
    blind: !!(message.blind ?? message.data?.blind ?? message.system?.blind),
    authorId,
    userId: userId || null
  };
}

export function isSelfRollMessage(message, userId) {
  const visibility = extractVisibilityFromMessage(message, userId);
  if (!visibility) return false;
  const mode = String(visibility.rollMode || "").toLowerCase();
  if (mode.includes("self")) return true;
  if (mode.includes("gm") || mode.includes("blind")) return false;
  const whisper = Array.isArray(visibility.whisper) ? visibility.whisper : [];
  if (whisper.length !== 1) return false;
  const sole = whisper[0];
  return !!sole && (sole === visibility.authorId || sole === visibility.userId);
}

export function isGmPrivateRollMessage(message, userId) {
  const visibility = extractVisibilityFromMessage(message, userId);
  if (!visibility) return false;
  // const authorIsGm = visibility.authorId
  //   ? !!game.users?.get?.(visibility.authorId)?.isGM
  //   : false;
  // if (!authorIsGm) return false;
  const mode = String(visibility.rollMode || "").toLowerCase();
  return mode.includes("gm") && !mode.includes("blind");
}

export function isBlindGmRollMessage(message, userId) {
  const visibility = extractVisibilityFromMessage(message, userId);
  if (!visibility) return false;
  // const authorIsGm = visibility.authorId
  //   ? !!game.users?.get?.(visibility.authorId)?.isGM
  //   : false;
  // if (!authorIsGm) return false;
  const mode = String(visibility.rollMode || "").toLowerCase();
  return mode.includes("blind");
}

function extractAdvantageFromText(value) {
  if (!value) return null;
  const text = String(value).toLowerCase();
  if (text.includes("disadvantage")) return "disadvantage";
  if (text.includes("advantage")) return "advantage";
  return null;
}

function getAdvantageFlag(source) {
  if (!source || typeof source !== "object") return null;
  const disadvantage = source.disadvantage ?? source.disadvantaged;
  const advantage = source.advantage ?? source.advantaged;
  if (disadvantage === true || disadvantage === 1) return "disadvantage";
  if (advantage === true || advantage === 1) return "advantage";
  if (typeof disadvantage === "string" && disadvantage.toLowerCase().includes("dis")) return "disadvantage";
  if (typeof advantage === "string" && advantage.toLowerCase().includes("adv")) return "advantage";
  const mode = source.advantageMode || source.mode || source.rollMode;
  if (typeof mode === "string") {
    if (mode.toLowerCase().includes("dis")) return "disadvantage";
    if (mode.toLowerCase().includes("adv")) return "advantage";
  }
  if (typeof mode === "number") {
    if (mode < 0) return "disadvantage";
    if (mode > 0) return "advantage";
  }  
  return null;
}

function mergeAdvantageState(current, next) {
  if (!next) return current || null;
  if (current === "disadvantage") return current;
  if (next === "disadvantage") return next;
  if (current === "advantage") return current;
  return next;
}

export function normalizeActionType(raw) {
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

export function extractActionType(message, roll, workflowMeta) {
  const candidates = [];
  let rollOptions = roll?.options || {};
  if ((!rollOptions || Object.keys(rollOptions).length === 0) && typeof roll === "string") {
    try {
      const parsed = JSON.parse(roll);
      rollOptions = parsed?.options || rollOptions;
    } catch (err) {
      // ignore parse errors for non-JSON roll strings
    }
  }
  if (rollOptions.rollType) candidates.push(rollOptions.rollType);
  if (rollOptions.rolltype) candidates.push(rollOptions.rolltype);
  if (rollOptions.type) candidates.push(rollOptions.type);

  const dnd5eFlags = message?.flags?.dnd5e;
  if (dnd5eFlags?.roll?.type) candidates.push(dnd5eFlags.roll.type);
  if (dnd5eFlags?.roll?.rollType) candidates.push(dnd5eFlags.roll.rollType);
  if (dnd5eFlags?.activity?.type) candidates.push(dnd5eFlags.activity.type);

  const midiFlags = message?.flags?.["midi-qol"];
  if (midiFlags?.rollType) candidates.push(midiFlags.rollType);
  if (midiFlags?.type) candidates.push(midiFlags.type);
  if (midiFlags?.workflowType) candidates.push(midiFlags.workflowType);

  const pf2eFlags = message?.flags?.pf2e;
  if (pf2eFlags?.context?.type) candidates.push(pf2eFlags.context.type);
  if (pf2eFlags?.context?.action) candidates.push(pf2eFlags.context.action);
  if (pf2eFlags?.context?.origin?.type) candidates.push(pf2eFlags.context.origin.type);

  if (workflowMeta?.actionType) candidates.push(workflowMeta.actionType);

  let fallback = null;
  for (const candidate of candidates) {
    const normalized = normalizeActionType(stripAdvantageMarkers(candidate));
    if (normalized && normalized !== "other") return normalized;
    if (normalized === "other") fallback = normalized;
  }
  return fallback || normalizeActionType(rollOptions.flavor || message?.flavor || message?.content);
}

export function shouldTrackMessage(message, userId) {
  if (!message || !game.settings.get(MODULE_ID, "enabled")) return false;
  if (!game.user?.isGM && message.user?.id && game.user?.id && message.user.id !== game.user.id) return false;
  if (message.user?.id && message.user.id !== userId) return false;
  if (state.processedMessages.has(message.id)) return false;
  if (!game.settings.get(MODULE_ID, "recordSelfRolls") && isSelfRollMessage(message, userId)) return false;
  if (!game.settings.get(MODULE_ID, "recordGmPrivateRolls") && isGmPrivateRollMessage(message, userId)) return false;
  if (!game.settings.get(MODULE_ID, "recordGmBlindRolls") && isBlindGmRollMessage(message, userId)) return false;
  const flags = message.flags?.[MODULE_ID];
  if (flags?.tracked === false) return false;
  if (flags?.trackedViaSocket && game.user?.isGM) return false;
  return true;
}

export function getGlobalStats() {
  if (state.globalStats) return state.globalStats;
  const stored = game.settings.get(MODULE_ID, "globalStats");
  state.globalStats = normalizeGlobalStats(stored);
  return state.globalStats;
}

export function markGlobalStatsDirty() {
  const stats = getGlobalStats();
  stats.updatedAt = Date.now();
}

export function scheduleSave() {
  if (!state.saveDebounced) {
    state.saveDebounced = debounce(async () => {
      try {
        await game.settings.set(MODULE_ID, "globalStats", state.globalStats);
        game.socket.emit(`module.${MODULE_ID}`, { type: "statsUpdated" });
      } catch (err) {
        console.warn("Indy Dice Stats | Failed to save stats", err);
      }
    }, 1500);
  }
  state.saveDebounced();
}

export function scheduleSnapshotBroadcast() {
  if (!state.snapshotDebounced) {
    state.snapshotDebounced = debounce(() => {
      game.socket.emit(`module.${MODULE_ID}`, {
        type: "statsSnapshot",
        data: state.globalStats,
        senderId: game.user?.id
      });
    }, 1000);
  }
  state.snapshotDebounced();
}

export function scheduleRefresh() {
  if (!state.refreshDebounced) {
    state.refreshDebounced = debounce(() => {
      for (const app of foundry.applications.instances?.values?.() ?? []) {
        if (app instanceof foundry.applications.api.ApplicationV2) {
          app.render({ force: true });
        }
      }
    }, 300);
  }
  state.refreshDebounced();
}

export function safeStringify(value, maxLength = 200000) {
  try {
    const stringified = JSON.stringify(value);
    if (stringified.length > maxLength) return stringified.slice(0, maxLength);
    return stringified;
  } catch (err) {
    return "";
  }
}

export function markMessageProcessed(messageId) {
  if (!messageId) return;
  state.processedMessages.add(messageId);
}

function describeWorkflowRoll(roll) {
  if (!roll || typeof roll !== "object") return "Unknown roll";
  const formula = roll.formula || roll._formula;
  const total = Number.isFinite(roll.total) ? roll.total : roll.result;
  if (formula) return total !== undefined ? `${formula} = ${total}` : formula;
  if (Array.isArray(roll.terms)) {
    const termFormula = roll.terms
      .map((term) => term?.formula || term?.expression || (term?.faces ? `d${term.faces}` : ""))
      .filter(Boolean)
      .join(" + ");
    if (termFormula) return total !== undefined ? `${termFormula} = ${total}` : termFormula;
  }
  if (roll.id) return `Roll ${roll.id}`;
  return "Roll";
}

export function collectWorkflowRolls(workflow, options = {}) {
  if (!workflow) return [];
  const debug = !!options.debug;
  const rolls = [];
  const sourceCounts = debug ? {} : null;
  const rollSources = debug ? new Map() : null;

  const addRoll = (roll, label) => {
    if (!roll) return;
    rolls.push(roll);
    if (!debug) return;
    sourceCounts[label] = (sourceCounts[label] || 0) + 1;
    const labels = rollSources.get(roll) ?? new Set();
    labels.add(label);
    rollSources.set(roll, labels);
  };

  const addList = (label, list) => {
    if (!Array.isArray(list)) return;
    for (const roll of list) addRoll(roll, label);
  };

  if (Array.isArray(workflow.rolls)) {
    addList("workflow.rolls", workflow.rolls);
  } else if (Array.isArray(workflow.rolls?.contents)) {
    addList("workflow.rolls.contents", workflow.rolls.contents);
  }
  if (workflow.attackRoll) addRoll(workflow.attackRoll, "workflow.attackRoll");
  if (Array.isArray(workflow.damageRolls)) {
    addList("workflow.damageRolls", workflow.damageRolls);
  } else if (Array.isArray(workflow.damageRolls?.contents)) {
    addList("workflow.damageRolls.contents", workflow.damageRolls.contents);
  }
  if (workflow.damageRoll) addRoll(workflow.damageRoll, "workflow.damageRoll");
  if (workflow.saveRoll) addRoll(workflow.saveRoll, "workflow.saveRoll");
  if (Array.isArray(workflow.saves)) {
    addList("workflow.saves", workflow.saves);
  } else if (Array.isArray(workflow.saves?.contents)) {
    addList("workflow.saves.contents", workflow.saves.contents);
  }

  const unique = [];
  const seen = new Set();
  for (const roll of rolls) {
    if (!roll || seen.has(roll)) continue;
    seen.add(roll);
    unique.push(roll);
  }

  if (debug) {
    const duplicates = [];
    for (const [roll, labels] of rollSources.entries()) {
      if (labels.size <= 1) continue;
      duplicates.push({
        roll: describeWorkflowRoll(roll),
        sources: Array.from(labels)
      });
    }
    console.debug("Indy Dice Stats | Midi-QOL roll capture", {
      total: rolls.length,
      unique: unique.length,
      sources: sourceCounts,
      duplicates
    });
  }

  return unique;
}
export function resolveUserIdFromActor(actor) {
  if (!actor) return null;
  const playerOwner = game.users?.find?.((user) => user.character?.id === actor.id);
  if (playerOwner) return playerOwner.id;
  const owners = Object.entries(actor.ownership || {})
    .filter(([, level]) => level === 3)
    .map(([id]) => id);
  if (owners.length === 1) return owners[0];
  if (owners.length > 1) {
    const nonGm = owners.find((id) => !game.users?.get?.(id)?.isGM);
    return nonGm || owners[0];
  }
  return null;
}

export function resolveUserIdFromMessage(message, fallbackUserId) {
  if (!message) return fallbackUserId || null;
  if (message.user?.id) return message.user.id;
  const speakerActorId = message.speaker?.actor;
  if (speakerActorId) {
    const actor = game.actors?.get?.(speakerActorId);
    const ownerId = resolveUserIdFromActor(actor);
    if (ownerId) return ownerId;
  }
  return fallbackUserId || null;
}

export function getPrimaryGmUserId() {
  const gms = game.users?.filter?.((user) => user.isGM) || [];
  return gms[0]?.id || null;
}

export async function resolveUserIdFromWorkflow(workflow) {
  if (!workflow) return null;
  const actorId = workflow?.actor?.id || workflow?.actorId || workflow?.actor?.uuid;
  if (actorId) {
    const actor = game.actors?.get?.(actorId) || (await fromUuid?.(actorId));
    const ownerId = resolveUserIdFromActor(actor);
    if (ownerId) return ownerId;
  }
  return workflow?.user?.id || workflow?.userId || null;
}

export function handleRollPayloadsLocally(payloads) {
  if (!payloads.length) return;
  const globalStats = getGlobalStats();
  for (const payload of payloads) {
    if (!payload?.results || !payload?.actionType || !payload?.userId) continue;
    const userId = payload.userId;
    const actionType = payload.actionType;
    const detailKey = payload.detailKey || null;
    const results = payload.results;
    const sequence = payload.sequence || {};
    const dateKey = payload.dateKey || getDateKey();
    globalStats.users ??= {};
    globalStats.byDate ??= {};
    globalStats.usersByDate ??= {};
    const userStats = globalStats.users[userId] ??= createEmptyStats();
    const dateStats = globalStats.byDate[dateKey] ??= createEmptyStats();
    const userDateStats = globalStats.usersByDate[userId] ??= {};
    userDateStats[dateKey] ??= createEmptyStats();
    const userDateStatsEntry = userDateStats[dateKey];
    recordResultCounts(userStats, actionType, results, payload.rolls || 1, detailKey);
    recordResultCounts(globalStats, actionType, results, payload.rolls || 1, detailKey);
    recordResultCounts(dateStats, actionType, results, payload.rolls || 1, detailKey);
    recordResultCounts(userDateStatsEntry, actionType, results, payload.rolls || 1, detailKey);
    applyStreaksForSequence(userStats, actionType, sequence, detailKey);
    applyStreaksForSequence(globalStats, actionType, sequence, detailKey);
    applyStreaksForSequence(dateStats, actionType, sequence, detailKey);
    applyStreaksForSequence(userDateStatsEntry, actionType, sequence, detailKey);
  }
  const latestEntry = createLatestRollEntryFromPayloads(payloads);
  if (latestEntry) setLatestRoll(latestEntry, { broadcast: true });
  markGlobalStatsDirty();
  scheduleSave();
  scheduleSnapshotBroadcast();
  scheduleRefresh();
}

export function getAggregateStats() {
  const stats = getGlobalStats();
  return normalizeStats(stats);
}

export function getHiddenUserIds() {
  const list = game.settings.get(MODULE_ID, "hiddenPlayers") || [];
  const hidden = new Set(list);
  const allowPlayersSeeGmStats = game.settings.get(MODULE_ID, "allowPlayersSeeGmStats");
  if (!allowPlayersSeeGmStats && !game.user?.isGM) {
    for (const user of game.users?.contents ?? []) {
      if (user?.isGM) hidden.add(user.id);
    }
  }
  return hidden;
}

export function getVisibleSessionDates(globalStats, hiddenSet) {
  if (!globalStats) return [];
  if (!hiddenSet || hiddenSet.size === 0) return Object.keys(globalStats.byDate || {});
  const dates = new Set();
  for (const [uid, byDate] of Object.entries(globalStats.usersByDate || {})) {
    if (hiddenSet.has(uid)) continue;
    for (const key of Object.keys(byDate || {})) {
      dates.add(key);
    }
  }
  return Array.from(dates);
}

export function recomputeGlobalStats() {
  const globalStats = createGlobalStats();
  const stored = game.settings.get(MODULE_ID, "globalStats");
  if (!stored || !stored.users || typeof stored.users !== "object") return globalStats;
  for (const [userId, stats] of Object.entries(stored.users)) {
    globalStats.users[userId] = normalizeStats(stats);
    mergeStats(globalStats, globalStats.users[userId]);
  }
  return globalStats;
}
export function buildResultCountsFromRoll(roll) {
  const results = {};
  if (!roll) return results;
  const diceTerms = Array.isArray(roll.terms)
    ? roll.terms.filter((term) => term && term.results && term.faces)
    : [];
  if (!diceTerms.length) return results;
  collectResultsFromDiceTerms(diceTerms, results);
  return results;
}

export function collectResultsFromDiceTerms(terms, results) {
  if (!Array.isArray(terms)) return;
  for (const term of terms) {
    if (!term || !term.faces) continue;
    const dieKey = `d${term.faces}`;
    const dieResults = results[dieKey] ??= {};
    const termResults = Array.isArray(term.results) ? term.results : [];
    for (const result of termResults) {
      if (!result || result.result === undefined) continue;
      const value = Number(result.result);
      if (!Number.isFinite(value)) continue;
      const key = String(value);
      dieResults[key] = (dieResults[key] || 0) + 1;
    }
  }
}

export function mergeResultCounts(target, source) {
  if (!source) return;
  for (const [dieKey, faces] of Object.entries(source || {})) {
    const targetFaces = target[dieKey] ??= {};
    for (const [face, count] of Object.entries(faces || {})) {
      const value = Number(count) || 0;
      if (value <= 0) continue;
      targetFaces[face] = (targetFaces[face] || 0) + value;
    }
  }
}

export function buildResultSequencesFromRoll(roll) {
  const sequences = {};
  if (!roll) return sequences;
  const diceTerms = Array.isArray(roll.terms)
    ? roll.terms.filter((term) => term && term.results && term.faces)
    : [];
  if (!diceTerms.length) return sequences;
  collectSequencesFromDiceTerms(diceTerms, sequences);
  return sequences;
}

export function collectSequencesFromDiceTerms(terms, sequences) {
  if (!Array.isArray(terms)) return;
  for (const term of terms) {
    if (!term || !term.faces) continue;
    const dieKey = `d${term.faces}`;
    const termResults = Array.isArray(term.results) ? term.results : [];
    const dieSeq = sequences[dieKey] ??= [];
    for (const result of termResults) {
      if (!result || result.result === undefined) continue;
      dieSeq.push(Number(result.result));
    }
  }
}

export function mergeResultSequences(target, source) {
  if (!source) return;
  for (const [dieKey, list] of Object.entries(source || {})) {
    if (!Array.isArray(list)) continue;
    const targetList = target[dieKey] ??= [];
    targetList.push(...list);
  }
}

export function shuffleArray(values) {
  const array = Array.isArray(values) ? [...values] : [];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

export function buildSequenceFromResults(results) {
  const sequences = {};
  for (const [dieKey, faces] of Object.entries(results || {})) {
    const seq = sequences[dieKey] ??= [];
    for (const [face, count] of Object.entries(faces || {})) {
      const value = Number(face);
      const times = Number(count) || 0;
      if (!Number.isFinite(value) || times <= 0) continue;
      for (let i = 0; i < times; i += 1) {
        seq.push(value);
      }
    }
    sequences[dieKey] = shuffleArray(seq);
  }
  return sequences;
}

export function buildPayloadFromRolls(rolls, actionType, userId) {
  const payload = {
    actionType,
    userId,
    rolls: 0,
    results: {},
    sequence: {},
    advantage: null,
    visibility: null,
    messageId: null
  };
  for (const roll of rolls) {
    const results = buildResultCountsFromRoll(roll);
    const sequences = buildResultSequencesFromRoll(roll);
    if (Object.keys(results).length === 0 && Object.keys(sequences).length === 0) continue;
    mergeResultCounts(payload.results, results);
    mergeResultSequences(payload.sequence, sequences);
    payload.rolls += 1;
  }
  return payload;
}

export function resolveRollActionType(roll, fallbackAction) {
  if (!roll) return fallbackAction;
  let rollOptions = roll?.options || {};
  if ((!rollOptions || Object.keys(rollOptions).length === 0) && typeof roll === "string") {
    try {
      const parsed = JSON.parse(roll);
      rollOptions = parsed?.options || rollOptions;
    } catch (err) {
      // ignore parse errors for non-JSON roll strings
    }
  }

  const candidates = [];
  if (rollOptions.rollType) candidates.push(rollOptions.rollType);
  if (rollOptions.rolltype) candidates.push(rollOptions.rolltype);
  if (rollOptions.type) candidates.push(rollOptions.type);
  if (rollOptions.flavor) candidates.push(rollOptions.flavor);

  let fallback = null;
  for (const candidate of candidates) {
    const normalized = normalizeActionType(candidate);
    if (normalized && normalized !== "other") return normalized;
    if (normalized === "other") fallback = normalized;
  }

  const normalizedFallback = fallbackAction ? normalizeActionType(fallbackAction) : null;
  if (normalizedFallback && normalizedFallback !== "other") return normalizedFallback;
  return fallback || normalizedFallback || fallbackAction || "other";
}

export function resolveRollDetailKey(roll, actionType, message, workflowMeta) {
  if (!roll) return null;
  const detailCandidates = [];
  let rollOptions = roll?.options || {};
  if ((!rollOptions || Object.keys(rollOptions).length === 0) && typeof roll === "string") {
    try {
      const parsed = JSON.parse(roll);
      rollOptions = parsed?.options || rollOptions;
    } catch (err) {
      // ignore parse errors for non-JSON roll strings
    }
  }
  const flags = rollOptions?.flags || {};
  const dnd5eFlags = flags.dnd5e;
  if (dnd5eFlags?.skillId) detailCandidates.push(dnd5eFlags.skillId);
  if (dnd5eFlags?.abilityId) detailCandidates.push(dnd5eFlags.abilityId);
  if (dnd5eFlags?.ability) detailCandidates.push(dnd5eFlags.ability);
  if (rollOptions?.flavor) detailCandidates.push(rollOptions.flavor);
  if (message?.flavor) detailCandidates.push(message.flavor);

  const pf2eContext = workflowMeta?.pf2eContext || message?.flags?.pf2e?.context;
  if (pf2eContext) {
    const pf2eDetail = getPf2eDetailFromContext(pf2eContext, actionType);
    if (pf2eDetail) detailCandidates.push(pf2eDetail);
  }

  for (const candidate of detailCandidates) {
    if (!candidate) continue;
    const value = safeLower(normalizeDetailCandidate(candidate));
    if (["save", "saving-throw"].includes(value)) return null;
    if (actionType === "save") return value;
    if (["check", "skill", "ability"].includes(actionType)) return value;
  }
  return null;
}

export function extractAdvantageState(roll, message) {
  let rollOptions = roll?.options || {};
  if ((!rollOptions || Object.keys(rollOptions).length === 0) && typeof roll === "string") {
    try {
      const parsed = JSON.parse(roll);
      rollOptions = parsed?.options || rollOptions;
    } catch (err) {
      // ignore parse errors for non-JSON roll strings
    }
  }

  const sources = [
    rollOptions,
    rollOptions?.flags?.dnd5e?.roll,
    message?.flags?.dnd5e?.roll,
    message?.flags?.["midi-qol"]
  ];
  for (const source of sources) {
    const flagged = getAdvantageFlag(source);
    if (flagged) return flagged;
  }

  const text = [
    rollOptions?.flavor,
    message?.flavor,
    message?.content
  ].filter(Boolean).join(" ");
  return extractAdvantageFromText(text);
}

export function getPf2eDetailFromContext(context, actionType) {
  if (!context) return null;
  const check = context?.check || context?.type;
  if (actionType === "save") {
    return check?.key || check?.slug || context?.save || context?.statistic;
  }
  if (["check", "skill", "ability"].includes(actionType)) {
    return check?.key || check?.slug || context?.skill || context?.statistic;
  }
  return null;
}

export function buildPayloadsFromRolls(rolls, fallbackAction, userId, message, workflowMeta) {
  if (!Array.isArray(rolls) || !rolls.length) return [];
  const payloadsByKey = {};
  const visibility = extractVisibilityFromMessage(message, userId);
  const messageId = message?.id || message?._id || null;
  for (const roll of rolls) {
    if (!roll) continue;
    const actionType = resolveRollActionType(roll, fallbackAction);
    const detailKey = resolveRollDetailKey(roll, actionType, message, workflowMeta);
    const advantage = extractAdvantageState(roll, message);
    const payloadKey = `${actionType}|${detailKey || "all"}`;
    const payload = payloadsByKey[payloadKey] ??= buildPayloadFromRolls([], actionType, userId);
    payload.detailKey = detailKey;
    payload.advantage = mergeAdvantageState(payload.advantage, advantage);
    if (!payload.visibility && visibility) payload.visibility = visibility;
    if (!payload.messageId && messageId) payload.messageId = messageId;
    const results = buildResultCountsFromRoll(roll);
    const sequences = buildResultSequencesFromRoll(roll);
    if (Object.keys(results).length === 0 && Object.keys(sequences).length === 0) continue;
    mergeResultCounts(payload.results, results);
    mergeResultSequences(payload.sequence, sequences);
    payload.rolls += 1;
  }
  return Object.values(payloadsByKey);
}
export function getDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function pickRandom(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

export function buildFakeSessionDates(count) {
  const dates = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now);
    date.setDate(date.getDate() - i * randomInt(3, 7));
    dates.push(getDateKey(date));
  }
  return dates.reverse();
}

export function buildResultCountsFromDiceSpecs(diceSpecs) {
  const results = {};
  for (const dieSpec of diceSpecs) {
    const faces = Number(dieSpec.faces);
    if (!Number.isFinite(faces) || faces <= 0) continue;
    const dieKey = `d${faces}`;
    const dieResults = results[dieKey] ??= {};
    const count = Number(dieSpec.count) || 1;
    for (let i = 0; i < count; i += 1) {
      const value = randomInt(1, faces);
      const key = String(value);
      dieResults[key] = (dieResults[key] || 0) + 1;
    }
  }
  return results;
}

export function sanitizeDamageDiceSpecs(diceSpecs) {
  if (!Array.isArray(diceSpecs)) return [];
  return diceSpecs
    .filter((spec) => spec && Number(spec.faces) > 0)
    .map((spec) => ({ faces: Number(spec.faces), count: Number(spec.count) || 1 }));
}

export function buildFakeResultsForAction(actionType) {
  const type = actionType || pickRandom(FAKE_ACTION_TYPES);
  if (type === "damage") {
    const diceSpecs = pickRandom(FAKE_DAMAGE_DICE) || [{ faces: pickRandom(FAKE_DAMAGE_FACES), count: 1 }];
    return buildResultCountsFromDiceSpecs(diceSpecs);
  }
  if (type === "heal") {
    const diceSpecs = pickRandom(FAKE_HEAL_DICE) || [{ faces: 8, count: 1 }];
    return buildResultCountsFromDiceSpecs(diceSpecs);
  }
  const faces = type === "attack" ? pickRandom([4, 6, 8, 10, 12]) : 20;
  return buildResultCountsFromDiceSpecs([{ faces, count: 1 }]);
}

export function getNextFromList(list, stateMap, key) {
  if (!Array.isArray(list) || !list.length) return null;
  const index = stateMap[key] ?? 0;
  const value = list[index % list.length];
  stateMap[key] = index + 1;
  return value;
}

export function buildFakeDetailKey(actionType, stateMap, useRandom) {
  if (actionType === "save" || actionType === "ability" || actionType === "check") {
    return useRandom ? pickRandom(FAKE_ABILITIES) : getNextFromList(FAKE_ABILITIES, stateMap, "abilities");
  }
  if (actionType === "skill") {
    return useRandom ? pickRandom(FAKE_SKILLS) : getNextFromList(FAKE_SKILLS, stateMap, "skills");
  }
  return null;
}

export function allocateSkillsForSession(skillQueue, remainingSessions) {
  if (!Array.isArray(skillQueue) || skillQueue.length === 0) return [];
  if (remainingSessions <= 1) return skillQueue.splice(0, skillQueue.length);
  const count = Math.max(1, Math.floor(skillQueue.length / remainingSessions));
  return skillQueue.splice(0, count);
}

export function applyFakeStreaks(userStats, userDateStats, actionType, results, detailKey) {
  const sequence = buildSequenceFromResults(results);
  applyStreaksForSequence(userStats, actionType, sequence, detailKey);
  applyStreaksForSequence(userDateStats, actionType, sequence, detailKey);
}

export function generateFakeDataForUser(userId) {
  if (!userId) return null;
  const globalStats = getGlobalStats();
  globalStats.users ??= {};
  globalStats.usersByDate ??= {};
  const userStats = globalStats.users[userId] ??= createEmptyStats();
  const userDateStats = globalStats.usersByDate[userId] ??= {};
  const sessionDates = buildFakeSessionDates(FAKE_SESSION_COUNT);
  const skillQueue = shuffleArray([...FAKE_SKILLS]);
  const abilityQueue = shuffleArray([...FAKE_ABILITIES]);
  const detailState = {};
  let rollsAdded = 0;
  for (let sessionIndex = 0; sessionIndex < sessionDates.length; sessionIndex += 1) {
    const dateKey = sessionDates[sessionIndex];
    const sessionRolls = randomInt(FAKE_ROLLS_MIN, FAKE_ROLLS_MAX);
    globalStats.byDate ??= {};
    const dateStats = globalStats.byDate[dateKey] ??= createEmptyStats();
    const userDateEntry = userDateStats[dateKey] ??= createEmptyStats();
    const remainingSessions = sessionDates.length - sessionIndex;
    const sessionSkills = allocateSkillsForSession(skillQueue, remainingSessions);
    const sessionAbilities = allocateSkillsForSession(abilityQueue, remainingSessions);
    for (let i = 0; i < sessionRolls; i += 1) {
      const actionType = pickRandom(FAKE_ACTION_POOL);
      if (!actionType) continue;
      let detailKey = null;
      if (actionType === "skill" && sessionSkills.length) {
        detailKey = sessionSkills[i % sessionSkills.length];
      } else if (["save", "ability", "check"].includes(actionType) && sessionAbilities.length) {
        detailKey = sessionAbilities[i % sessionAbilities.length];
      } else {
        detailKey = buildFakeDetailKey(actionType, detailState, true);
      }
      const results = buildFakeResultsForAction(actionType);
      recordResultCounts(userStats, actionType, results, 1, detailKey);
      recordResultCounts(globalStats, actionType, results, 1, detailKey);
      recordResultCounts(dateStats, actionType, results, 1, detailKey);
      recordResultCounts(userDateEntry, actionType, results, 1, detailKey);
      applyFakeStreaks(userStats, userDateEntry, actionType, results, detailKey);
      applyFakeStreaks(globalStats, dateStats, actionType, results, detailKey);
      rollsAdded += 1;
    }
  }
  markGlobalStatsDirty();
  scheduleSave();
  scheduleSnapshotBroadcast();
  scheduleRefresh();
  return { rolls: rollsAdded, sessions: sessionDates.length };
}
export async function resetUserStats(userId) {
  const globalStats = getGlobalStats();
  if (userId === "all") {
    state.globalStats = createGlobalStats();
    await game.settings.set(MODULE_ID, "globalStats", state.globalStats);
    game.socket.emit(`module.${MODULE_ID}`, { type: "statsSnapshot", data: state.globalStats });
    scheduleRefresh();
    return;
  }
  if (!userId || !globalStats.users?.[userId]) return;
  delete globalStats.users[userId];
  delete globalStats.usersByDate?.[userId];
  const rebuilt = recomputeGlobalStats();
  state.globalStats = rebuilt;
  await game.settings.set(MODULE_ID, "globalStats", state.globalStats);
  game.socket.emit(`module.${MODULE_ID}`, { type: "statsSnapshot", data: state.globalStats });
  scheduleRefresh();
}

export async function ensureFlatted() {
  if (state.flattedPromise) return state.flattedPromise;
  state.flattedPromise = import(FLATTED_SRC);
  return state.flattedPromise;
}
