import { FAKE_ROLLS_MAX, FAKE_ROLLS_MIN, FAKE_SESSION_COUNT, MODULE_ID } from "./ids-constants.js";
import { generateFakeDataForUser, resetUserStats } from "./ids-data.js";
import { refreshOpenDashboards } from "./ids-ui-shell.js";
import { applyFontSettings } from "./ids-ui-helpers.js";

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
    applyFontSettings(scope);
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

export {
  DiceStatsResetApp,
  DiceStatsVisibilityApp,
  DiceStatsFakerApp
};

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
    applyFontSettings(scope);
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
    applyFontSettings(scope);
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

