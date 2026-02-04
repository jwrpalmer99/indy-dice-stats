import { MODULE_ID } from "./ids-constants.js";

export const state = {
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

export function debounce(fn, waitMs) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}

export function getUiState() {
  return game.settings.get(MODULE_ID, "uiState") || {};
}

export function scheduleUiStateSave(partialState) {
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
