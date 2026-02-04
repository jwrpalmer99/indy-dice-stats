import { state } from "./ids-state.js";
import { DiceStatsApp } from "./ids-ui-app.js";

function refreshOpenDashboards(options = {}) {
  const windows = Object.values(ui.windows ?? {});
  for (const app of windows) {
    if (app instanceof DiceStatsApp) app._refreshCharts(options);
  }
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    if (app instanceof DiceStatsApp) app._refreshCharts(options);
  }
}

function refreshLatestRolls() {
  const windows = Object.values(ui.windows ?? {});
  for (const app of windows) {
    if (app instanceof DiceStatsApp) {
      const root = app._getRootElement?.();
      if (root) app._renderLatestRoll(root);
    }
  }
  for (const app of foundry.applications.instances?.values?.() ?? []) {
    if (app instanceof DiceStatsApp) {
      const root = app._getRootElement?.();
      if (root) app._renderLatestRoll(root);
    }
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

export { refreshLatestRolls, refreshOpenDashboards, watchThemeChanges };
