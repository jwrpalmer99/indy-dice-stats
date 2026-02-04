
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
  const rollOptions = roll?.options || {};
  if (rollOptions.type) candidates.push(rollOptions.type);
  if (rollOptions.rollType) candidates.push(rollOptions.rollType);

  const midiFlags = message?.flags?.["midi-qol"];
  if (midiFlags?.rollType) candidates.push(midiFlags.rollType);
  if (midiFlags?.type) candidates.push(midiFlags.type);
  if (midiFlags?.workflowType) candidates.push(midiFlags.workflowType);

  const pf2eFlags = message?.flags?.pf2e;
  if (pf2eFlags?.context?.type) candidates.push(pf2eFlags.context.type);
  if (pf2eFlags?.context?.action) candidates.push(pf2eFlags.context.action);
  if (pf2eFlags?.context?.origin?.type) candidates.push(pf2eFlags.context.origin.type);

  if (workflowMeta?.actionType) candidates.push(workflowMeta.actionType);

  for (const candidate of candidates) {
    const normalized = normalizeActionType(candidate);
    if (normalized) return normalized;
  }
  return normalizeActionType(rollOptions.flavor || message?.flavor || message?.content);
}

export function shouldTrackMessage(message, userId) {
  if (!message || !game.settings.get(MODULE_ID, "enabled")) return false;
  if (message.user?.id && message.user.id !== userId) return false;
  if (state.processedMessages.has(message.id)) return false;
  const flags = message.flags?.[MODULE_ID];
  if (flags?.tracked === false) return false;
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

export function collectWorkflowRolls(workflow) {
  if (!workflow) return [];
  const rolls = [];
  if (Array.isArray(workflow.rolls)) {
    rolls.push(...workflow.rolls);
  } else if (Array.isArray(workflow.rolls?.contents)) {
    rolls.push(...workflow.rolls.contents);
  }
  if (workflow.attackRoll) rolls.push(workflow.attackRoll);
  if (Array.isArray(workflow.damageRolls)) rolls.push(...workflow.damageRolls);
  if (Array.isArray(workflow.damageRolls?.contents)) rolls.push(...workflow.damageRolls.contents);
  if (workflow.damageRoll) rolls.push(workflow.damageRoll);
  if (workflow.saveRoll) rolls.push(workflow.saveRoll);
  if (Array.isArray(workflow.saves)) rolls.push(...workflow.saves);
  if (Array.isArray(workflow.saves?.contents)) rolls.push(...workflow.saves.contents);
  return rolls.filter(Boolean);
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
  return new Set(list);
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
    sequence: {}
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
  const rollType = roll.options?.type || roll.options?.rollType || roll.options?.rolltype;
  if (rollType) return normalizeActionType(rollType);
  if (roll.options?.flavor) return normalizeActionType(roll.options.flavor);
  return fallbackAction;
}

export function resolveRollDetailKey(roll, actionType, message, workflowMeta) {
  if (!roll) return null;
  const detailCandidates = [];
  const flags = roll.options?.flags || {};
  const dnd5eFlags = flags.dnd5e;
  if (dnd5eFlags?.skillId) detailCandidates.push(dnd5eFlags.skillId);
  if (dnd5eFlags?.abilityId) detailCandidates.push(dnd5eFlags.abilityId);
  if (dnd5eFlags?.ability) detailCandidates.push(dnd5eFlags.ability);
  if (roll.options?.flavor) detailCandidates.push(roll.options.flavor);
  if (message?.flavor) detailCandidates.push(message.flavor);

  const pf2eContext = workflowMeta?.pf2eContext || message?.flags?.pf2e?.context;
  if (pf2eContext) {
    const pf2eDetail = getPf2eDetailFromContext(pf2eContext, actionType);
    if (pf2eDetail) detailCandidates.push(pf2eDetail);
  }

  for (const candidate of detailCandidates) {
    if (!candidate) continue;
    const value = safeLower(String(candidate));
    if (["save", "saving-throw"].includes(value)) return null;
    if (actionType === "save") return value;
    if (["check", "skill", "ability"].includes(actionType)) return value;
  }
  return null;
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
  for (const roll of rolls) {
    if (!roll) continue;
    const actionType = resolveRollActionType(roll, fallbackAction);
    const detailKey = resolveRollDetailKey(roll, actionType, message, workflowMeta);
    const payloadKey = `${actionType}|${detailKey || "all"}`;
    const payload = payloadsByKey[payloadKey] ??= buildPayloadFromRolls([], actionType, userId);
    payload.detailKey = detailKey;
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
