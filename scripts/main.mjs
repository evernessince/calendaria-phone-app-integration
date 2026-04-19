/**
 * smartphone-calendaria — Main Entry Point
 *
 * Integrates Calendaria with Smartphone Widget:
 *  1. Patches SmartphoneTime (now, getDateObject, getCalendarConfig) to read from Calendaria.
 *  2. Bridges time-change hooks to directly update the phone's clock display.
 *  3. Syncs Calendaria weather → phone weather-data setting (debounced).
 *  4. Resets the Calendaria stopwatch if stuck running on load.
 *  5. Registers CalendariaPhoneApp as the "calendar" app (replaces built-in).
 *
 * @module calendaria-phone-app
 */

import { CalendariaPhoneApp } from './CalendariaPhoneApp.mjs';

const MODULE_ID = 'calendaria-phone-app';
const DEFAULT_COLOR = '#4a9eff';

/** Module-level reference to weather sync — set in section 4, called in section 6. */
let _syncWeatherNow = null;

/* ================================================================== */
/*  Widget instance helper (cached)                                    */
/* ================================================================== */

let _SW = null;
let _cachedInstance = null;

/**
 * Get the SmartphoneWidget WidgetManager instance.
 * Caches the class reference and the resolved instance.
 * @returns {Promise<object|null>}
 */
async function getWidgetInstance() {
    if (!_SW) {
        try {
            const mod = await import('/modules/smartphone-widget/scripts/smartphone-widget.js');
            _SW = mod.SmartphoneWidget;
        } catch (e) {
            console.warn(`${MODULE_ID} | Cannot import SmartphoneWidget:`, e);
            return null;
        }
    }
    try {
        _cachedInstance = await _SW.getInstance();
        return _cachedInstance;
    } catch {
        return _cachedInstance; // Return stale if getInstance fails
    }
}

/* ================================================================== */
/*  Debounce utility                                                   */
/* ================================================================== */

/**
 * @param {Function} fn
 * @param {number} ms
 * @returns {Function}
 */
function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), ms);
    };
}

/* ================================================================== */
/*  App registration (setup hook)                                      */
/* ================================================================== */

