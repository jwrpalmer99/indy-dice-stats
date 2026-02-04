import { MODULE_ID } from "./ids-constants.js";
import { state } from "./ids-state.js";
import {
  buildPayloadsFromRolls,
  collectWorkflowRolls,
  createGlobalStats,
  createLatestRollEntryFromPayloads,
  extractActionType,
  getGlobalStats,
  getRollsFromMessage,
  handleRollPayloadsLocally,
  isBlindGmRollMessage,
  isGmPrivateRollMessage,
  isSelfRollMessage,
  markMessageProcessed,
  normalizeActionType,
  normalizeGlobalStats,
  normalizeLatestRoll,
  resetUserStats,
  resolveUserIdFromMessage,
  resolveUserIdFromWorkflow,
  scheduleRefresh,
  setLatestRoll,
  shouldTrackMessage,
  getUserStats
} from "./ids-data.js";
import {
  DiceStatsApp,
  DiceStatsMonitorApp,
  DiceStatsResetApp,
  DiceStatsVisibilityApp,
  DiceStatsFakerApp,
  refreshLatestRolls,
  refreshOpenDashboards,
  watchThemeChanges
} from "./ids-ui.js";

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

  game.settings.register(MODULE_ID, "recordSelfRolls", {
    name: "Record Self Rolls",
    hint: "Record self-only rolls (private) in the dice stats.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "recordGmPrivateRolls", {
    name: "Record Private GM Rolls",
    hint: "Record GM private rolls (gmroll) in the dice stats.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "recordGmBlindRolls", {
    name: "Record Blind GM Rolls",
    hint: "Record GM blind rolls (blindroll) in the dice stats.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "allowPlayersSeeGmStats", {
    name: "Allow Players to See GM Stats",
    hint: "Allow non-GM users to include GM stats in player lists and All Players views.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: false })
  });

  game.settings.register(MODULE_ID, "showLatestRoll", {
    name: "Show Latest Roll",
    hint: "Display the latest roll in the title area of the dashboard.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: false })
  });

  game.settings.register(MODULE_ID, "onlyMonitorD20", {
    name: "Only Monitor d20",
    hint: "Only update the title area when a roll includes a d20.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: false })
  });

  game.settings.register(MODULE_ID, "debugMidiQOL", {
    name: "Debug Midi-QOL Roll Capture",
    hint: "Log Midi-QOL roll sources and deduping details to the console.",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "rollProcessingDelayMs", {
    name: "Roll Processing Delay (ms)",
    hint: "Delay processing chat and Midi-QOL rolls to allow dice animations to finish.",
    scope: "world",
    config: true,
    type: Number,
    range: {
      min: 0,
      max: 5000,
      step: 100
    },
    default: 2000
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

  game.settings.register(MODULE_ID, "monitorPosition", {
    name: "Indy Dice Stats Monitor Position",
    scope: "client",
    config: false,
    type: Object,
    default: { left: 120, top: 120 }
  });

  const defaultBody = "\"Manrope\", \"Segoe UI\", sans-serif";
  const defaultTitle = "\"Fraunces\", \"Georgia\", serif";

  game.settings.register(MODULE_ID, "fontBody", {
    name: "Body Font",
    hint: "Font used for general text in the module.",
    scope: "client",
    config: true,
    type: String,
    choices: {},
    default: defaultBody,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: true })
  });

  game.settings.register(MODULE_ID, "fontTitle", {
    name: "Title Font",
    hint: "Font used for titles and large numbers.",
    scope: "client",
    config: true,
    type: String,
    choices: {},
    default: defaultTitle,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: true })
  });

  game.settings.register(MODULE_ID, "fontBodyScale", {
    name: "Body Font Scale",
    hint: "Multiplier applied to body font sizes (e.g. 1.1 = 10% larger).",
    scope: "client",
    config: true,
    type: Number,
    range: {
      min: 0.8,
      max: 1.6,
      step: 0.05
    },
    default: 1,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: true })
  });

  game.settings.register(MODULE_ID, "fontTitleScale", {
    name: "Title Font Scale",
    hint: "Multiplier applied to title/number font sizes.",
    scope: "client",
    config: true,
    type: Number,
    range: {
      min: 0.8,
      max: 1.6,
      step: 0.05
    },
    default: 1,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: true })
  });

  game.settings.register(MODULE_ID, "chartLegendScale", {
    name: "Chart Legend Font Scale",
    hint: "Multiplier applied to chart legend and axis label sizes.",
    scope: "client",
    config: true,
    type: Number,
    range: {
      min: 0.8,
      max: 1.6,
      step: 0.05
    },
    default: 1,
    onChange: () => refreshOpenDashboards({ forceThemeRefresh: true })
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
    if (message.type === "latestRoll") {
      if (message.senderId && message.senderId === game.user?.id) return;
      const latest = normalizeLatestRoll(message.data);
      if (!latest) return;
      setLatestRoll(latest);
      refreshLatestRolls();
      return;
    }
    if (message.type !== "roll" && message.type !== "rolls") return;
    if (!game.user?.isGM) return;
    const payloads = message.type === "rolls"
      ? (Array.isArray(message.data) ? message.data : [])
      : (message.data ? [message.data] : []);
    if (!payloads.length) return;
    const valid = payloads.filter((payload) => (
      payload?.results && payload?.actionType && payload?.userId
    ));
    if (!valid.length) return;
    for (const payload of valid) {
      if (payload.messageId && state.processedMessages.has(payload.messageId)) return;
    }
    handleRollPayloadsLocally(valid);
    for (const payload of valid) {
      if (payload.messageId) markMessageProcessed(payload.messageId);
    }
  });
});

