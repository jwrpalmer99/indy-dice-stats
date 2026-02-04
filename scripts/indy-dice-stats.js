import { MODULE_ID } from "./ids-constants.js";
import { state } from "./ids-state.js";
import {
  buildPayloadsFromRolls,
  collectWorkflowRolls,
  createGlobalStats,
  extractActionType,
  getGlobalStats,
  getRollsFromMessage,
  handleRollPayloadsLocally,
  markMessageProcessed,
  normalizeActionType,
  normalizeGlobalStats,
  resetUserStats,
  resolveUserIdFromMessage,
  resolveUserIdFromWorkflow,
  scheduleRefresh,
  shouldTrackMessage,
  getUserStats
} from "./ids-data.js";
import {
  DiceStatsApp,
  DiceStatsResetApp,
  DiceStatsVisibilityApp,
  DiceStatsFakerApp,
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

function applyFontPreview(fontBody, fontTitle, bodyScale, titleScale) {
  const roots = document.querySelectorAll(
    ".indy-dice-stats, .indy-dice-stats-reset, .indy-dice-stats-visibility, .indy-dice-stats-faker"
  );
  for (const root of roots) {
    if (fontBody) root.style.setProperty("--ids-font-body", fontBody);
    if (fontTitle) root.style.setProperty("--ids-font-title", fontTitle);
    if (bodyScale !== undefined) root.style.setProperty("--ids-font-body-scale", String(bodyScale));
    if (titleScale !== undefined) root.style.setProperty("--ids-font-title-scale", String(titleScale));
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
    applyFontPreview(bodyValue, titleValue, bodyScale, titleScale);
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
    ) {
      updatePreview();
    }
  };

  if (typeof html?.on === "function") {
    html.on(
      "change",
      `select[name="${MODULE_ID}.fontBody"], select[name="${MODULE_ID}.fontTitle"], input[name="${MODULE_ID}.fontBodyScale"], input[name="${MODULE_ID}.fontTitleScale"]`,
      updatePreview
    );
    html.on(
      "input",
      `select[name="${MODULE_ID}.fontBody"], select[name="${MODULE_ID}.fontTitle"], input[name="${MODULE_ID}.fontBodyScale"], input[name="${MODULE_ID}.fontTitleScale"]`,
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

Hooks.on("renderSettingsConfig", (app, html) => {
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
  app._idsFontPreviewBound = false;
  refreshOpenDashboards({ forceThemeRefresh: true });
  applyFontPreview(
    game.settings.get(MODULE_ID, "fontBody"),
    game.settings.get(MODULE_ID, "fontTitle"),
    game.settings.get(MODULE_ID, "fontBodyScale"),
    game.settings.get(MODULE_ID, "fontTitleScale")
  );
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