Hooks.once('setup', () => {
    const swApi = game.modules.get('smartphone-widget')?.api;
    if (!swApi) {
        console.error(`${MODULE_ID} | smartphone-widget module not found.`);
        return;
    }

    swApi.registerApp({
        id: 'calendar',
        name: game.i18n.localize('SMCAL.appName'),
        icon: 'fas fa-calendar-alt',
        color: '#3b82f6',
        category: 'utility',
        appClass: CalendariaPhoneApp,
        defaultInstalled: true
    });

    game.keybindings.register(MODULE_ID, 'calNavLeft', {
        name: 'Calendar: Move Left',
        hint: 'Move the selected date left by one day (only when phone is focused).',
        editable: [{ key: 'ArrowLeft' }],
        onDown: () => CalendariaPhoneApp._handleKeybind('left'),
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register(MODULE_ID, 'calNavRight', {
        name: 'Calendar: Move Right',
        hint: 'Move the selected date right by one day (only when phone is focused).',
        editable: [{ key: 'ArrowRight' }],
        onDown: () => CalendariaPhoneApp._handleKeybind('right'),
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register(MODULE_ID, 'calNavUp', {
        name: 'Calendar: Move Up',
        hint: 'Move the selected date up by one week (only when phone is focused).',
        editable: [{ key: 'ArrowUp' }],
        onDown: () => CalendariaPhoneApp._handleKeybind('up'),
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
    game.keybindings.register(MODULE_ID, 'calNavDown', {
        name: 'Calendar: Move Down',
        hint: 'Move the selected date down by one week (only when phone is focused).',
        editable: [{ key: 'ArrowDown' }],
        onDown: () => CalendariaPhoneApp._handleKeybind('down'),
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });

    // User-scoped (per-client) preferences — each player has their own values
    // and can change them without GM permission. Only GM time controls remain
    // GM-exclusive (enforced by `game.user.isGM` gating in the app itself).
    game.settings.register(MODULE_ID, 'calPinnedNotes', {
        scope: 'world', config: false, type: String, default: '{}',
        onChange: () => {
            CalendariaPhoneApp._clearPinOverride();
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    game.socket.on(`module.${MODULE_ID}`, async (data) => {
        if (data.action === 'setCalPins' && game.user === game.users.activeGM) {
            try {
                const raw = game.settings.get(MODULE_ID, 'calPinnedNotes') || '{}';
                const all = (() => { try { const v = JSON.parse(raw); return (typeof v === 'object' && v !== null && !Array.isArray(v)) ? v : {}; } catch { return {}; } })();
                if (data.arr.length) all[data.pid] = data.arr; else delete all[data.pid];
                await game.settings.set(MODULE_ID, 'calPinnedNotes', JSON.stringify(all));
            } catch {}
        }
    });

    game.settings.register(MODULE_ID, 'sortMode', {
        scope: 'client', config: false, type: String, default: 'time'
    });

    game.settings.register(MODULE_ID, 'sortAsc', {
        scope: 'client', config: false, type: Boolean, default: true
    });

    game.settings.register(MODULE_ID, 'compact', {
        scope: 'client', config: false, type: Boolean, default: true
    });

    game.settings.register(MODULE_ID, 'calendarTheme', {
        name: 'Calendar App Theme',
        scope: 'client',
        config: false,
        type: String,
        default: 'default',
        onChange: async (value) => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') {
                inst._applyTheme(value);
            }
        }
    });

    // Settings managed in-app via the Settings tab on the All Notes screen.
    // Hidden from the Foundry settings menu (config: false).
    game.settings.register(MODULE_ID, 'deleteMode', {
        scope: 'client', config: false, type: String, default: 'right-click',
        onChange: () => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    game.settings.register(MODULE_ID, 'actionButtonsVisibility', {
        scope: 'client', config: false, type: String, default: 'always',
        onChange: () => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    game.settings.register(MODULE_ID, 'dateFormat', {
        scope: 'client', config: false, type: String, default: '{Y}, {M}',
        onChange: () => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    game.settings.register(MODULE_ID, 'escapeGoesBack', {
        scope: 'client', config: false, type: Boolean, default: true,
        onChange: () => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    game.settings.register(MODULE_ID, 'customCategories', {
        scope: 'client', config: false, type: String, default: '[]',
        onChange: () => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    // World-scoped GM override: when enabled, every non-GM player's phone gets
    // the persistent home button (overrides their per-client preference which
    // is off by default in smartphone-widget).
    game.settings.register(MODULE_ID, 'forcePlayerHomeButton', {
        scope: 'world', config: false, type: Boolean, default: false,
        onChange: () => _applyPlayerHomeButton()
    });

    // World-scoped GM override for the calendar date format.  When non-empty,
    // all players use this format instead of their own client preference.
    game.settings.register(MODULE_ID, 'forceDateFormat', {
        scope: 'world', config: false, type: String, default: '',
        onChange: () => {
            const inst = CalendariaPhoneApp._activeInstance;
            if (inst?.element && inst.widget.currentApp === 'calendar') inst.render();
        }
    });

    console.log(`${MODULE_ID} | Calendar app registered.`);
});

/* ================================================================== */
/*  Player home-button helper                                          */
/* ================================================================== */

/**
 * Applies the `show-persistent-home` class to the active smartphone frame
 * for non-GM players when the world-scoped `forcePlayerHomeButton` setting
 * is enabled. GMs keep their own per-client preference untouched.
 * Called on setting change and after each widget render.
 */
function _applyPlayerHomeButton() {
    if (game.user.isGM) return;
    let enabled = false;
    try { enabled = !!game.settings.get(MODULE_ID, 'forcePlayerHomeButton'); } catch {}
    if (!enabled) return;
    const frame = document.querySelector('.smartphone-frame');
    if (frame) frame.classList.add('show-persistent-home');
}

/* ================================================================== */
/*  Main initialization (ready hook)                                   */
/* ================================================================== */

Hooks.once('ready', async () => {
    // One-time storage migration: pad legacy date keys (e.g. `1970-6-2` → `1970-06-02`)
    // so the lexicographic sort stays correct. Runs GM-side only.
    if (game.user.isGM) {
        try {
            const data = game.settings.get('smartphone-widget', 'calendar-events') || {};
            let anyChange = false;
            for (const [pid, entries] of Object.entries(data)) {
                if (!Array.isArray(entries)) continue;
                let phoneChanged = false;
                const migrated = entries.map(([k, v]) => {
                    const parts = k.split('-');
                    if (parts.length !== 3) return [k, v];
                    const [y, m, d] = parts;
                    // Skip year-0 orphaned entries (legacy holiday seeds)
                    if (y === '0') return [k, v];
                    const newKey = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                    if (newKey !== k) phoneChanged = true;
                    return [newKey, v];
                });
                if (!phoneChanged) continue;
                // Dedupe on the new key (in case both padded and unpadded existed)
                const dedup = new Map();
                for (const [k, v] of migrated) {
                    if (dedup.has(k)) dedup.get(k).push(...v);
                    else dedup.set(k, [...v]);
                }
                data[pid] = Array.from(dedup.entries());
                anyChange = true;
            }
            if (anyChange) {
                await game.settings.set('smartphone-widget', 'calendar-events', data);
                console.log(`${MODULE_ID} | Migrated legacy unpadded date keys.`);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Date-key migration failed:`, e);
        }
    }

    if (typeof CALENDARIA === 'undefined' || !CALENDARIA?.api) {
        // Calendaria is optional. Without it the calendar uses a Gregorian fallback
        // driven by Foundry's worldTime and shows only phone-native events.
        console.log(`${MODULE_ID} | Calendaria not detected — running in standalone mode.`);
        return;
    }

    const cApi = CALENDARIA.api;

    // ==================================================================
    //  1. RESET STUCK STOPWATCH
    // ==================================================================
    if (game.user.isGM) {
        try {
            const state = game.settings.get('calendaria', 'stopwatchState');
            if (state?.running) {
                await game.settings.set('calendaria', 'stopwatchState', {
                    running: false,
                    mode: state.mode ?? 'gametime',
                    elapsedMs: 0,
                    elapsedGameSeconds: 0,
                    savedAt: 0,
                    savedWorldTime: 0,
                    laps: [],
                    notification: null,
                    notificationThreshold: null,
                    notificationFired: false
                });
                try { cApi.hideStopwatch(); } catch { /* may not be rendered yet */ }
                console.log(`${MODULE_ID} | Stopwatch state force-reset.`);
            }
        } catch (e) {
            console.warn(`${MODULE_ID} | Could not reset stopwatch:`, e);
        }
    }

    // ==================================================================
    //  2. PATCH SmartphoneTime
    // ==================================================================
    try {
        const mod = await import('/modules/smartphone-widget/scripts/core/SmartphoneTime.js');
        const ST = mod.SmartphoneTime;

        // ---- Patch now() ----
        const originalNow = ST.now.bind(ST);
        ST.now = function () {
            if (typeof CALENDARIA !== 'undefined' && CALENDARIA?.api) {
                return (game.time.timestamp ?? game.time.worldTime * 1000);
            }
            return originalNow();
        };

        // ---- Patch getDateObject() ----
        const originalGetDateObject = ST.getDateObject.bind(ST);
        ST.getDateObject = function (timestamp) {
            if (typeof CALENDARIA === 'undefined' || !CALENDARIA?.api) {
                return originalGetDateObject(timestamp);
            }
            try {
                const api = CALENDARIA.api;
                const worldTimeMs = (game.time.timestamp ?? game.time.worldTime * 1000);
                let dt;
                if (typeof timestamp !== 'number' || Math.abs(timestamp - worldTimeMs) < 1000) {
                    dt = api.getCurrentDateTime();
                } else {
                    dt = api.timestampToDate(timestamp / 1000);
                }
                if (dt) {
                    const day = dt.day ?? dt.dayOfMonth ?? 1;
                    let weekday = dt.weekday;
                    if (weekday == null) {
                        try { weekday = api.dayOfWeek({ year: dt.year, month: dt.month, day }); }
                        catch { weekday = 0; }
                    }
                    return {
                        year:    dt.year,
                        month:   dt.month,
                        day:     day,
                        hour:    dt.hour   ?? 0,
                        minute:  dt.minute ?? 0,
                        second:  dt.second ?? 0,
                        weekday: weekday ?? 0
                    };
                }
            } catch (e) {
                console.error(`${MODULE_ID} | getDateObject patch error:`, e);
            }
            return originalGetDateObject(timestamp);
        };

        // ---- Patch getCalendarConfig() ----
        const originalGetCalendarConfig = ST.getCalendarConfig?.bind(ST);
        ST.getCalendarConfig = function () {
            if (typeof CALENDARIA !== 'undefined' && CALENDARIA?.api) {
                try {
                    const cal = CALENDARIA.api.getActiveCalendar();
                    // New API: monthsArray/weekdaysArray. Old API: months.values/days.values.
                    const monthsSrc = (Array.isArray(cal?.monthsArray) && cal.monthsArray.length > 0)
                        ? cal.monthsArray
                        : Object.values(cal?.months?.values ?? {}).sort((a, b) => a.ordinal - b.ordinal);
                    const weekdaysSrc = (Array.isArray(cal?.weekdaysArray) && cal.weekdaysArray.length > 0)
                        ? cal.weekdaysArray
                        : Object.values(cal?.days?.values ?? {}).sort((a, b) => a.ordinal - b.ordinal);
                    const months = monthsSrc.map(m => ({
                        name: m.name,
                        abbreviation: m.abbreviation,
                        days: m.days,
                        leapDays: m.leapDays ?? null
                    }));
                    const weekdays = weekdaysSrc.map(d => ({
                        name: d.name,
                        abbreviation: d.abbreviation
                    }));
                    return { months, weekdays };
                } catch (e) {
                    console.error(`${MODULE_ID} | getCalendarConfig patch error:`, e);
                }
            }
            return originalGetCalendarConfig ? originalGetCalendarConfig() : { months: [], weekdays: [] };
        };

        console.log(`${MODULE_ID} | SmartphoneTime patched.`);
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to patch SmartphoneTime:`, err);
    }

    // ==================================================================
    //  3. REALTIME CLOCK + CALENDAR UPDATES
    // ==================================================================
    try {
        /**
         * Synchronously refresh the phone clock and calendar app.
         * Wrapped to be safe for hook registration (no unhandled promise rejections).
         */
        /**
         * Sync Calendaria's calendar structure → phone's smartphone-time-config.
         * Writes: months array, weekdays, leap year rule.
         * Called once on startup and on calendaria.READY — structure doesn't
         * change during a session.
         */
        function syncCalendarStructure() {
            if (!game.user.isGM) return;
            try {
                const calApi = (typeof CALENDARIA !== 'undefined') ? CALENDARIA?.api : null;
                if (!calApi) return;
                const cal = calApi.getActiveCalendar?.();
                if (!cal) return;

                const cfg = game.settings.get('smartphone-widget', 'smartphone-time-config');
                if (!cfg) return;

                let changed = false;

                // Months
                const monthsSrc = (Array.isArray(cal.monthsArray) && cal.monthsArray.length > 0)
                    ? cal.monthsArray
                    : Object.values(cal.months?.values ?? {}).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
                if (monthsSrc.length > 0) {
                    cfg.months = monthsSrc.map(m => ({
                        name: m.name,
                        days: m.days ?? 30,
                        isLeap: m.leapDays != null && m.leapDays !== m.days,
                        leapOffset: m.leapDays != null ? (m.leapDays - (m.days ?? 30)) : 0
                    }));
                    changed = true;
                }

                // Weekdays
                const weekdaysSrc = (Array.isArray(cal.weekdaysArray) && cal.weekdaysArray.length > 0)
                    ? cal.weekdaysArray
                    : Object.values(cal.days?.values ?? {}).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
                if (weekdaysSrc.length > 0) {
                    cfg.weekdays = weekdaysSrc.map(d => d.name);
                    changed = true;
                }

                // Leap year rule
                const lyc = cal.leapYearConfig;
                if (lyc) {
                    if (lyc.type === 'gregorian') {
                        cfg.leapYearRule = { frequency: 4, exception: 100, proleptic: 400 };
                    } else if (lyc.interval) {
                        cfg.leapYearRule = { frequency: lyc.interval, exception: 0, proleptic: 0 };
                    }
                    changed = true;
                }

                if (changed) game.settings.set('smartphone-widget', 'smartphone-time-config', cfg);
            } catch (e) { console.warn(`${MODULE_ID} | syncCalendarStructure:`, e); }
        }

        /**
         * Compute the timestamp that the phone's internal getDateObject algorithm
         * would resolve to the given date components. The phone starts from year 0
         * and counts days forward, so we must reverse that calculation.
         *
         * Uses the phone's own config (months, leap year rule) to ensure the
         * result matches exactly what getDateObject would produce.
         *
         * @param {{year:number, month:number, day:number, hour:number, minute:number, second:number}} dt
         * @param {object} cfg - smartphone-time-config
         * @returns {number} timestamp in milliseconds
         */
        function dateToPhoneTimestamp(dt, cfg) {
            const MS_IN_SECOND = 1000;
            const MS_IN_MINUTE = MS_IN_SECOND * (cfg.secondsInMinute || 60);
            const MS_IN_HOUR = MS_IN_MINUTE * (cfg.minutesInHour || 60);
            const MS_IN_DAY = MS_IN_HOUR * (cfg.hoursInDay || 24);

            const months = cfg.months || [];
            const lr = cfg.leapYearRule || {};

            function isLeapYear(y) {
                if (!lr.frequency) return false;
                if (y % lr.frequency !== 0) return false;
                if (lr.exception && y % lr.exception === 0) {
                    return !!(lr.proleptic && y % lr.proleptic === 0);
                }
                return true;
            }

            function daysInYear(y) {
                let total = 0;
                for (const mo of months) {
                    total += (mo.days || 30);
                    if (mo.isLeap && isLeapYear(y)) total += (mo.leapOffset || 0);
                }
                return total || 365;
            }

            function daysInMonth(y, m) {
                const mo = months[m - 1];
                if (!mo) return 30;
                let d = mo.days || 30;
                if (mo.isLeap && isLeapYear(y)) d += (mo.leapOffset || 0);
                return d;
            }

            // Sum days for all years before target year
            let totalDays = 0;
            for (let y = 0; y < dt.year; y++) totalDays += daysInYear(y);

            // Sum days for months before target month (1-based)
            const month = dt.month ?? 1;
            for (let m = 1; m < month; m++) totalDays += daysInMonth(dt.year, m);

            // Add remaining days (1-based → 0-based)
            totalDays += ((dt.day ?? dt.dayOfMonth ?? 1) - 1);

            return totalDays * MS_IN_DAY
                + (dt.hour ?? 0) * MS_IN_HOUR
                + (dt.minute ?? 0) * MS_IN_MINUTE
                + (dt.second ?? 0) * MS_IN_SECOND;
        }

        /**
         * Sync Calendaria's current date/time → phone's smartphone-world-time.
         * Computes the correct timestamp that the phone's internal algorithm
         * will resolve to Calendaria's current date.
         */
        function syncPhoneDateTime() {
            if (!game.user.isGM) return;
            try {
                const calApi = (typeof CALENDARIA !== 'undefined') ? CALENDARIA?.api : null;
                if (!calApi) return;
                const dt = calApi.getCurrentDateTime();
                if (!dt) return;

                const cfg = game.settings.get('smartphone-widget', 'smartphone-time-config');
                if (!cfg) return;

                // Also keep the config date fields in sync (for any UI that reads them)
                const day = dt.day ?? dt.dayOfMonth ?? 1;
                cfg.year = dt.year;
                cfg.month = dt.month;
                cfg.day = day;
                cfg.hour = dt.hour ?? 0;
                cfg.minute = dt.minute ?? 0;
                cfg.second = dt.second ?? 0;
                game.settings.set('smartphone-widget', 'smartphone-time-config', cfg);

                // Compute the timestamp the phone's algorithm expects
                const ts = dateToPhoneTimestamp(dt, cfg);
                game.settings.set('smartphone-widget', 'smartphone-world-time', ts);
            } catch (e) { console.warn(`${MODULE_ID} | syncPhoneDateTime:`, e); }
        }

        /**
         * Refresh the phone's clock display and sync date.
         */
        function refreshPhoneTime() {
            syncPhoneDateTime();

            getWidgetInstance().then(inst => {
                if (!inst) return;
                // Update status bar clock
                if (inst._clock) {
                    try { inst._clock.updateClockDisplay(); } catch { /* */ }
                    try { inst._clock.handleTimeUpdate(); } catch { /* */ }
                }
            }).catch(() => { /* widget not available */ });
        }

        // Bridge Calendaria and core time hooks → phone clock
        Hooks.on(cApi.hooks.DATE_TIME_CHANGE, refreshPhoneTime);
        Hooks.on('updateWorldTime', refreshPhoneTime);

        // Immediate sync — write full calendar structure + date now
        syncCalendarStructure();
        syncPhoneDateTime();

        // Also fire the SmartphoneTime hook for any other listeners
        const stMod = await import('/modules/smartphone-widget/scripts/core/SmartphoneTime.js');
        const hookName = stMod.SmartphoneTime.HOOK_NAME;
        if (hookName) {
            Hooks.on(cApi.hooks.DATE_TIME_CHANGE, () => Hooks.callAll(hookName));
            Hooks.on('updateWorldTime', () => Hooks.callAll(hookName));
        }

        // When Calendaria finishes initializing, force-refresh everything
        Hooks.on(cApi.hooks.READY, () => {
            syncCalendarStructure();
            refreshPhoneTime();
            getWidgetInstance().then(inst => {
                if (!inst) return;
                const calApp = inst.apps?.get('calendar');
                if (calApp) {
                    calApp._initialized = false;
                    if (inst.currentApp === 'calendar') calApp.render();
                }
            }).catch(() => {});
        });

        console.log(`${MODULE_ID} | Realtime clock bridge active.`);
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to set up clock bridge:`, err);
    }

    // ==================================================================
    //  4. WEATHER SYNC: Calendaria → Phone weather-data (debounced)
    // ==================================================================
    try {
        /**
         * Calendaria wind speed is an integer 0-5:
         *   0 = calm, 1 = light, 2 = moderate, 3 = strong, 4 = severe, 5 = extreme
         *
         * Mapped to approximate m/s values (the phone UI displays "m/s"):
         *   0 →  0-1  m/s  (midpoint 1)   — calm, smoke rises vertically
         *   1 →  2-5  m/s  (midpoint 3)   — light breeze, leaves rustle
         *   2 →  6-11 m/s  (midpoint 8)   — moderate, small branches move
         *   3 → 12-17 m/s  (midpoint 14)  — strong/windy, whole trees sway
         *   4 → 18-32 m/s  (midpoint 25)  — severe, structural damage possible
         *   5 → 33+   m/s  (midpoint 40)  — extreme (hurricane/tornado force)
         */
        const WIND_MS = Object.freeze([1, 3, 8, 14, 25, 40]);

        /**
         * Convert Calendaria's integer wind speed (0-5) to m/s for display.
         * @param {number} level - 0-5 wind level
         * @returns {number} Wind speed in m/s
         */
        function convertWindSpeed(level) {
            const idx = Math.max(0, Math.min(5, level ?? 0));
            return WIND_MS[idx];
        }

        /**
         * Base humidity by climate zone (annual average %).
         * Sources: general climatology ranges for each biome.
         *
         * Climate zones from Calendaria: arctic, subarctic, temperate,
         * subtropical, tropical, arid, polar
         */
        const ZONE_BASE_HUMIDITY = Object.freeze({
            tropical:    80,
            subtropical: 70,
            temperate:   60,
            subarctic:   55,
            arctic:      50,
            polar:       45,
            arid:        20,
        });

        /**
         * Seasonal humidity modifier (additive %).
         * Seasons from Calendaria: spring, summer, autumn/fall, winter
         */
        const SEASON_HUMIDITY_MOD = Object.freeze({
            spring:  +5,
            summer:  -5,
            autumn:  +5,
            fall:    +5,
            winter:  +0,
        });

        /**
         * Precipitation type humidity boost (additive %).
         * More intense / wetter precip types push humidity higher.
         */
        const PRECIP_HUMIDITY_BOOST = Object.freeze({
            none:        0,
            drizzle:    10,
            rain:       20,
            downpour:   30,
            thunderstorm: 25,
            sleet:      15,
            snow:       10,
            hail:       15,
            blizzard:   20,
            fog:        25,
            mist:       20,
        });

        /**
         * Estimate humidity from climate zone, season, precipitation, and
         * weather intensity. Clamps to 5-99%.
         *
         * @param {object} params
         * @param {string} params.zone       - Climate zone id (e.g. "temperate")
         * @param {string} params.seasonType - Season type (e.g. "spring")
         * @param {string} params.precipType - Precipitation type (e.g. "drizzle")
         * @param {number} params.precipIntensity - 0-1 precipitation intensity
         * @param {number} params.windLevel   - 0-5 wind speed level
         * @param {number} params.tempC       - Temperature in Celsius
         * @returns {number} Estimated humidity percentage (5-99)
         */
        function estimateHumidity({ zone, seasonType, precipType, precipIntensity, windLevel, tempC }) {
            // Start with base humidity from climate zone
            let h = ZONE_BASE_HUMIDITY[zone] ?? ZONE_BASE_HUMIDITY.temperate;

            // Seasonal modifier
            const seasonKey = (seasonType || '').toLowerCase();
            h += SEASON_HUMIDITY_MOD[seasonKey] ?? 0;

            // Precipitation type boost
            const pType = (precipType || 'none').toLowerCase();
            h += PRECIP_HUMIDITY_BOOST[pType] ?? 0;

            // Precipitation intensity scaling (0-1 → 0-15% additional)
            h += Math.round((precipIntensity ?? 0) * 15);

            // High wind reduces humidity slightly (evaporative effect)
            if (windLevel >= 3) h -= 5;
            if (windLevel >= 5) h -= 5;

            // Extreme temperatures push humidity to edges
            // Very hot + dry zone → lower; cold → slightly higher (relative)
            if (tempC > 35 && zone === 'arid') h -= 10;
            if (tempC < -10) h += 5;

            // Clamp to realistic range
            return Math.max(5, Math.min(99, Math.round(h)));
        }

        /** Previous weather hash — only write to settings when something changed. */
        let _lastWeatherHash = '';

        /**
         * Map Calendaria weather → phone weather-data format.
         * Only the GM writes settings; all clients read.
         */
        async function _syncWeatherImpl({ force = false } = {}) {
            if (!game.user.isGM) return;
            try {
                const cw = cApi.getCurrentWeather();
                if (!cw) return;

                const tempC = cw.temperature ?? 0;
                const unit = game.settings.get('smartphone-widget', 'weatherUnit') || 'F';
                const temp = unit === 'F' ? Math.round(tempC * 9 / 5 + 32) : tempC;

                // High/low — ±4°C spread, converted to user's unit
                const highC = tempC + 4, lowC = tempC - 4;
                const high = unit === 'F' ? Math.round(highC * 9 / 5 + 32) : highC;
                const low = unit === 'F' ? Math.round(lowC * 9 / 5 + 32) : lowC;

                // Localize the weather label
                const condition = game.i18n.localize(cw.label) || cw.id || 'Unknown';

                // Normalize icon: "fa-sun" → "fas fa-sun"
                let icon = 'fas fa-cloud';
                if (cw.icon) {
                    icon = /^fa[srlbd] /.test(cw.icon) ? cw.icon : `fas ${cw.icon}`;
                }

                // Wind — convert 0-5 integer to display speed
                const windLevel = cw.wind?.speed ?? 0;
                const windSpeed = convertWindSpeed(windLevel);

                // Precipitation — convert intensity 0-1 to percentage
                const precipIntensity = cw.precipitation?.intensity ?? 0;
                const precip = Math.round(precipIntensity * 100);

                // Climate zone from active calendar's weather config
                let zone = 'temperate';
                try {
                    zone = cApi.getActiveCalendar()?.weather?.activeZone || 'temperate';
                } catch { /* use default */ }

                // Season
                let seasonType = '';
                try {
                    seasonType = cApi.getCurrentSeason()?.seasonalType || '';
                } catch { /* use default */ }

                // Humidity — estimated from climate, season, precipitation, wind, temp
                const humidity = estimateHumidity({
                    zone,
                    seasonType,
                    precipType: cw.precipitation?.type ?? 'none',
                    precipIntensity,
                    windLevel,
                    tempC
                });

                const isNight = !cApi.isDaytime();
                const location = game.scenes.active?.name || '';

                // Build data and check if anything changed
                const weatherData = {
                    temp, condition, isNight, icon, location,
                    high, low, humidity, wind: windSpeed, precip,
                    source: 'calendaria'
                };

                const hash = JSON.stringify(weatherData);
                if (!force && hash === _lastWeatherHash) return; // No change
                _lastWeatherHash = hash;

                await game.settings.set('smartphone-widget', 'weather-data', weatherData);
            } catch (e) {
                console.error(`${MODULE_ID} | Weather sync error:`, e);
            }
        }

        // Debounce weather sync — prevent flooding settings on rapid time ticks
        const syncWeather = debounce(_syncWeatherImpl, 500);

        // Sync on startup (immediate, not debounced)
        _syncWeatherImpl();
        _syncWeatherNow = _syncWeatherImpl;

        // Sync on relevant Calendaria events
        Hooks.on(cApi.hooks.WEATHER_CHANGE, syncWeather);
        Hooks.on(cApi.hooks.DATE_TIME_CHANGE, syncWeather);
        Hooks.on(cApi.hooks.SUNRISE, syncWeather);
        Hooks.on(cApi.hooks.SUNSET, syncWeather);

        console.log(`${MODULE_ID} | Weather sync active.`);
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to set up weather sync:`, err);
    }

    // ==================================================================
    //  5. LOCK WEATHER SOURCE
    // ==================================================================
    try {
        if (game.user.isGM) {
            const currentWeather = game.settings.get('smartphone-widget', 'weather-data') || {};
            if (currentWeather.source !== 'calendaria') {
                currentWeather.source = 'calendaria';
                await game.settings.set('smartphone-widget', 'weather-data', currentWeather);
            }
        }
        console.log(`${MODULE_ID} | Weather source locked to Calendaria.`);
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to lock weather source:`, err);
    }

    // ==================================================================
    //  6. PATCH WeatherApp: wind in mph + proper "feels like" temperature
    // ==================================================================
    try {
        const weatherMod = await import('/modules/smartphone-widget/scripts/apps/WeatherApp.js');
        const WA = weatherMod.WeatherApp;

        if (WA?.prototype?.render) {
            const originalRender = WA.prototype.render;

            /**
             * Convert m/s to mph.
             * @param {number} ms - Speed in m/s
             * @returns {number} Speed in mph (rounded)
             */
            function msToMph(ms) {
                return Math.round((ms ?? 0) * 2.237);
            }

            /**
             * Calculate "feels like" temperature using standard meteorological formulas.
             *
             * Uses NWS Wind Chill (when cold + windy) and Rothfusz Heat Index
             * (when hot + humid), with smooth transitions between regimes.
             *
             * @param {number} tempF    - Air temperature in °F
             * @param {number} windMph  - Wind speed in mph
             * @param {number} humidity - Relative humidity (0-100)
             * @returns {number} Feels-like temperature in °F (rounded)
             */
            function calcFeelsLikeF(tempF, windMph, humidity) {
                // Wind Chill: applies when temp ≤ 50°F and wind > 3 mph
                // NWS Wind Chill formula
                if (tempF <= 50 && windMph > 3) {
                    const wc = 35.74
                        + 0.6215 * tempF
                        - 35.75 * Math.pow(windMph, 0.16)
                        + 0.4275 * tempF * Math.pow(windMph, 0.16);
                    return Math.round(Math.min(wc, tempF));
                }

                // Heat Index: applies when temp ≥ 80°F and humidity ≥ 40%
                // Rothfusz regression equation
                if (tempF >= 80 && humidity >= 40) {
                    const T = tempF, R = humidity;
                    let hi = -42.379
                        + 2.04901523 * T
                        + 10.14333127 * R
                        - 0.22475541 * T * R
                        - 0.00683783 * T * T
                        - 0.05481717 * R * R
                        + 0.00122874 * T * T * R
                        + 0.00085282 * T * R * R
                        - 0.00000199 * T * T * R * R;

                    // Low humidity adjustment
                    if (R < 13 && T >= 80 && T <= 112) {
                        hi -= ((13 - R) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
                    }
                    // High humidity adjustment
                    if (R > 85 && T >= 80 && T <= 87) {
                        hi += ((R - 85) / 10) * ((87 - T) / 5);
                    }

                    return Math.round(Math.max(hi, tempF));
                }

                // Mild range (50-80°F) — combined wind cooling + humidity warming
                //
                // Wind cooling: scales linearly with wind speed, tapers to zero
                // at 90°F. At 70°F + 56 mph ≈ 5°F drop. At 55°F + 56 mph ≈ 8°F.
                // Uses max() to ensure the taper factor doesn't go negative.
                //
                // Humidity warming: above 65°F, high humidity makes it feel
                // warmer (mugginess). Scales with both humidity and temp.
                let feels = tempF;

                // Wind cooling — effective from below 90°F when wind > 3 mph
                if (windMph > 3) {
                    const taper = Math.max(0, (90 - tempF) / 40); // 1.0 at 50°F, 0.25 at 80°F, 0 at 90°F
                    const windCooling = windMph * 0.15 * taper;
                    feels -= windCooling;
                }

                // Humidity warming — muggy conditions above 65°F
                if (humidity > 50 && tempF > 65) {
                    const humidityExcess = (humidity - 50) / 50; // 0-1 scale
                    const tempFactor = (tempF - 65) / 15;        // 0 at 65°F, 1 at 80°F
                    const humidityWarming = humidityExcess * tempFactor * 4; // up to ~4°F
                    feels += humidityWarming;
                }

                return Math.round(feels);
            }

            /**
             * Convert °C to °F.
             */
            function cToF(c) { return c * 9 / 5 + 32; }
            function fToC(f) { return (f - 32) * 5 / 9; }

            /**
             * Open a weather preset selection dialog, then call setWeather.
             */
            async function openWeatherPicker() {
                if (typeof CALENDARIA === 'undefined' || !CALENDARIA?.api) {
                    ui.notifications.warn('Calendaria not available.');
                    return;
                }
                const calApi = CALENDARIA.api;

                let presets;
                try { presets = await calApi.getWeatherPresets(); } catch { presets = null; }
                if (!presets) return;
                if (!Array.isArray(presets)) {
                    try { presets = Object.values(presets); } catch { return; }
                }
                if (!presets.length) { ui.notifications.warn('No weather presets.'); return; }

                const btns = presets.map(p => {
                    const icon = p.icon ? (/^fa[srlbd] /.test(p.icon) ? p.icon : `fas ${p.icon}`) : 'fas fa-cloud';
                    const label = game.i18n.localize(p.label) || p.label || p.id || '?';
                    const color = p.color || '#868e96';
                    return `<button class="smcal-wp-btn" data-id="${p.id}"
                        style="border-left:4px solid ${color};text-align:left;padding:6px 10px;margin:2px 0;width:100%;cursor:pointer;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,0.05);border-radius:4px;">
                        <i class="${icon}" style="color:${color};width:20px;text-align:center;"></i>
                        <span>${label}</span></button>`;
                }).join('');

                const dlg = new Dialog({
                    title: game.i18n.localize('SMCAL.selectWeather') || 'Select Weather',
                    content: `<div style="max-height:400px;overflow-y:auto;padding:4px;">${btns}</div>`,
                    buttons: { cancel: { icon: '<i class="fas fa-times"></i>', label: game.i18n.localize('SMCAL.cancel') || 'Cancel' } },
                    default: 'cancel',
                    render: (html) => {
                        html[0].querySelectorAll('.smcal-wp-btn').forEach(btn => {
                            btn.addEventListener('click', async () => {
                                try {
                                    await calApi.setWeather(btn.dataset.id);
                                    // Force immediate weather sync (bypass debounce + hash check)
                                    if (_syncWeatherNow) await _syncWeatherNow({ force: true });
                                    ui.notifications.info(`Weather: ${btn.querySelector('span')?.textContent}`);
                                    // Re-render weather app after setting is saved
                                    try {
                                        const inst = await getWidgetInstance();
                                        const wa = inst?.apps?.get('weather');
                                        if (wa) wa.render();
                                    } catch {};
                                } catch (err) { console.error(`${MODULE_ID} | setWeather:`, err); }
                                dlg.close();
                            });
                        });
                    }
                }, { width: 300 });
                dlg.render(true);
            }

            WA.prototype.render = async function () {
                // Call original render first to populate this.data and all DOM
                await originalRender.call(this);

                // Now patch the rendered DOM in-place
                if (!this.element) return;

                const currentUnit = game.settings.get('smartphone-widget', 'weatherUnit') || 'C';
                const windMs = this.data?.wind ?? 0;
                const windMph = msToMph(windMs);
                const tempRaw = this.data?.temp;
                const humidity = this.data?.humidity ?? 50;

                // --- Patch wind display: m/s → mph ---
                const windValueEl = this.element.querySelector('.weather-grid .grid-item:nth-child(2) .value');
                if (windValueEl) {
                    windValueEl.textContent = `${windMph} mph`;
                }

                // --- Patch "feels like" display ---
                const feelsEl = this.element.querySelector('.weather-grid .grid-item:nth-child(4) .value');
                if (feelsEl && tempRaw != null) {
                    // Convert temp to °F for formula regardless of display unit
                    const tempF = currentUnit === 'F' ? tempRaw : cToF(tempRaw);
                    const feelsF = calcFeelsLikeF(tempF, windMph, humidity);

                    // Convert back to display unit
                    const feelsDisplay = currentUnit === 'F'
                        ? feelsF
                        : Math.round(fToC(feelsF));

                    feelsEl.textContent = `${feelsDisplay}°`;
                }

                // --- Replace "Reroll" with "Select Weather" for Calendaria source ---
                const canChangeWeather = (() => {
                    try { const r = CALENDARIA?.permissions?.hasPermission?.('changeWeather'); return r != null ? !!r : game.user.isGM; }
                    catch { return game.user.isGM; }
                })();
                if (canChangeWeather && this.data?.source === 'calendaria') {
                    const rerollBtn = this.element.querySelector('[data-action="reroll"]');
                    if (rerollBtn) {
                        const newBtn = rerollBtn.cloneNode(false);
                        newBtn.innerHTML = `<i class="fas fa-cloud-sun-rain"></i> ${game.i18n.localize('SMCAL.selectWeather') || 'Select Weather'}`;
                        newBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openWeatherPicker(); });
                        rerollBtn.parentNode.replaceChild(newBtn, rerollBtn);
                    }

                    // Hide native Weather Settings (not applicable for Calendaria)
                    const settingsBtn = this.element.querySelector('[data-action="settings"]');
                    if (settingsBtn) settingsBtn.style.display = 'none';
                }
            };

            console.log(`${MODULE_ID} | WeatherApp patched (wind mph + feels-like + select weather).`);
        }
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to patch WeatherApp:`, err);
    }

    // ==================================================================
    //  7. PATCH SettingsApp — inject Calendar Theme into App Themes menu
    // ==================================================================
    try {
        const settingsMod = await import('/modules/smartphone-widget/scripts/apps/SettingsApp.js');
        const SA = settingsMod.SettingsApp;

        // --- Patch showAppThemesMenu to add our entry + listener ---
        // We inject after origShowAppThemes (which calls updateContent → setupListeners),
        // so we must attach the click listener directly here rather than relying on
        // setupAppThemesMenuListeners (which has already run before our element exists).
        const origShowAppThemes = SA.prototype.showAppThemesMenu;
        SA.prototype.showAppThemesMenu = function () {
            origShowAppThemes.call(this);
            if (!this.element) return;
            const list = this.element.querySelector('.settings-content.settings-list');
            if (!list) return;
            if (list.querySelector('[data-action="calendar-theme-select"]')) return;
            const item = document.createElement('div');
            item.className = 'settings-item';
            item.dataset.action = 'calendar-theme-select';
            item.innerHTML = `<i class="fas fa-calendar-alt"></i><span>${game.i18n.localize('SMCAL.theme')}</span>`;
            list.appendChild(item);
            item.addEventListener('click', () => this._showCalendarThemeSettings());
        };

        // --- Add calendar theme sub-view ---
        SA.prototype._showCalendarThemeSettings = function () {
            this.activeSubView = 'calendar-theme';
            let currentTheme;
            try { currentTheme = game.settings.get(MODULE_ID, 'calendarTheme') || 'default'; } catch { currentTheme = 'default'; }
            const themes = [
                { id: 'default',          label: game.i18n.localize('SMCAL.themeDefault') },
                { id: 'golden-squares',   label: game.i18n.localize('SMCAL.themeGoldenSquares') }
            ];
            const items = themes.map(t => `
                <div class="theme-select-item" data-theme="${t.id}">
                    <span>${t.label}</span>
                    ${currentTheme === t.id ? '<i class="fas fa-check"></i>' : ''}
                </div>`).join('');
            const content = `
                <div class="settings-sub-view">
                    <div class="app-header">
                        <div class="header-left"><button class="back-btn" data-action="back-to-app-themes"><i class="fas fa-arrow-left"></i></button></div>
                        <div class="header-title">${game.i18n.localize('SMCAL.theme')}</div>
                    </div>
                    <div class="settings-content">
                        <div class="theme-selection-list">${items}</div>
                    </div>
                </div>`;
            this.updateContent(content);
        };

        // --- Patch setupListeners to handle our sub-view ---
        const origSetupListeners = SA.prototype.setupListeners;
        SA.prototype.setupListeners = function () {
            origSetupListeners.call(this);
            if (this.activeSubView === 'calendar-theme') {
                this._setupCalendarThemeListeners();
            }
        };

        SA.prototype._setupCalendarThemeListeners = function () {
            const backBtn = this.element?.querySelector('.back-btn[data-action="back-to-app-themes"]');
            if (backBtn) backBtn.addEventListener('click', () => this.showAppThemesMenu());
            this.element?.querySelectorAll('.theme-select-item').forEach(item => {
                item.addEventListener('click', async () => {
                    const selected = item.dataset.theme;
                    await game.settings.set(MODULE_ID, 'calendarTheme', selected);
                    this._showCalendarThemeSettings();
                    this.widget?.showToastNotification?.(game.i18n.localize('SMARTPHONE.notifications.themeChanged'));
                });
            });
        };

        // --- Padlock: GM can lock "Always Show Home Button" for all players ---
        // Adds a small padlock icon next to the existing toggle. Clicking it
        // toggles the world-scoped `forcePlayerHomeButton` setting. When locked,
        // non-GM players see the toggle as checked + disabled.
        const origShowGeneral = SA.prototype.showGeneralSettings;
        SA.prototype.showGeneralSettings = async function () {
            await origShowGeneral.call(this);
            if (!this.element) return;
            const homeToggle = this.element.querySelector('#show-persistent-home-toggle');
            if (!homeToggle) return;
            const toggleRow = homeToggle.closest('.settings-item-toggle');
            if (!toggleRow) return;

            let forceOn = false;
            try { forceOn = !!game.settings.get(MODULE_ID, 'forcePlayerHomeButton'); } catch {}

            if (game.user.isGM) {
                if (toggleRow.querySelector('.smcal-padlock')) return;
                const padlock = document.createElement('button');
                padlock.className = 'smcal-padlock';
                padlock.title = forceOn ? 'Unlock for players' : 'Lock for all players';
                padlock.innerHTML = `<i class="fas ${forceOn ? 'fa-lock' : 'fa-lock-open'}"></i>`;
                padlock.style.cssText = 'all:unset;cursor:pointer;display:flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:0.8em;border-radius:4px;flex-shrink:0;margin-left:4px;color:' + (forceOn ? '#b5770a' : '#888') + ';';
                padlock.addEventListener('click', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    let current = false;
                    try { current = !!game.settings.get(MODULE_ID, 'forcePlayerHomeButton'); } catch {}
                    const next = !current;
                    try { await game.settings.set(MODULE_ID, 'forcePlayerHomeButton', next); }
                    catch (err) { console.warn(`${MODULE_ID} | set forcePlayerHomeButton:`, err); return; }
                    const icon = padlock.querySelector('i');
                    if (icon) icon.className = `fas ${next ? 'fa-lock' : 'fa-lock-open'}`;
                    padlock.title = next ? 'Unlock for players' : 'Lock for all players';
                    padlock.style.color = next ? '#b5770a' : '#888';
                });
                toggleRow.appendChild(padlock);
            } else if (forceOn) {
                homeToggle.checked = true;
                homeToggle.disabled = true;
                const switchLabel = homeToggle.closest('label.switch');
                if (switchLabel) switchLabel.style.opacity = '0.5';
            }
        };


        console.log(`${MODULE_ID} | SettingsApp patched (calendar theme in App Themes menu).`);
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to patch SettingsApp:`, err);
    }

    // ==================================================================
    //  8. PATCH WidgetManager — reapply player home-button override on render
    // ==================================================================
    try {
        const wmMod = await import('/modules/smartphone-widget/scripts/core/WidgetManager.js');
        const WM = wmMod.WidgetManager;
        const origOnRender = WM.prototype._onRender;
        WM.prototype._onRender = function (context, options) {
            const ret = origOnRender.call(this, context, options);
            try { _applyPlayerHomeButton(); } catch {}
            return ret;
        };
        // Also apply once at ready (in case the widget already rendered before us).
        _applyPlayerHomeButton();
        console.log(`${MODULE_ID} | WidgetManager patched (player home button override).`);
    } catch (err) {
        console.error(`${MODULE_ID} | Failed to patch WidgetManager:`, err);
    }
});