function applyFontPreview(fontBody, fontTitle, bodyScale, titleScale, chartLegendScale) {
  const roots = document.querySelectorAll(
    ".indy-dice-stats, .indy-dice-stats-reset, .indy-dice-stats-visibility, .indy-dice-stats-faker"
  );
  for (const root of roots) {
    if (fontBody) root.style.setProperty("--ids-font-body", fontBody);
    if (fontTitle) root.style.setProperty("--ids-font-title", fontTitle);
    if (bodyScale !== undefined) root.style.setProperty("--ids-font-body-scale", String(bodyScale));
    if (titleScale !== undefined) root.style.setProperty("--ids-font-title-scale", String(titleScale));
    if (chartLegendScale !== undefined) root.style.setProperty("--ids-chart-legend-scale", String(chartLegendScale));
  }

  refreshOpenDashboards({ forceThemeRefresh: true });
}

function getFontChoices() {
  const fontChoices = {};
  const definitions = CONFIG?.fontDefinitions || {};
  for (const [key, def] of Object.entries(definitions)) {
    if (!def) continue;
    const family = def.fontFamily || def.family || def.font || key;
    const label = def.label || def.name || family;
    fontChoices[family] = label;
  }
  const defaultBody = "\"Manrope\", \"Segoe UI\", sans-serif";
  const defaultTitle = "\"Fraunces\", \"Georgia\", serif";
  fontChoices[defaultBody] ??= "Manrope (sans)";
  fontChoices[defaultTitle] ??= "Fraunces (serif)";
  return fontChoices;
}

