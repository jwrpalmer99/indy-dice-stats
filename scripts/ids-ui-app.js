import { ACTION_LABELS, MODULE_ID } from "./ids-constants.js";
import { getUiState, scheduleUiStateSave, state } from "./ids-state.js";
import {
  getDateKey,
  getGlobalStats,
  getHiddenUserIds,
  getUserStats,
  getVisibleSessionDates,
  normalizeStats
} from "./ids-data.js";
import {
  applyDetailFilter,
  buildCompareStats,
  buildDetailOptions,
  buildGradient,
  buildPalette,
  buildScopedStats,
  buildStreakSource,
  buildHeatmapColor,
  applyFontSettings,
  computeDieSummary,
  formatDetailLabel,
  formatNumber,
  getChartGridColor,
  getChartTickColor,
  getChartTitleColor,
  getFilteredStats,
  getMostFrequentAction,
  getMultiSelectValues,
  getAllSessionStats,
  getStreakEntryForFilters,
  getStatsForSession,
  readCssNumber,
  setText,
  sortActionKeys,
  sortDiceKeys,
  toPascalCase,
  updateHeatmapCellSize
} from "./ids-ui-helpers.js";
import {
  ensureChartJs,
  destroyChart,
  renderBreakdownChart,
  renderDistributionChart,
  renderTrendChart
} from "./ids-ui-charts.js";
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
    const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
    applyFontSettings(scope);
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
    this._renderLatestRoll(root);
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
    const filteredStats = actionFilter === "all" ? filteredBaseStats : buildScopedStats(filteredBaseStats, actionFilter);
    const filteredScopedStats = applyDetailFilter(filteredStats, actionFilter, detailFilter);
    const selectedStats = actionFilter === "all" ? baseStats : buildScopedStats(baseStats, actionFilter);
    const selectedScopedStats = applyDetailFilter(selectedStats, actionFilter, detailFilter);

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

    this._renderSummary(root, selectedScopedStats, dieFilter, actionFilter, detailFilter);
    this._renderTable(root, selectedScopedStats, actionFilter, detailFilter, streakSource);
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
        this._renderDistributionChart(root, filteredScopedStats, dieFilter, compareStats, normalize);
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
        { value: "all", label: "All Players" },
        ...visibleUsers.map((user) => ({ value: user.id, label: user.name }))
      ];
      const fallback = game.user?.isGM
        ? "all"
        : (game.user?.id || options[0]?.value);
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

  _renderSummary(root, stats, dieKey, actionFilter, detailFilter) {
    const totalDice = stats.totals?.dice || 0;
    const dieStats = stats.dice?.[dieKey];
    const filteredDice = dieStats?.count || 0;
    const avg = dieStats && dieStats.count ? dieStats.sum / dieStats.count : 0;

    setText(root, "[data-stat-label='filtered-dice']", `Filtered Dice (${dieKey.toUpperCase()})`);
    setText(root, "[data-stat='total-dice']", formatNumber(totalDice));
    setText(root, "[data-stat='filtered-dice']", formatNumber(filteredDice));
    setText(root, "[data-stat='die-average']", avg ? avg.toFixed(2) : "-");

    const topLabelEl = root.querySelector("[data-stat-label='top-action']");
    if (actionFilter === "all") {
      const mostAction = getMostFrequentAction(stats.actions || {});
      if (topLabelEl) topLabelEl.textContent = "Top Action";
      setText(root, "[data-stat='top-action']", mostAction ? ACTION_LABELS[mostAction] || mostAction : "-");
      return;
    }

    const hasDetailAction = ["save", "skill", "check", "ability"].includes(actionFilter);
    if (hasDetailAction && detailFilter === "all") {
      const actionStats = stats.actions?.[actionFilter];
      const details = actionStats?.details || {};
      let topDetail = null;
      let topValue = -1;
      for (const [key, detailStats] of Object.entries(details)) {
        const value = Number(detailStats?.count ?? detailStats?.rolls ?? 0);
        if (value > topValue) {
          topValue = value;
          topDetail = key;
        }
      }
      if (topLabelEl) topLabelEl.textContent = "Top Type";
      setText(root, "[data-stat='top-action']", topDetail ? formatDetailLabel(topDetail) : "-");
      return;
    }

    let topRoll = null;
    let topCount = -1;
    for (const [face, count] of Object.entries(dieStats?.results || {})) {
      const value = Number(count) || 0;
      if (value > topCount) {
        topCount = value;
        topRoll = face;
      }
    }
    if (topLabelEl) topLabelEl.textContent = "Top Roll";
    setText(root, "[data-stat='top-action']", topRoll ?? "-");
  }

  _renderLatestRoll(root) {
    const container = root.querySelector("[data-live-roll]");
    if (!container) return;
    const defaultView = container.querySelector("[data-live-roll-default]");
    const liveView = container.querySelector("[data-live-roll-live]");
    if (!defaultView || !liveView) return;

    if (!game.settings.get(MODULE_ID, "showLatestRoll")) {
      liveView.hidden = true;
      defaultView.hidden = false;
      return;
    }

    const onlyMonitorD20 = game.settings.get(MODULE_ID, "onlyMonitorD20");
    const candidateRoll = onlyMonitorD20 ? state.latestD20Roll : state.latestRoll;
    const latestRoll = this._isLatestRollVisible(candidateRoll) ? candidateRoll : null;
    if (!latestRoll) {
      liveView.hidden = true;
      defaultView.hidden = false;
      return;
    }
    liveView.hidden = false;
    defaultView.hidden = true;

    const userEl = liveView.querySelector("[data-live-roll-user]");
    if (userEl) {
      const userName = latestRoll.userName
        || (latestRoll.userId ? game.users.get(latestRoll.userId)?.name : null)
        || "Unknown";
      userEl.textContent = userName;
    }

    const privacyEl = liveView.querySelector("[data-live-roll-privacy]");
    if (privacyEl) {
      const privacyLabel = this._getLatestRollPrivacyLabel(latestRoll);
      privacyEl.textContent = privacyLabel ? `(${privacyLabel})` : "";
    }

    const detailEl = liveView.querySelector("[data-live-roll-details]");
    if (!detailEl) return;
    detailEl.replaceChildren();

    const fragment = document.createDocumentFragment();
    const actionLabel = this._formatLatestRollAction(latestRoll);
    if (actionLabel) {
      const actionSpan = document.createElement("span");
      actionSpan.className = "ids-roll-action";
      actionSpan.textContent = actionLabel;
      fragment.appendChild(actionSpan);
    }
    if (latestRoll.advantage) {
      const advSpan = document.createElement("span");
      const isDis = latestRoll.advantage === "disadvantage";
      advSpan.className = `ids-roll-advantage ${isDis ? "ids-roll-advantage--dis" : "ids-roll-advantage--adv"}`;
      advSpan.textContent = isDis ? "Disadvantage" : "Advantage";
      fragment.appendChild(advSpan);
    }

    const diceEntries = this._getLatestRollDiceEntries(latestRoll);
    if (diceEntries.length === 0) {
      const emptySpan = document.createElement("span");
      emptySpan.className = "ids-roll-empty";
      emptySpan.textContent = "No dice results";
      fragment.appendChild(emptySpan);
    } else {
      for (const entry of diceEntries) {
        fragment.appendChild(this._buildLatestRollDieNode(entry.dieKey, entry.values, latestRoll.advantage));
      }
    }

    detailEl.appendChild(fragment);
  }

  _formatLatestRollAction(latestRoll) {
    if (!latestRoll) return "";
    const actionType = latestRoll.actionType || "other";
    const baseLabel = ACTION_LABELS[actionType] || toPascalCase(actionType);
    const trimmedBase = baseLabel.replace(/\s*Rolls$/i, "");
    const detailKey = latestRoll.detailKey;
    if (detailKey && ["save", "skill", "check", "ability"].includes(actionType)) {
      let detailLabel = formatDetailLabel(detailKey);
      const lower = detailLabel.toLowerCase();
      if (!/(save|skill|check)/.test(lower)) {
        const suffix = actionType === "save" ? "Save" : actionType === "skill" ? "Skill" : "Check";
        detailLabel = `${detailLabel} ${suffix}`;
      }
      return detailLabel;
    }
    return trimmedBase || "Roll";
  }

  _getLatestRollDiceEntries(latestRoll) {
    const entries = [];
    if (!latestRoll) return entries;
    const sequence = latestRoll.sequence || {};
    const results = latestRoll.results || {};
    let hasSequence = false;
    for (const list of Object.values(sequence)) {
      if (Array.isArray(list) && list.length) {
        hasSequence = true;
        break;
      }
    }
    if (hasSequence) {
      for (const [dieKey, list] of Object.entries(sequence)) {
        if (!Array.isArray(list) || list.length === 0) continue;
        const values = list.map((value) => Number(value)).filter((value) => Number.isFinite(value));
        if (values.length) entries.push({ dieKey, values });
      }
    } else {
      for (const [dieKey, faces] of Object.entries(results)) {
        if (!faces || typeof faces !== "object") continue;
        const values = [];
        const ordered = Object.entries(faces)
          .map(([face, count]) => ({ face: Number(face), count: Number(count) || 0 }))
          .filter((entry) => Number.isFinite(entry.face) && entry.count > 0)
          .sort((a, b) => a.face - b.face);
        for (const entry of ordered) {
          for (let i = 0; i < entry.count; i += 1) {
            values.push(entry.face);
          }
        }
        if (values.length) entries.push({ dieKey, values });
      }
    }
    entries.sort((a, b) => sortDiceKeys(a.dieKey, b.dieKey));
    return entries;
  }

  _buildLatestRollDieNode(dieKey, values, advantage) {
    const wrapper = document.createElement("span");
    wrapper.className = "ids-roll-die";
    const label = document.createElement("span");
    label.className = "ids-roll-die-label";
    label.textContent = String(dieKey || "").toUpperCase();
    wrapper.appendChild(label);

    const results = document.createElement("span");
    results.className = "ids-roll-results";
    const isD20 = String(dieKey).toLowerCase() === "d20";
    let finalValue = null;
    if (isD20 && Array.isArray(values) && values.length) {
      if (advantage === "advantage") {
        finalValue = Math.max(...values);
        wrapper.classList.add("ids-roll-die--adv");
      } else if (advantage === "disadvantage") {
        finalValue = Math.min(...values);
      } else {
        finalValue = values[values.length - 1];
      }
      if (finalValue === 20) wrapper.classList.add("ids-roll-die--crit");
      if (finalValue === 1) wrapper.classList.add("ids-roll-die--fail");
    }
    for (const value of values) {
      const resultEl = document.createElement("span");
      resultEl.className = "ids-roll-result";
      if (isD20 && value === 20) resultEl.classList.add("ids-roll-result--crit");
      if (isD20 && value === 1) resultEl.classList.add("ids-roll-result--fail");
      resultEl.textContent = String(value);
      results.appendChild(resultEl);
    }
    wrapper.appendChild(results);
    return wrapper;
  }

  _getLatestRollPrivacyLabel(latestRoll) {
    if (!latestRoll) return "";
    const visibility = latestRoll.visibility;
    if (!visibility) return "";
    const mode = String(visibility.rollMode || "").toLowerCase();
    if (mode.includes("blind")) return "Blind";
    if (mode.includes("gm")) return "Private";
    if (mode.includes("self")) return "Self";
    return "";
  }

  _isLatestRollVisible(latestRoll) {
    if (!latestRoll) return false;
    const visibility = latestRoll.visibility;
    if (!visibility) return true;
    const user = game.user;
    const userId = user?.id;
    const isGM = !!user?.isGM;
    const allowPlayersSeeGmStats = game.settings.get(MODULE_ID, "allowPlayersSeeGmStats");
    if (!allowPlayersSeeGmStats && !isGM) {
      const gmSourceId = latestRoll.userId || visibility.authorId || visibility.userId;
      if (gmSourceId && game.users?.get?.(gmSourceId)?.isGM) return false;
    }
    if (visibility.blind) return isGM;
    const whisper = Array.isArray(visibility.whisper) ? visibility.whisper : [];
    if (whisper.length) {
      return !!userId && whisper.includes(userId);
    }
    const mode = String(visibility.rollMode || "").toLowerCase();
    if (mode.includes("self")) {
      return !!userId && (userId === visibility.authorId || userId === visibility.userId);
    }
    if (mode.includes("blind")) {
      return isGM;
    }
    if (mode.includes("gm")) {
      return isGM || (!!userId && (userId === visibility.authorId || userId === visibility.userId));
    }
    return true;
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
    renderDistributionChart(this, root, stats, dieKey, compareStats, normalize);
  }

  _renderTrendChart(root, globalStats, userId, compareIds, actionFilter, detailFilter, dieKey, showCandles) {
    renderTrendChart(this, root, globalStats, userId, compareIds, actionFilter, detailFilter, dieKey, showCandles);
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
        html += `<td class=\"ids-heatmap__cell ids-heatmap__cell--animate\" data-date=\"${dateLabel}\" title=\"${title}\" style=\"background-color: ${color}; --ids-heatmap-delay: ${delay}ms;\"></td>`;
        cellIndex += 1;
      });
      html += "</tr>";
    }

    html += "</tbody></table></div>";
    container.innerHTML = html;

    if (!this._heatmapClickBound) {
      this._heatmapClickBound = true;
      container.addEventListener("click", (event) => {
        const cell = event.target?.closest?.(".ids-heatmap__cell");
        const dateKey = cell?.dataset?.date;
        if (!dateKey) return;
        const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
        if (!scope) return;
        const sessionSelect = scope.querySelector("select[data-filter='session']");
        if (!sessionSelect) return;
        sessionSelect.value = dateKey;
        this._refreshCharts({ persistFilters: true });
      });
      container.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const scope = this.window?.content ?? this.element ?? document.getElementById(this.id);
        if (!scope) return;
        const sessionSelect = scope.querySelector("select[data-filter='session']");
        if (!sessionSelect) return;
        if (sessionSelect.value !== "all") {
          sessionSelect.value = "all";
          this._refreshCharts({ persistFilters: true });
        }
      });
    }

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
    renderBreakdownChart(this, root, stats, actionFilter, dieFilter, detailFilter);
  }

  _destroyChart(key) {
    destroyChart(this, key);
  }
}


export { DiceStatsApp };



