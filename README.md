# Indy Dice Stats

A Foundry VTT (v13) module for D&D 5e 5.2.5 that tracks and monitors dice roll statistics per player, die type, action type, and save/check detail by session or in total. It supports both standard 5e rolls and Midi-QOL workflows and provides a polished dashboard with charts and comparison tools.

<img width="911" height="862" alt="compare_stats" src="https://github.com/user-attachments/assets/c6aed73d-6fb9-4c80-99cd-fa4ce3a78987" />
</br>
<img width="764" height="615" alt="trend_compare" src="https://github.com/user-attachments/assets/9ba7b138-54a6-4313-a657-b5612c64b519" />
</br>
<img width="188" height="134" alt="monitor" src="https://github.com/user-attachments/assets/c170a247-0dfc-4ac1-94f7-7fc3c4401e51" />
<img width="188" height="134" alt="monitor2" src="https://github.com/user-attachments/assets/852a1bfc-e49e-4295-8711-5774b6272a90" />

Also works with pf2e but needs more testing, other systems MAY work if they use standard roll messages in chat.

## Highlights

- Tracks roll distributions by player, action type, die type, and session/date.
- Trend view over time for the selected die (click the Distribution title).
- Streaks heatmap view (click the Distribution title to cycle views).
- Supports standard D&D 5e rolls and Midi-QOL workflows.
- Live "Latest Roll" monitor (optional, with d20-only and privacy-aware display).
- Floating monitor window (scene control telescope icon).
- GM-only tools for reset, visibility, and fake data generation.
- Compare selected players side-by-side.
- Filters for action type, die type, session, and save/check detail.
- Uses Foundry Application V2 UI with light/dark mode aware styling.
- Change and size the fonts used to suit your game/screen.
- Sockets ensure everyone is kept up to date as rolls happen.
- Generate fake roll data in module settings so you can try it out!

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
- Use the **Scene Controls** eye icon to toggle the floating monitor window (double-click it to open the main dashboard).
- Use the filters to narrow stats by player, action, die, session, and save/check detail.
- Click the Distribution chart title to cycle Distribution, Trend, and Streaks views.
- In Trend view, use the Candles toggle to show min/max and quartiles.
- In Streaks view, use the Min/Max toggle to switch streak type.
- Select a player to enable the compare list and add additional players to compare.

## Settings

- **Enable dice tracking** (World)
  - Toggle whether rolls are recorded.
- **Record Self Rolls** (World)
  - Record self-only rolls in stats.
- **Record Private GM Rolls** (World)
  - Record GM private rolls (gmroll) in stats.
- **Record Blind GM Rolls** (World)
  - Record GM blind rolls (blindroll) in stats.
- **Allow Players to See GM Stats** (World)
  - Include/exclude GM stats from non-GM views and All Players.
- **Show Latest Roll** (Client)
  - Show the "Latest Roll" monitor area in the title.
- **Only Monitor d20** (Client)
  - Only update the title monitor when a roll includes a d20.
- **Debug Midi-QOL Roll Capture** (Client)
  - Log Midi-QOL roll capture details to the console.

- **Reset Dice Stats** (GM-only menu)
  - Clear all stats or a specific player.

- **Player Visibility** (GM-only menu)
  - Hide selected players from the dashboard.

- **Generate Fake Data** (GM-only menu)
  - Adds 12 sessions of sample rolls (30-90 per session) for a chosen player without clearing existing stats.

## Data Model Notes

- Stats are stored in world settings and aggregated for quick filtering.
- Session filtering uses `YYYY-MM-DD` date buckets, with a "Today" shortcut.
- When 'All Players' is selected, hidden players are excluded from totals.
- Hidden player stats are still recorded; they are just not counted or shown.

## Roadmap Ideas

- Export stats to CSV/JSON
- Per-scene or per-campaign segmentation

## License

MIT - see `LICENSE`.
