import { ACTION_LABELS, ACTION_ORDER, MODULE_ID } from "./ids-constants.js";
import {
  createEmptyStats,
  getDateKey,
  getStreakFilterKey,
  mergeStats,
  normalizeStats
} from "./ids-data.js";

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
    ?? document.querySelector(`#${MODULE_ID}`)?.querySelector(selector);
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

function applyFontSettings(scope) {
  const fontBody = game.settings.get(MODULE_ID, "fontBody");
  const fontTitle = game.settings.get(MODULE_ID, "fontTitle");
  const targets = [];
  if (scope) {
    const host = scope.closest?.(".indy-dice-stats, .indy-dice-stats-reset, .indy-dice-stats-visibility, .indy-dice-stats-faker")
      || scope.querySelector?.(".indy-dice-stats, .indy-dice-stats-reset, .indy-dice-stats-visibility, .indy-dice-stats-faker");
    if (host) targets.push(host);
  }
  if (targets.length === 0) {
    targets.push(...document.querySelectorAll(
      ".indy-dice-stats, .indy-dice-stats-reset, .indy-dice-stats-visibility, .indy-dice-stats-faker"
    ));
  }
  for (const target of targets) {
    if (fontBody) target.style.setProperty("--ids-font-body", fontBody);
    if (fontTitle) target.style.setProperty("--ids-font-title", fontTitle);
  }
}

export {
  applyFontSettings,
  applyDetailFilter,
  buildCompareStats,
  buildDetailOptions,
  buildGradient,
  buildHeatmapColor,
  buildPalette,
  buildScopedStats,
  buildStreakSource,
  computeDieSummary,
  computeQuantileFromResults,
  formatDetailLabel,
  formatNumber,
  getChartGridColor,
  getChartTickColor,
  getChartTitleColor,
  getFilteredStats,
  getMostFrequentAction,
  getMultiSelectValues,
  getAllSessionStats,
  getStatsForSession,
  getStreakEntryForFilters,
  readCssNumber,
  setText,
  sortActionKeys,
  sortDiceKeys,
  toPascalCase,
  updateHeatmapCellSize
};

