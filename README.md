# Smartphone Calendar Plus

A feature-rich calendar replacement for the [Smartphone Widget](https://foundryvtt.com/packages/smartphone-widget) Calendar App in Foundry VTT. Optionally integrates with [Calendaria](https://github.com/Sayshal/Calendaria) for fantasy calendar support, syncing time, date, weather, and notes between systems.

Works as a standalone Gregorian calendar without Calendaria installed.

## Requirements

- **Foundry VTT** v13+ (Works on v14 but note that Calendaria does not as of 04/19/2026)
- **Smartphone Widget** module (required)
- **Calendaria** module (recommended, enables fantasy calendars and full note integration)

## Installation

1. Download or clone this repository into your Foundry `Data/modules/` directory.
2. The folder name **must** be `calendaria-phone-app`.
3. Enable the module in your world's Module Management screen.

## Features

<img width="367" height="735" alt="{07317EC3-33F1-4663-AD3D-3A1CF885B554}" src="https://github.com/user-attachments/assets/0c828866-11fa-4462-8220-ca26976e762b" />
<img width="367" height="731" alt="{9AF5AA76-9557-442F-B6F9-E01423D6597C}" src="https://github.com/user-attachments/assets/7d301cd8-bbcd-4b83-983f-fe39cad18019" />

As this is intended to replace the default Calendar app, I will list new features here:

- FUll Calendaria integration. Syncs the calendar (day names, month names, days per week, days per month, and the current date), Notes (name, description, category, color), and weather.
- Monthly grid view pulled from your active calendar system (Gregorian or Calendaria).  
- Displays Calendaria notes on the Smartphoe Calendar app and enables you to open them from the smartphone.
- Respects note visibility from Calendaria (do note that there is currently a bug in calendaria when attempting to change note visibility permissions.  Until fixed I recommend controlling note visibility via the visibility setting).
- Added sorting and interface spacing buttons.
- Expanding notes.  Click on notes to expand them, revealing note contents and other useful information.
- Added the ability to pin notes.
- Added an all notes screen that has tabs for all notes, recurring events, and pinned notes / events.
- Added a settings tab to the all notes screen.
- Past events on the current day appear grayed out.
- Visual ticks to indicate events.  Blue for regular events and purple for recurring events.
- Right clicking on a date as GM sets that day as the current day.
- Month and year and be clicked or scrolled to change the viewed date.
- Added keyboard shortcuts.  Keyboard arrow keys move the selected date when phone is focused (reconfigurable in the controls setting menu), mouse wheel over year / month changes their value, esc key acts as a go back button when the phone is focused.
- Added a setting to the main phone settings to force enable home button on all players (useful for GMs that want to ensure a consitent experience across players and avoid having addition setup steps for them).

### Events and Notes

- **View** Calendaria notes and phone-native events side by side, with title, time, color, category icon, and expandable content preview
- **Create** events from the phone with title, start/end time (or all-day), memo, color picker (8 presets), and category dropdown
- **Edit** existing phone events inline
- **Delete** events via right-click or an optional delete button (configurable in settings)
- **Pin** any event or Calendaria note with the thumbtack button; pinned items appear in the dedicated Pinned tab
- **Open in Calendaria** button launches the native Calendaria note editor for deeper editing
- **Recurring events** display in their own tab with next occurrence dates and an "Ended" section for completed series
- GM-only notes are automatically hidden from players

### All Notes View

Four-tab interface accessible from the list icon in the header:

- **Events** — all non-recurring events across all dates, searchable by title
- **Recurring** — all recurring Calendaria events with next occurrence
- **Pinned** — all pinned events and notes in one place, with Unpin All button
- **Settings** — in-app preferences (no need to leave the phone)

### Date Format Customization

Configure how the date header displays using tokens in the Settings tab:

| Token | Output | Example |
|-------|--------|---------|
| `{Y}` | Full year | 1970 |
| `{y}` | 2-digit year | 70 |
| `{M}` | Full month name | January |
| `{m}` | Month abbreviation | Jan |
| `{m#}` | Numeric month | 01 |
| `{D}` | Full weekday name | Thursday |
| `{d}` | Weekday abbreviation | Thu |
| `{#}` | Day of month | 3 |
| `{##}` | Ordinal day | 3rd |

Combine tokens with any literal text: `{D} {M} {##}, {Y}` produces "Thursday January 3rd, 1970".

GMs can lock the date format for all players using the padlock icon.

### GM Controls (Standalone Mode)

When running without Calendaria, GMs get collapsible control panels:

- **Time shortcuts** — Morning, Midday, Evening, Midnight (advances to the next occurrence)
- **Set date** — jump world time to the selected grid date
- **Lighting FX toggle** — enable/disable TimeOfDayLighting for the active scene
- **Time manipulation** — advance or rewind by 1 or 5 of any unit (minutes, hours, days, months, years)

### Sorting and Display

- Sort events by time or category, ascending or descending
- Compact mode toggle reduces card spacing
- Action buttons (pin, edit, delete, open) can be set to always visible or hover-only
- Escape key behavior is configurable (close forms/return home, or fall through to Foundry)

### Themes

- **Default** — clean blue accent
- **Golden Squares** — gold/yellow gradient accents, Roboto Slab headings, rounded square buttons, enhanced shadows

### Weather Sync (with Calendaria)

Automatically syncs Calendaria's weather to the Smartphone Widget's weather app:

- Temperature, condition, icon, wind speed, precipitation
- Humidity estimated from climate zone, season, and conditions
- "Feels like" temperature uses real meteorological formulas (NWS Wind Chill, Rothfusz Heat Index)
- Wind displayed in mph

### Clock Sync (with Calendaria)

The phone's status bar clock stays in sync with Calendaria's world time through patched SmartphoneTime methods. Calendar structure (months, weekdays, leap years) is also synced so the phone understands your custom calendar.

### Per-Phone Storage

- Phone-native events are stored per phone
- Pinned notes are stored per phone
- Event writes route through the original module's socket handlers for cross-client sync

## Changelog

### v0.2.0

#### New Features
- Ordinal day token `{##}` for date format (displays "1st", "2nd", "3rd", etc.)
- Date format GM padlock — GMs can lock the date format for all players; locked format propagates automatically when changed
- Per-phone pin storage — pinned events and Calendaria notes are now stored per phone and visible to all clients, not just the pinning player
- Custom category editor in standalone mode (Settings tab)
- Golden Squares theme

#### Changes
- Switched from bulk event writes to individual socket-based writes using the original module's `updateCalendarEvent` and `deleteCalendarEvent` handlers for better atomicity and free cross-client sync
- Recurring event dots are now purple-only on days that have no other events; blue dot only appears for non-recurring events
- Calendar hooks (noteCreated, noteDeleted, etc.) are registered once and cleaned up on destroy instead of every render, eliminating console spam
- Font declarations updated from woff2 to TTF format

#### Bug Fixes
- Fixed text color defaulting to the Foundry theme's light color instead of black across both Chrome and Firefox
- Fixed Firefox form elements (inputs, selects, buttons, labels) not inheriting black text due to CSS specificity issues with Foundry themes
- Fixed Firefox heading (h3/h4) color being overridden by theme styles
- Fixed Chrome text appearing too light — base font weight bumped to 500
- Fixed checkbox accent color inheriting from the Foundry theme instead of using the calendar's blue accent
- Fixed category dropdown text color being overridden in Firefox
- Fixed date format trimming spaces between tokens due to `inline-flex` collapsing whitespace-only text nodes — separators are now wrapped in spans with `white-space: pre`
- Fixed GM date format changes not propagating to clients when the padlock is locked
- Fixed month and year field sizing differing between Firefox and Chrome — replaced `field-sizing: content` with JS-based probe sizing for consistent cross-browser rendering
- Fixed non-GM players unable to pin/unpin Calendaria notes after the switch to world-scoped storage — added socket relay through the active GM
- Fixed Calendaria stopwatch getting stuck in a running state on session load

## Technical Details

### Architecture

```
main.mjs
├── App registration (setup hook)
├── Settings registration (setup hook)
├── Socket listener for non-GM pin writes (setup hook)
├── Stopwatch reset (ready hook, GM only)
├── SmartphoneTime patches (now, getDateObject, getCalendarConfig)
├── Calendar structure sync (months, weekdays, leap rules)
├── Realtime clock bridge (Calendaria hooks → WidgetClock)
├── Weather sync (Calendaria → phone weather-data, debounced 500ms)
├── Weather source lock
└── WeatherApp render patch (wind mph + feels-like formula)

CalendariaPhoneApp.mjs (extends BaseApp)
├── Lazy date initialization
├── Hook management (register once, clean up on destroy)
├── Rendering (calendar grid, day info, notes, event form, pinned view)
├── Listener management (split into focused methods)
├── Note CRUD via socket (executeAsGM for cross-client sync)
├── Per-phone pin storage (world-scoped, socket relay for non-GMs)
├── GM time controls (shortcuts, advance, set date)
└── Keyboard navigation (arrow keys, escape)
```

### Event Storage

Phone-native events are stored in the `smartphone-widget` module's `calendar-events` world setting, keyed by phone ID and zero-padded date strings (`YYYY-MM-DD`). All writes go through the original module's socket handlers (`updateCalendarEvent`, `deleteCalendarEvent`) which call `executeAsGM` for permission and `executeForEveryone("calendarUpdated")` for sync.

### Pin Storage

Calendaria note pins are stored in the `calPinnedNotes` world setting as a JSON object keyed by phone ID: `{ "phoneId": ["noteId1", "noteId2"] }`. Non-GM clients emit a socket message to the active GM for writes. An optimistic local override ensures the UI updates immediately while the GM processes the write.

### Weather Calculations

**Wind speed conversion** (Calendaria level → m/s):

| Level | Label | m/s | Real-World Equivalent |
|-------|-------|-----|----------------------|
| 0 | Calm | 1 | Smoke rises vertically |
| 1 | Light | 3 | Leaves rustle |
| 2 | Moderate | 8 | Small branches move |
| 3 | Strong | 14 | Whole trees sway |
| 4 | Severe | 25 | Structural damage possible |
| 5 | Extreme | 40 | Hurricane / tornado force |

**Humidity estimation** layers four factors:

1. Climate zone base (Tropical 80%, Subtropical 70%, Temperate 60%, Subarctic 55%, Arctic 50%, Polar 45%, Arid 20%)
2. Seasonal modifier (Spring/Autumn +5%, Summer -5%, Winter +0%)
3. Precipitation boost (Drizzle +10%, Rain +20%, Downpour +30%, Thunderstorm +25%, Fog +25%, etc.)
4. Environmental adjustments (high wind -5%, extreme cold +5%, hot arid -10%)

Result clamped to 5-99%.

**Feels-like temperature**:

| Condition | Formula |
|-----------|---------|
| Cold + windy (≤50°F, wind >3 mph) | NWS Wind Chill Index |
| Hot + humid (≥80°F, humidity ≥40%) | Rothfusz Heat Index with NWS adjustments |
| Mild range (50-80°F) | Wind cooling with linear taper + humidity warming |

### Cross-Browser CSS

The module targets both Chrome and Firefox with a unified base `font-weight: 500`. All calendar text defaults to black via `.calendar-app.smcal-app` at specificity (0,2,0), with `:where()` for form element inheritance so intentional color overrides (save button white, delete button red) still win. Checkbox accents override the theme's `--color-accent` / `--check-color` variables with the calendar's blue accent.

### Security

All user-provided strings (note titles, category labels, month names) are HTML-escaped before template insertion. GM-only notes are filtered client-side as defense-in-depth.

## License

MIT
