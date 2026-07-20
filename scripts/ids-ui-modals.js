import {
  FAKE_ROLLS_MAX,
  FAKE_ROLLS_MIN,
  FAKE_SESSION_COUNT,
  MODULE_ID,
  format,
  localize
} from "./ids-constants.js";
import { generateFakeDataForUser, resetUserStats } from "./ids-data.js";
import { refreshOpenDashboards } from "./ids-ui-shell.js";
import { applyFontSettings } from "./ids-ui-helpers.js";

async function confirmDialog({ title, content }) {
  const dialogV2 = foundry.applications?.api?.DialogV2;
  if (dialogV2?.confirm) {
    return dialogV2.confirm({
      modal: true,
      window: { title },
      content
    });
  }
  return Dialog.confirm({ title, content });
}

class DiceStatsResetApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
) {
  static DEFAULT_OPTIONS = {
    id: "indy-dice-stats-reset",
    classes: ["indy-dice-stats-reset"],
    window: {
      title: "IDS.Reset.Title",
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
    const message = localize(userId === "all" ? "IDS.Reset.ConfirmAll" : "IDS.Reset.ConfirmPlayer");
    const confirmed = await confirmDialog({
      title: localize("IDS.Reset.Title"),
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
      title: "IDS.Visibility.Title",
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
    const selected = Array.from(
      scope.querySelectorAll("[data-visibility='users'] input:checked"),
      (input) => input.value
    ).filter(Boolean);
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
      title: "IDS.Faker.Title",
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
    const confirmed = await confirmDialog({
      title: localize("IDS.Faker.Title"),
      content: `<p>${format("IDS.Faker.Confirm", {
        name: foundry.utils.escapeHTML(name),
        sessions: FAKE_SESSION_COUNT,
        min: FAKE_ROLLS_MIN,
        max: FAKE_ROLLS_MAX
      })}</p>`
    });
    if (!confirmed) return;
    const result = generateFakeDataForUser(userId);
    if (result) {
      ui.notifications?.info?.(
        format("IDS.Faker.Complete", { rolls: result.rolls, sessions: result.sessions, name })
      );
    }
    this.close();
  }
}

