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