function bindFontPreview(app, html) {
  let root = html?.[0];
  if (root?.tagName?.toLowerCase() === "button") {
    root = root.closest?.("form") || root.closest?.(".app") || document;
  }
  let form = root?.querySelector?.("form");
  if (!form && root?.tagName?.toLowerCase() === "form") {
    form = root;
  }
  if (!form) return;
  app._idsFontPreviewBound = true;
  const getValue = (name) => form.querySelector(`[name="${MODULE_ID}.${name}"]`)?.value;
  const updatePreview = () => {
    const bodyValue = getValue("fontBody");
    const titleValue = getValue("fontTitle");
    const bodyScale = Number(getValue("fontBodyScale"));
    const titleScale = Number(getValue("fontTitleScale"));
    const legendScale = Number(getValue("chartLegendScale"));
    applyFontPreview(bodyValue, titleValue, bodyScale, titleScale, legendScale);
  };
  const handlePreviewEvent = (event) => {
    const target = event.target;
    if (!target) return;
    const name = target.getAttribute?.("name") || "";
    if (
      name === `${MODULE_ID}.fontBody`
      || name === `${MODULE_ID}.fontTitle`
      || name === `${MODULE_ID}.fontBodyScale`
      || name === `${MODULE_ID}.fontTitleScale`
      || name === `${MODULE_ID}.chartLegendScale`
    ) {
      updatePreview();
    }
  };

  if (typeof html?.on === "function") {
    html.on(
      "change",
      `select[name="${MODULE_ID}.fontBody"], select[name="${MODULE_ID}.fontTitle"], input[name="${MODULE_ID}.fontBodyScale"], input[name="${MODULE_ID}.fontTitleScale"], input[name="${MODULE_ID}.chartLegendScale"]`,
      updatePreview
    );
    html.on(
      "input",
      `select[name="${MODULE_ID}.fontBody"], select[name="${MODULE_ID}.fontTitle"], input[name="${MODULE_ID}.fontBodyScale"], input[name="${MODULE_ID}.fontTitleScale"], input[name="${MODULE_ID}.chartLegendScale"]`,
      updatePreview
    );
  }
  form.addEventListener("change", handlePreviewEvent, true);
  form.addEventListener("input", handlePreviewEvent, true);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "attributes") continue;
      const target = mutation.target;
      const name = target?.getAttribute?.("name") || "";
      if (
        name === `${MODULE_ID}.fontBody`
        || name === `${MODULE_ID}.fontTitle`
        || name === `${MODULE_ID}.fontBodyScale`
        || name === `${MODULE_ID}.fontTitleScale`
        || name === `${MODULE_ID}.chartLegendScale`
      ) {
        updatePreview();
        return;
      }
    }
  });
  observer.observe(form, { attributes: true, subtree: true, attributeFilter: ["value"] });
  app._idsFontPreviewObserver = observer;

  requestAnimationFrame(updatePreview);
}

function hasVisibleModuleSettings(html) {
  const root = html?.[0] || html;
  if (!root?.querySelectorAll) return false;
  const inputs = Array.from(root.querySelectorAll(`[name^="${MODULE_ID}."]`));
  if (!inputs.length) return false;
  return inputs.some((input) => {
    if (!input) return false;
    if (input.offsetParent !== null) return true;
    if (input.getClientRects && input.getClientRects().length) return true;
    const details = input.closest("details");
    if (details && !details.open) return false;
    const category = input.closest(".settings-category, .category, .settings-section");
    if (category?.classList?.contains("collapsed")) return false;
    return false;
  });
}

Hooks.on("renderSettingsConfig", (app, html) => {
  if (!hasVisibleModuleSettings(html)) return;
  if (!app._idsFontChoicesApplied) {
    const bodySetting = game.settings.settings.get(`${MODULE_ID}.fontBody`);
    const titleSetting = game.settings.settings.get(`${MODULE_ID}.fontTitle`);
    const choices = getFontChoices();
    if (bodySetting) bodySetting.choices = choices;
    if (titleSetting) titleSetting.choices = choices;
    app._idsFontChoicesApplied = true;
    app.render(false);
    return;
  }
  bindFontPreview(app, html);
});

Hooks.on("closeSettingsConfig", (app) => {
  if (app?._idsFontPreviewObserver) {
    app._idsFontPreviewObserver.disconnect();
    app._idsFontPreviewObserver = null;
  }
  if (app?._idsFontPreviewBound) {
    app._idsFontPreviewBound = false;
    refreshOpenDashboards({ forceThemeRefresh: true });
    applyFontPreview(
      game.settings.get(MODULE_ID, "fontBody"),
      game.settings.get(MODULE_ID, "fontTitle"),
      game.settings.get(MODULE_ID, "fontBodyScale"),
      game.settings.get(MODULE_ID, "fontTitleScale"),
      game.settings.get(MODULE_ID, "chartLegendScale")
    );
  }
});

Hooks.on("preCreateChatMessage", (message) => {
  if (!game.settings.get(MODULE_ID, "enabled")) return;
  if (game.user?.isGM) return;
  if (!message || typeof message !== "object") return;
  const existing = message.flags?.[MODULE_ID] || {};
  if (existing?.trackedViaSocket) return;
  try {
    message.updateSource({
      flags: {
        [MODULE_ID]: {
          ...existing,
          trackedViaSocket: true
        }
      }
    });
  } catch (err) {
    console.warn("Indy Dice Stats | Failed to tag message for socket tracking.", err);
  }
});

