import {
  ACTION_LABELS,
  ACTION_ORDER,
  CHART_JS_SRC,
  FAKE_ROLLS_MAX,
  FAKE_ROLLS_MIN,
  FAKE_SESSION_COUNT,
  MODULE_ID
} from "./ids-constants.js";
import { getUiState, scheduleUiStateSave, state } from "./ids-state.js";
import {
  createEmptyStats,
  ensureFlatted,
  generateFakeDataForUser,
  getStreakFilterKey,
  getDateKey,
  getGlobalStats,
  getHiddenUserIds,
  getUserStats,
  getVisibleSessionDates,
  mergeStats,
  normalizeStats,
  resetUserStats
} from "./ids-data.js";
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

    this._renderSummary(root, scopedStats, dieFilter, actionFilter, detailFilter);
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
    let subtitle = "";
    const hasDetailAction = ["save", "skill", "check", "ability"].includes(actionFilter);
    const scopedStats = actionFilter === "all" ? stats : buildScopedStats(stats, actionFilter);
    let clickMode = null;
    let clickKeys = [];

    if (actionFilter === "all") {
      const actions = stats.actions || {};
      const sortedActions = Object.keys(actions).sort(sortActionKeys);
      const entries = sortedActions.map((key) => ({
        key,
        label: ACTION_LABELS[key] || key,
        value: Number(actions[key]?.dice?.[dieFilter]?.count) || 0
      }));
      const filtered = entries.filter((entry) => entry.value > 0);
      labels = filtered.map((entry) => entry.label);
      values = filtered.map((entry) => entry.value);
      clickKeys = filtered.map((entry) => entry.key);
      clickMode = "action";
      title = `Actions (${dieFilter.toUpperCase()})`;
    } else if (hasDetailAction && detailFilter === "all") {
      const details = stats.actions?.[actionFilter]?.details || {};
      const detailKeys = Object.keys(details).sort();
      const entries = detailKeys.map((key) => ({
        key,
        label: formatDetailLabel(key),
        value: Number(details[key]?.count) || 0
      }));
      labels = entries.map((entry) => entry.label);
      values = entries.map((entry) => entry.value);
      clickKeys = entries.map((entry) => entry.key);
      clickMode = "detail";
      title = `${ACTION_LABELS[actionFilter] || actionFilter} Type`;
    } else {
      const diceKeys = Object.keys(scopedStats.dice || {}).sort(sortDiceKeys);
      labels = diceKeys.map((key) => key.toUpperCase());
      values = diceKeys.map((key) => Number(scopedStats.dice[key]?.count) || 0);
      clickKeys = [...diceKeys];
      clickMode = "die";
      title = `Dice Mix (${ACTION_LABELS[actionFilter] || actionFilter})`;
    }

    const actionLabel = actionFilter === "all" ? "All Actions" : (ACTION_LABELS[actionFilter] || actionFilter);
    const detailLabel = detailFilter && detailFilter !== "all" ? formatDetailLabel(detailFilter) : "";
    const distributionContext = actionFilter === "all"
      ? ""
      : (detailLabel ? `${actionLabel}: ${detailLabel}` : actionLabel);

    if (!hasDetailAction && labels.length <= 1 && detailFilter === "all") {
      const fallbackDie = clickMode === "die" && clickKeys.length === 1 ? clickKeys[0] : dieFilter;
      const dieStats = scopedStats.dice?.[fallbackDie];
      const faces = Number(String(fallbackDie).replace(/\D/g, ""));
      if (Number.isFinite(faces) && faces > 0 && dieStats?.results) {
        labels = Array.from({ length: faces }, (_, i) => String(i + 1));
        values = labels.map((label) => Number(dieStats.results?.[label]) || 0);
        title = distributionContext
          ? `${distributionContext} (${fallbackDie.toUpperCase()})`
          : `Distribution (${fallbackDie.toUpperCase()})`;
        clickKeys = [];
        clickMode = null;
      }
    }

    const entries = labels.map((label, index) => ({
      label,
      value: Number(values[index]) || 0,
      key: clickKeys[index]
    }));
    const nonZero = entries.filter((entry) => entry.value > 0);
    if (nonZero.length) {
      labels = nonZero.map((entry) => entry.label);
      values = nonZero.map((entry) => entry.value);
      clickKeys = nonZero.map((entry) => entry.key).filter((key) => !!key);
    }

    const hasData = values.some((value) => Number(value) > 0);
    if (clickMode === "die" && clickKeys.length === 1) {
      const fallbackDie = clickKeys[0];
      const dieStats = scopedStats.dice?.[fallbackDie];
      const faces = Number(String(fallbackDie).replace(/\D/g, ""));
      if (Number.isFinite(faces) && faces > 0 && dieStats?.results) {
        labels = Array.from({ length: faces }, (_, i) => String(i + 1));
        values = labels.map((label) => Number(dieStats.results?.[label]) || 0);
        title = distributionContext
          ? `${distributionContext} (${fallbackDie.toUpperCase()})`
          : `Distribution (${fallbackDie.toUpperCase()})`;
        clickKeys = [];
        clickMode = null;
      }
    }
    if (!hasData) {
      labels = ["No data"];
      values = [1];
      subtitle = "No data for current filters";
      clickMode = null;
      clickKeys = [];
    }

    const dataKey = JSON.stringify({ labels, values, actionFilter, dieFilter, detailFilter });
    if (this._chartState.breakdownKey === dataKey && this._charts.breakdown) return;
    this._chartState.breakdownKey = dataKey;

    this._destroyChart("breakdown");

    const palette = hasData ? buildPalette(values.length) : ["rgba(60, 70, 80, 0.25)"];

    const legendColor = getChartTickColor();
    const titleColor = getChartTitleColor();

    const app = this;
    canvas.oncontextmenu = (event) => {
      event.preventDefault();
      const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
      if (!scope) return;
      const actionSelect = scope.querySelector("select[data-filter='action']");
      const detailSelect = scope.querySelector("select[data-filter='detail']");
      if (!actionSelect || !detailSelect) return;
      if (hasDetailAction && detailFilter !== "all") {
        detailSelect.value = "all";
        app._refreshCharts({ persistFilters: true });
        return;
      }
      if (actionFilter !== "all") {
        actionSelect.value = "all";
        detailSelect.value = "all";
        app._refreshCharts({ persistFilters: true });
      }
    };
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
        onClick: (event, elements) => {
          if (!elements?.length || !hasData || !clickMode) return;
          const index = elements[0].index;
          const key = clickKeys[index];
          if (!key) return;
          const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
          if (!scope) return;
          const actionSelect = scope.querySelector("select[data-filter='action']");
          const detailSelect = scope.querySelector("select[data-filter='detail']");
          if (clickMode === "action" && actionSelect) {
            actionSelect.value = key;
            if (detailSelect) detailSelect.value = "all";
            app._refreshCharts({ persistFilters: true });
          } else if (clickMode === "detail" && detailSelect) {
            detailSelect.value = key;
            app._refreshCharts({ persistFilters: true });
          } else if (clickMode === "die") {
            const dieSelect = scope.querySelector("select[data-filter='die']");
            if (!dieSelect) return;
            dieSelect.value = key;
            app._refreshCharts({ persistFilters: true });
          }
        },
        plugins: {
          legend: {
            position: "bottom",
            labels: { boxWidth: 14, color: legendColor },
            display: hasData
          },
          title: {
            display: true,
            text: title,
            color: titleColor,
            font: { size: 16, family: "Fraunces" }
          },
          subtitle: {
            display: !!subtitle,
            text: subtitle,
            color: titleColor,
            font: { size: 12, family: "Fraunces", style: "normal" }
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

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (!src) {
      reject(new Error("Missing script source."));
      return;
    }
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function ensureChartJs() {
  if (globalThis.Chart) {
    ensureChartPlugins();
    return globalThis.Chart;
  }
  if (!state.chartPromise) {
    state.chartPromise = loadScript(CHART_JS_SRC).then(() => {
      if (!globalThis.Chart) throw new Error("Chart.js not available after load.");
      ensureChartPlugins();
      return globalThis.Chart;
    });
  }
  return state.chartPromise;
}

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

export {
  DiceStatsApp,
  DiceStatsResetApp,
  DiceStatsVisibilityApp,
  DiceStatsFakerApp,
  refreshOpenDashboards,
  watchThemeChanges
};
