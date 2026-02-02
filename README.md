# Indy Dice Stats

A Foundry VTT (v13) module for D&D 5e 5.2.5 that tracks dice roll statistics per player, die type, action type, and session. It supports both standard 5e rolls and Midi-QOL workflows and provides a polished dashboard with charts and comparison tools.

## Highlights

- Tracks roll distributions by player, action type, die type, and session/date.
- Supports standard D&D 5e rolls and Midi-QOL workflows.
- GM and player dashboards (with GM-only tools for reset and visibility).
- Compare selected players side-by-side.
- Filters for action type, die type, session, and save/check detail.
- Uses Foundry Application V2 UI with light/dark mode aware styling.

## Requirements

- Foundry VTT v13
- D&D 5e system v5.2.5
- Optional: Midi-QOL (for workflow roll capture)

## Installation

1. Download or clone this repo.
2. Copy the `indy-dice-stats` folder into your Foundry data path:
   `Data/modules/indy-dice-stats`
3. Enable the module in your world.

## Usage

- Open the dashboard from **Game Settings -> Module Settings -> Indy Dice Stats -> Open Dice Dashboard**.
- Or use the **Scene Controls** button (chart icon) to open the dashboard quickly.
- Use the filters to narrow stats by player, action, die, session, and save/check detail.
- Select a player to enable the compare list and add additional players to compare.

## Settings

- **Enable dice tracking** (World)
  - Toggle whether rolls are recorded.

- **Reset Dice Stats** (GM-only menu)
  - Clear all stats or a specific player.

- **Player Visibility** (GM-only menu)
  - Hide selected players from the dashboard.

## Data Model Notes

- Stats are stored in world settings and aggregated for quick filtering.
- Session filtering uses `YYYY-MM-DD` date buckets, with a �Today� shortcut.
- When �All Players� is selected, hidden players are excluded from totals.

## Roadmap Ideas

- Export stats to CSV/JSON
- Per-scene or per-campaign segmentation
- Additional chart types (percentiles, streaks)

## License

MIT � see `LICENSE`.