Hooks.on("createChatMessage", async (message, options, userId) => {
  const delayMs = Math.max(0, Number(game.settings.get(MODULE_ID, "rollProcessingDelayMs")) || 0);
  setTimeout(() => {
    handleChatMessageRoll(message, userId);
  }, delayMs);
});

function handleChatMessageRoll(message, userId) {
  const recordSelfRolls = game.settings.get(MODULE_ID, "recordSelfRolls");
  const recordGmPrivateRolls = game.settings.get(MODULE_ID, "recordGmPrivateRolls");
  const recordGmBlindRolls = game.settings.get(MODULE_ID, "recordGmBlindRolls");
  const isSelfRoll = isSelfRollMessage(message, userId);
  const isGmPrivateRoll = isGmPrivateRollMessage(message, userId);
  const isGmBlindRoll = isBlindGmRollMessage(message, userId);
  const skipSelf = !recordSelfRolls && isSelfRoll;
  const skipGmPrivate = !recordGmPrivateRolls && isGmPrivateRoll;
  const skipGmBlind = !recordGmBlindRolls && isGmBlindRoll;
  if (skipSelf || skipGmPrivate || skipGmBlind) {
    if (game.user?.isGM && (message?.user?.id === game.user?.id  && isSelfRoll) || isGmPrivateRoll || isGmBlindRoll) {
      const rolls = getRollsFromMessage(message);
      const actionType = extractActionType(message, rolls[0], state.workflowMeta.get(message.id));
      const originUserId = resolveUserIdFromMessage(message, userId) || game.user?.id;
      const payloads = buildPayloadsFromRolls(rolls, actionType, originUserId, message, state.workflowMeta.get(message.id));
      if (payloads.length) {
        const latestEntry = createLatestRollEntryFromPayloads(payloads);
        if (latestEntry) {
          setLatestRoll(latestEntry);
          refreshLatestRolls();
        }
      }
    }
    markMessageProcessed(message.id);
    return;
  }
  if (!shouldTrackMessage(message, userId)) return;
  const rolls = getRollsFromMessage(message);
  const actionType = extractActionType(message, rolls[0], state.workflowMeta.get(message.id));
  const originUserId = resolveUserIdFromMessage(message, userId) || game.user?.id;
  const payloads = buildPayloadsFromRolls(rolls, actionType, originUserId, message, state.workflowMeta.get(message.id));
  if (!payloads.length) return;
  if (game.user?.isGM) {
    handleRollPayloadsLocally(payloads);
  } else {
    game.socket.emit(`module.${MODULE_ID}`, { type: "rolls", data: payloads });
  }
  markMessageProcessed(message.id);
}

Hooks.on("midi-qol.RollComplete", async (workflow) => {
  const delayMs = Math.max(0, Number(game.settings.get(MODULE_ID, "rollProcessingDelayMs")) || 0);
  setTimeout(() => {
    handleMidiQolWorkflow(workflow);
  }, delayMs);
});

