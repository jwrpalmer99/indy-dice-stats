import { ACTION_LABELS, CHART_JS_SRC } from "./ids-constants.js";
import { state } from "./ids-state.js";
import {
  computeDieSummary,
  formatDetailLabel,
  getChartGridColor,
  getChartTickColor,
  getChartTitleColor,
  getFilteredStats,
  sortActionKeys,
  sortDiceKeys,
  buildGradient,
  buildPalette,
  buildScopedStats
} from "./ids-ui-helpers.js";
import { getHiddenUserIds, normalizeStats } from "./ids-data.js";
import { getAllSessionStats } from "./ids-ui-helpers.js";

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

function destroyChart(app, key) {
  if (app._charts?.[key]) {
    app._charts[key].destroy();
    delete app._charts[key];
  }
}

function getBodyScale(root, app) {
  const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
  const host = scope?.closest?.(".indy-dice-stats") || scope?.querySelector?.(".indy-dice-stats") || document.body;
  const computed = getComputedStyle(host);
  return Number.parseFloat(computed.getPropertyValue("--ids-font-body-scale")) || 1;
}

function getLegendScale(root, app) {
  const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
  const host = scope?.closest?.(".indy-dice-stats") || scope?.querySelector?.(".indy-dice-stats") || document.body;
  const computed = getComputedStyle(host);
  return Number.parseFloat(computed.getPropertyValue("--ids-chart-legend-scale")) || 1;
}

function renderDistributionChart(app, root, stats, dieKey, compareStats, normalize) {
  const canvas = root.querySelector("canvas[data-chart='distribution']");
  if (!canvas) return;

  const faces = Number(String(dieKey).replace(/\D/g, ""));
  const labels = Number.isFinite(faces) && faces > 0 ? Array.from({ length: faces }, (_, i) => String(i + 1)) : [];

  const context = canvas.getContext("2d");
  if (!context) return;

  destroyChart(app, "distribution");

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


  const bodyScale = getBodyScale(root, app);
  const legendScale = getLegendScale(root, app);
  const gridColor = getChartGridColor();
  const tickColor = getChartTickColor();
  const titleColor = getChartTitleColor();
  const titleSuffix = normalize ? " (Normalized)" : "";
  const maxCeil = normalize && Number.isFinite(yMax) ? Math.ceil(yMax) : undefined;

  app._charts.distribution = new Chart(context, {
    type: "bar",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
          x: {
            grid: { display: false },
            ticks: { color: tickColor, font: { size: 11 * bodyScale * legendScale } }
          },
          y: {
            grid: { color: gridColor },
            ticks: {
              color: tickColor,
              callback: normalize ? (value) => `${value}%` : undefined,
              font: { size: 11 * bodyScale * legendScale }
            },
            max: maxCeil
          }
        },
        plugins: {
          legend: {
            display: !!compareStats,
            position: "bottom",
            labels: { color: tickColor, font: { size: 11 * bodyScale * legendScale } }
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

function renderTrendChart(app, root, globalStats, userId, compareIds, actionFilter, detailFilter, dieKey, showCandles) {
  const canvas = root.querySelector("canvas[data-chart='distribution']");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  destroyChart(app, "distribution");

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

  const bodyScale = getBodyScale(root, app);
  const legendScale = getLegendScale(root, app);
  const gridColor = getChartGridColor();
  const tickColor = getChartTickColor();
  const faces = Number(String(dieKey).replace(/\D/g, ""));
  const yMin = Number.isFinite(faces) && faces > 0 ? 1 : undefined;
  const yMax = Number.isFinite(faces) && faces > 0 ? faces : undefined;

  const showCandlesFlag = !!showCandles;

  canvas.oncontextmenu = (event) => {
    event.preventDefault();
    const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
    if (!scope) return;
    const sessionSelect = scope.querySelector("select[data-filter='session']");
    if (!sessionSelect) return;
    if (sessionSelect.value !== "all") {
      sessionSelect.value = "all";
      app._refreshCharts({ persistFilters: true });
    }
  };

  app._charts.distribution = new Chart(context, {
    type: "line",
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (event, elements) => {
        if (!elements?.length) return;
        const index = elements[0].index;
        const dateKey = labels[index];
        if (!dateKey) return;
        const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
        if (!scope) return;
        const sessionSelect = scope.querySelector("select[data-filter='session']");
        if (!sessionSelect) return;
        sessionSelect.value = dateKey;
        app._refreshCharts({ persistFilters: true });
      },
      interaction: { mode: "index", intersect: false },
      scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: tickColor,
              maxTicksLimit: 10,
              font: { size: 11 * bodyScale * legendScale }
            },
            offset: true
          },
          y: {
            grid: { color: gridColor },
            ticks: { color: tickColor, font: { size: 11 * bodyScale * legendScale } },
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
            labels: { color: tickColor, font: { size: 11 * bodyScale * legendScale } }
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

function renderBreakdownChart(app, root, stats, actionFilter, dieFilter, detailFilter) {
  const canvas = root.querySelector("canvas[data-chart='breakdown']");
  if (!canvas) return;
  const context = canvas.getContext("2d");
  if (!context) return;
  const scope = root ?? app.window?.content ?? app.element ?? document.getElementById(app.id);
  const host = scope?.closest?.(".indy-dice-stats") || scope?.querySelector?.(".indy-dice-stats") || document.body;
  const computed = getComputedStyle(host);
  const bodyFont = computed.getPropertyValue("--ids-font-body").trim() || "Manrope";
  const bodyScale = Number.parseFloat(computed.getPropertyValue("--ids-font-body-scale")) || 1;
  const legendScale = Number.parseFloat(computed.getPropertyValue("--ids-chart-legend-scale")) || 1;

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
  if (app._chartState?.breakdownKey === dataKey && app._charts?.breakdown) return;
  app._chartState.breakdownKey = dataKey;

  destroyChart(app, "breakdown");

  const palette = hasData ? buildPalette(values.length) : ["rgba(60, 70, 80, 0.25)"];

  const mutedColor = computed.getPropertyValue("--ids-muted").trim() || getChartTickColor();
  const legendColor = getChartTickColor();
  const titleColor = mutedColor;

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
  app._charts.breakdown = new Chart(context, {
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
          labels: { boxWidth: 14, color: legendColor, font: { size: 11 * bodyScale * legendScale } },
          display: hasData
        },
        title: {
          display: true,
          text: title.toUpperCase(),
          color: titleColor,
          font: { size: 12 * bodyScale, family: bodyFont, weight: "600" }
        },
        subtitle: {
          display: !!subtitle,
          text: subtitle,
          color: titleColor,
          font: { size: 11 * bodyScale, family: bodyFont, style: "normal", weight: "400" }
        }
      }
    }
  });
}

export {
  ensureChartJs,
  destroyChart,
  renderDistributionChart,
  renderTrendChart,
  renderBreakdownChart
};