async function handleMidiQolWorkflow(workflow) {
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
  const recordSelfRolls = game.settings.get(MODULE_ID, "recordSelfRolls");
  const recordGmPrivateRolls = game.settings.get(MODULE_ID, "recordGmPrivateRolls");
  const recordGmBlindRolls = game.settings.get(MODULE_ID, "recordGmBlindRolls");
  let isSelfRoll = false;
  let isGmPrivateRoll = false;
  let isGmBlindRoll = false;
  if (messageId) {
    const chatMessage = game.messages?.get?.(messageId);
    isSelfRoll = isSelfRollMessage(chatMessage, workflowUserId || game.user?.id);
    isGmPrivateRoll = isGmPrivateRollMessage(chatMessage, workflowUserId || game.user?.id);
    isGmBlindRoll = isBlindGmRollMessage(chatMessage, workflowUserId || game.user?.id);
  }
  const mode = workflow?.rollOptions?.rollMode || workflow?.options?.rollMode || workflow?.rollMode;
  const modeLower = typeof mode === "string" ? mode.toLowerCase() : "";
  if (!isSelfRoll && modeLower.includes("self")) isSelfRoll = true;
  if (!isGmPrivateRoll && modeLower.includes("gm")) isGmPrivateRoll = true;
  if (!isGmBlindRoll && modeLower.includes("blind")) isGmBlindRoll = true;

  const skipSelf = !recordSelfRolls && isSelfRoll;
  const skipGmPrivate = !recordGmPrivateRolls && isGmPrivateRoll;
  const skipGmBlind = !recordGmBlindRolls && isGmBlindRoll;
  if (skipSelf || skipGmPrivate || skipGmBlind) {
   if (game.user?.isGM && (message?.user?.id === game.user?.id  && isSelfRoll) || isGmPrivateRoll || isGmBlindRoll) {
      const rolls = collectWorkflowRolls(workflow, {
        debug: game.settings.get(MODULE_ID, "debugMidiQOL")
      });
      const payloads = buildPayloadsFromRolls(
        rolls,
        actionType,
        workflowUserId || game.user?.id,
        null,
        workflow
      );
      if (payloads.length) {
        const latestEntry = createLatestRollEntryFromPayloads(payloads);
        if (latestEntry) {
          setLatestRoll(latestEntry);
          refreshLatestRolls();
        }
      }
    }
    return;
  }

  if (messageId) {
    state.workflowMeta.set(messageId, { actionType });
    if (state.processedMessages.has(messageId)) return;
  }

  const rolls = collectWorkflowRolls(workflow, {
    debug: game.settings.get(MODULE_ID, "debugMidiQOL")
  });
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
    game.socket.emit(`module.${MODULE_ID}`, { type: "rolls", data: payloads });
  }
}

Hooks.on("getSceneControlButtons", (controls) => {
  if (!controls) return;
  const tokenControls = Array.isArray(controls)
    ? controls.find((control) => control?.name === "token")
    : controls.tokens ?? controls.token ?? controls.drawings;
  if (!tokenControls) return;
  const addTool = (tool) => {
    if (Array.isArray(tokenControls.tools)) {
      const existingIndex = tokenControls.tools.findIndex((entry) => entry?.name === tool.name);
      if (existingIndex >= 0) {
        tokenControls.tools[existingIndex] = { ...tokenControls.tools[existingIndex], ...tool };
      } else {
        tokenControls.tools.push(tool);
      }
      return;
    }
    tokenControls.tools ??= {};
    tokenControls.tools[tool.name] = tool;
  };
  const findMonitorApp = () => {
    for (const app of foundry.applications.instances?.values?.() ?? []) {
      if (app instanceof DiceStatsMonitorApp) return app;
    }
    for (const app of Object.values(ui.windows ?? {})) {
      if (app instanceof DiceStatsMonitorApp) return app;
    }
    return null;
  };
  const monitorApp = findMonitorApp();
  const monitorOpen = !!(monitorApp && (monitorApp.rendered || monitorApp._state > 0));
  addTool({
    name: "indyDiceStats",
    title: "Indy Dice Stats",
    icon: "fas fa-chart-column",
    button: true,
    visible: true,
    onClick: () => new DiceStatsApp().render(true),
    onChange: () => new DiceStatsApp().render(true)
  });
  addTool({
    name: "indyDiceStatsMonitor",
    title: "Indy Dice Stats Monitor",
    icon: "fa-regular fa-telescope",
    button: true,
    visible: true,
    toggle: true,
    active: monitorOpen,
    onClick: () => {
      const existing = findMonitorApp();
      if (existing && (existing.rendered || existing._state > 0)) {
        existing.close();
      } else {
        const app = new DiceStatsMonitorApp();
        app.render(true);
        app.bringToTop?.();
      }
      ui.controls?.render();
    },
    onChange: () => {
      const existing = findMonitorApp();
      if (existing && (existing.rendered || existing._state > 0)) {
        existing.close();
      } else {
        const app = new DiceStatsMonitorApp();
        app.render(true);
        app.bringToTop?.();
      }
      ui.controls?.render();
    }
  });
});
