/**
 * CalendariaPhoneApp — Smartphone Widget calendar replacement.
 * Displays Calendaria notes (read-only) + phone-native events (CRUD).
 * All visual styles in styles/calendar.css — zero inline styles.
 * @module calendaria-phone-app
 */
import { BaseApp } from '/modules/smartphone-widget/scripts/apps/BaseApp.js';

const VIEW = Object.freeze({ CALENDAR: 'calendar', EVENT_FORM: 'eventForm', PINNED: 'pinned' });
const MODULE_ID = 'calendaria-phone-app';
const I18N = 'SMCAL';
const DEFAULT_COLOR = '#4a9eff';
const COLORS = Object.freeze(['#4a9eff','#ff6b6b','#51cf66','#fcc419','#845ef7','#20c997','#f06595','#868e96']);
const MAX_EXPAND = 'calc(1.4em * 10)';
const THEMES = Object.freeze(['default', 'golden-squares']);

const DEFAULT_DATE_FORMAT = '{Y}, {M}';
/* Legacy preset keys → token strings. Lets users who saved a preset value
   before the custom-format migration still see a sensible default. */
const LEGACY_DATE_FORMATS = Object.freeze({
    'ymonth':         '{Y}, {M}',
    'ymonthShort':    '{Y}, {m}',
    'monthYear':      '{M} {Y}',
    'monthShortYear': '{m} {Y}',
    'slashYM':        '{Y}/{m#}',
    'slashMY':        '{m#}/{Y}',
    'dashYM':         '{Y}-{m#}',
    'dashMY':         '{m#}-{Y}'
});

/* ==================== Utility helpers ==================== */

// Calendaria API is optional. When absent, we fall back to a Gregorian calendar
// backed by Foundry's game.time.worldTime (seconds since Unix epoch by convention).
function cApi() { return (typeof CALENDARIA !== 'undefined' && CALENDARIA?.api) ? CALENDARIA.api : null; }
function hasCalendaria() { return !!cApi(); }

/* Gregorian fallback — used when Calendaria isn't installed/enabled. */
const GREGORIAN_MONTHS = Object.freeze([
    { name: 'January',   abbreviation: 'Jan', days: 31 },
    { name: 'February',  abbreviation: 'Feb', days: 28, leapDays: 29 },
    { name: 'March',     abbreviation: 'Mar', days: 31 },
    { name: 'April',     abbreviation: 'Apr', days: 30 },
    { name: 'May',       abbreviation: 'May', days: 31 },
    { name: 'June',      abbreviation: 'Jun', days: 30 },
    { name: 'July',      abbreviation: 'Jul', days: 31 },
    { name: 'August',    abbreviation: 'Aug', days: 31 },
    { name: 'September', abbreviation: 'Sep', days: 30 },
    { name: 'October',   abbreviation: 'Oct', days: 31 },
    { name: 'November',  abbreviation: 'Nov', days: 30 },
    { name: 'December',  abbreviation: 'Dec', days: 31 }
]);
const GREGORIAN_WEEKDAYS = Object.freeze([
    { name: 'Sunday',    abbreviation: 'Su' },
    { name: 'Monday',    abbreviation: 'Mo' },
    { name: 'Tuesday',   abbreviation: 'Tu' },
    { name: 'Wednesday', abbreviation: 'We' },
    { name: 'Thursday',  abbreviation: 'Th' },
    { name: 'Friday',    abbreviation: 'Fr' },
    { name: 'Saturday',  abbreviation: 'Sa' }
]);

function isGregorianLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function currentDateTime() {
    const api = cApi();
    if (api) {
        const dt = api.getCurrentDateTime?.() ?? null;
        if (!dt) return null;
        if (dt.day == null && dt.dayOfMonth != null) dt.day = dt.dayOfMonth;
        return dt;
    }
    // Gregorian fallback via Foundry world time.
    try {
        const ms = (game.time?.timestamp ?? (game.time?.worldTime ?? 0) * 1000);
        const d = new Date(ms);
        return {
            year: d.getUTCFullYear(),
            month: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            dayOfMonth: d.getUTCDate(),
            hour: d.getUTCHours(),
            minute: d.getUTCMinutes(),
            second: d.getUTCSeconds()
        };
    } catch {
        return { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
    }
}

function esc(s) {
    if (typeof s !== 'string') return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function loc(k, fb) { const r = game.i18n.localize(k); return (r === k && fb !== undefined) ? fb : r; }
function fmtTime(h, m) { return `${String(h??0).padStart(2,'0')}:${String(m??0).padStart(2,'0')}`; }
function canDo(p) { try { const r = CALENDARIA?.permissions?.hasPermission?.(p); if (r != null) return !!r; } catch {} return game.user.isGM; }
function showDeleteBtn() { try { return game.settings.get(MODULE_ID, 'deleteMode') === 'button'; } catch { return false; } }
function actionsHoverOnly() { try { return game.settings.get(MODULE_ID, 'actionButtonsVisibility') === 'hover'; } catch { return false; } }
function timeToMin(t) { if (!t || t === '00:00') return -1; const [h,m] = t.split(':').map(Number); return h * 60 + (m||0); }
function nl2br(s) { return (s || '').replace(/\n/g, '<br>'); }
function ordinal(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return n + 'th';
    switch (n % 10) { case 1: return n + 'st'; case 2: return n + 'nd'; case 3: return n + 'rd'; default: return n + 'th'; }
}

/* ==================== Calendar data (cached) ==================== */

const _cache = { months: null, weekdays: null };
function _invalidateCache() { _cache.months = null; _cache.weekdays = null; }

function getMonths() {
    if (_cache.months) return _cache.months;
    try {
        const cal = cApi()?.getActiveCalendar?.();
        if (cal) {
            _cache.months = (Array.isArray(cal.monthsArray) && cal.monthsArray.length)
                ? cal.monthsArray
                : Object.values(cal.months?.values ?? {}).sort((a,b) => (a.ordinal??0) - (b.ordinal??0));
        } else {
            _cache.months = GREGORIAN_MONTHS;
        }
    } catch { _cache.months = GREGORIAN_MONTHS; }
    return _cache.months;
}

function getWeekdays() {
    if (_cache.weekdays) return _cache.weekdays;
    try {
        const cal = cApi()?.getActiveCalendar?.();
        if (cal) {
            _cache.weekdays = (Array.isArray(cal.weekdaysArray) && cal.weekdaysArray.length)
                ? cal.weekdaysArray
                : Object.values(cal.days?.values ?? {}).sort((a,b) => (a.ordinal??0) - (b.ordinal??0));
        } else {
            _cache.weekdays = GREGORIAN_WEEKDAYS;
        }
    } catch { _cache.weekdays = GREGORIAN_WEEKDAYS; }
    return _cache.weekdays;
}

function getMonthName(i) { return getMonths()[i-1]?.name ?? `Month ${i}`; }

function getDaysInMonth(year, month) {
    try {
        const m = getMonths()[month-1]; if (!m) return 30;
        if (m.leapDays != null) {
            // With Calendaria, pull its leap config. Without, fall back to Gregorian rules.
            const cfg = cApi()?.getActiveCalendar?.()?.leapYearConfig;
            if (cfg) {
                const leap = cfg.type === 'gregorian' ? isGregorianLeap(year)
                    : (cfg.interval ? year % cfg.interval === 0 : false);
                if (leap) return m.leapDays;
            } else if (!hasCalendaria() && isGregorianLeap(year)) {
                return m.leapDays;
            }
        }
        return m.days ?? 30;
    } catch { return 30; }
}

function getWeekdayFor(y, m, d) {
    const api = cApi();
    if (api) { try { return api.dayOfWeek({ year: y, month: m, day: d }) ?? 0; } catch { return 0; } }
    // Gregorian fallback: use JS Date in UTC.
    try {
        const js = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
        return js.getUTCDay();
    } catch { return 0; }
}

function getHoursPerDay() { try { return cApi()?.getActiveCalendar?.()?.days?.hoursPerDay ?? 24; } catch { return 24; } }
function getMinutesPerHour() { try { return cApi()?.getActiveCalendar?.()?.days?.minutesPerHour ?? 60; } catch { return 60; } }

// A note is recurring if it has a non-trivial conditionTree (Calendaria's new recurrence system)
// or the legacy `repeat` field (pre-conditionTree notes).
function isRecurring(fd) {
    if (!fd) return false;
    if (fd.repeat && fd.repeat !== 'never') return true;
    const ct = fd.conditionTree;
    if (!ct) return false;
    if (ct.type === 'group' && Array.isArray(ct.children) && ct.children.length) return true;
    if (ct.type === 'condition' && ct.field) return true;
    return false;
}

function filterNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes.filter(n => {
        if (!n.visible) return false;
        const fd = n.flagData ?? {};
        if (fd.visibility && fd.visibility !== 'visible') return false;
        if (fd.gmOnly && !game.user.isGM) return false;
        return true;
    });
}

/* ==================== Calendaria pin storage (per-phone) ==================== */

let _pinOverride = null;
function _clearPinOverride() { _pinOverride = null; }
function _readAllCalPins() {
    if (_pinOverride) return structuredClone(_pinOverride);
    try {
        const v = JSON.parse(game.settings.get(MODULE_ID, 'calPinnedNotes') || '{}');
        if (Array.isArray(v)) return {};
        return (typeof v === 'object' && v !== null) ? v : {};
    } catch { return {}; }
}
function getCalPins(pid) { return pid ? (_readAllCalPins()[pid] || []) : []; }
async function setCalPins(pid, arr) {
    if (!pid) return;
    if (game.user.isGM) {
        const all = _readAllCalPins();
        if (arr.length) all[pid] = arr; else delete all[pid];
        try { await game.settings.set(MODULE_ID, 'calPinnedNotes', JSON.stringify(all)); } catch {}
    } else {
        const all = _readAllCalPins();
        if (arr.length) all[pid] = arr; else delete all[pid];
        _pinOverride = all;
        game.socket.emit(`module.${MODULE_ID}`, { action: 'setCalPins', pid, arr });
    }
}
function isCalPinned(pid, noteId) { return getCalPins(pid).includes(noteId); }

/* ==================== Custom categories (standalone mode) ==================== */

/** Read the user-defined category list from world settings.
 *  Structure: [{ id: string, name: string, color: string, icon: string }] */
function getCustomCategories() {
    try { const v = JSON.parse(game.settings.get(MODULE_ID, 'customCategories') || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
}
async function setCustomCategories(arr) {
    try { await game.settings.set(MODULE_ID, 'customCategories', JSON.stringify(arr)); } catch {}
}

async function toggleCalPin(pid, noteId) {
    const pins = getCalPins(pid);
    const idx = pins.indexOf(noteId);
    if (idx >= 0) pins.splice(idx, 1); else pins.push(noteId);
    await setCalPins(pid, pins);
}

/* ==================== Phone event storage ==================== */

const EVT_KEY = 'calendar-events';

// Date keys are zero-padded (`1970-06-02`). Values sort lexicographically only
// when year/month/day all stay within their default widths. Non-Gregorian calendars
// with 100+ days per month would break sort order — unlikely in practice.
function dateKey(y,m,d) { return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

function _readAll() {
    try { return game.settings.get('smartphone-widget', EVT_KEY) || {}; } catch { return {}; }
}
let _calSocket = null;
async function _getCalSocket() {
    if (_calSocket) return _calSocket;
    const { CalendarApp } = await import('/modules/smartphone-widget/scripts/apps/CalendarApp.js');
    _calSocket = CalendarApp.socket;
    return _calSocket;
}
async function _socketUpdateEvent(phoneId, dateStr, event) {
    const s = await _getCalSocket();
    return s.executeAsGM('updateCalendarEvent', { phoneId, dateStr, event });
}
async function _socketDeleteEvent(phoneId, dateStr, eventId) {
    const s = await _getCalSocket();
    return s.executeAsGM('deleteCalendarEvent', { phoneId, dateStr, eventId });
}

// Per-render cache: loadMap is called multiple times inside a single render (grid dots,
// day info, all-events, all-pinned). This cache is cleared at the start/end of each
// render and after every write via _clearMapCache().
const _mapCache = new Map();
function _clearMapCache() { _mapCache.clear(); }
function loadMap(pid) {
    if (!pid) return new Map();
    const cached = _mapCache.get(pid);
    if (cached) return cached;
    const m = new Map((_readAll()[pid] || []).map(e => [e[0], e[1]]));
    _mapCache.set(pid, m);
    return m;
}
function getEvts(pid,y,m,d) { const map = loadMap(pid); return map.get(dateKey(y,m,d)) || map.get(`${y}-${m}-${d}`) || []; }
function getEvtDays(pid,year,month) {
    const map = loadMap(pid); const days = new Set();
    const pp = `${year}-${String(month).padStart(2,'0')}-`, rp = `${year}-${month}-`;
    for (const [k,evts] of map) if (evts?.length && (k.startsWith(pp)||k.startsWith(rp))) { const d = parseInt(k.split('-')[2]); if (d>0) days.add(d); }
    return days;
}
async function addEvt(pid, y, m, d, evt) {
    _clearMapCache();
    await _socketUpdateEvent(pid, dateKey(y, m, d), evt);
}
async function delEvt(pid, id) {
    const map = loadMap(pid);
    for (const [dk, ev] of map) {
        if (ev.some(e => e.id === id)) {
            _clearMapCache();
            await _socketDeleteEvent(pid, dk, id);
            return;
        }
    }
}
async function delAllEvts(pid, y, m, d) {
    const map = loadMap(pid);
    const dk = dateKey(y, m, d);
    const lg = `${y}-${m}-${d}`;
    const evts = map.get(dk) || (dk !== lg ? map.get(lg) : null) || [];
    if (!evts.length) return;
    const key = map.has(dk) ? dk : lg;
    _clearMapCache();
    for (const e of evts) await _socketDeleteEvent(pid, key, e.id);
}
async function togglePin(pid, evtId) {
    const map = loadMap(pid);
    for (const [dk, evts] of map) {
        const e = evts.find(x => x.id === evtId);
        if (e) {
            _clearMapCache();
            await _socketUpdateEvent(pid, dk, { ...e, pinned: !e.pinned });
            return;
        }
    }
}
function getAllPinned(pid) {
    const results = [];
    // Phone events (skip year-0 orphaned entries)
    const map = loadMap(pid);
    for (const [dk,evts] of map) { if (dk.startsWith('0-')) continue; for (const e of evts) if (e.pinned) results.push({...e, _dateKey: dk, _type:'phone'}); }
    // Calendaria notes — use nearest occurrence for recurring events
    const pins = getCalPins(pid);
    if (pins.length) {
        try {
            const api = cApi();
            // filterNotes respects permission/visibility in case a pinned note's
            // visibility changed after being pinned.
            const all = filterNotes(api?.getAllNotes?.() ?? []);
            for (const n of all) {
                if (!pins.includes(n.id)) continue;
                const fd = n.flagData ?? {};
                const sd = fd.startDate ?? {};
                const pubApi = sd.day != null;
                let yr, mo, dy;

                if (isRecurring(fd) && api?.getNextOccurrences) {
                    try {
                        const occs = api.getNextOccurrences(n.id, 1);
                        if (occs.length) { const o = occs[0]; yr = o.year; mo = o.month; dy = o.day ?? o.dayOfMonth; }
                    } catch {}
                }

                if (yr == null) {
                    const curDt = currentDateTime();
                    yr = (sd.year ?? 0) || curDt?.year || 0;
                    mo = pubApi ? sd.month : (sd.month??0)+1;
                    dy = sd.day ?? ((sd.dayOfMonth??0)+1);
                }

                results.push({
                    title: n.name, time: fd.allDay ? '00:00' : fmtTime(fd.startDate?.hour,fd.startDate?.minute),
                    endTime: fd.endDate ? fmtTime(fd.endDate?.hour,fd.endDate?.minute) : '',
                    color: (fd.color?.css ?? fd.color) || DEFAULT_COLOR, _dateKey: dateKey(yr, mo, dy),
                    _type: 'cal', noteId: n.id, _note: n,
                    category: fd.categories?.[0] || '', _catIcon: fd.icon || ''
                });
            }
        } catch {}
    }
    return results;
}

function getAllEvents(pid) {
    const results = [];
    // Phone events (skip year-0 entries — orphaned annual holidays from built-in calendar)
    const map = loadMap(pid);
    for (const [dk,evts] of map) { if (dk.startsWith('0-')) continue; for (const e of evts) results.push({...e, _dateKey: dk, _type:'phone'}); }
    // Calendaria notes — use nearest occurrence for recurring events
    try {
        const api = cApi();
        const all = filterNotes(api?.getAllNotes?.() ?? []);
        for (const n of all) {
            const fd = n.flagData ?? {};
            // Recurring events live in the Recurring tab only
            if (isRecurring(fd)) continue;
            const sd = fd.startDate ?? {};
            const pubApi = sd.day != null;
            const curDt = currentDateTime();
            const yr = (sd.year ?? 0) || curDt?.year || 0;
            const mo = pubApi ? sd.month : (sd.month??0)+1;
            const dy = sd.day ?? ((sd.dayOfMonth??0)+1);

            results.push({
                title: n.name, time: fd.allDay ? '00:00' : fmtTime(fd.startDate?.hour,fd.startDate?.minute),
                endTime: fd.endDate ? fmtTime(fd.endDate?.hour,fd.endDate?.minute) : '',
                color: (fd.color?.css ?? fd.color) || DEFAULT_COLOR, _dateKey: dateKey(yr, mo, dy),
                _type: 'cal', noteId: n.id, pinned: isCalPinned(pid, n.id),
                category: fd.categories?.[0] || '', _catIcon: fd.icon || '',
                _note: n
            });
        }
    } catch {}
    results.sort((a,b) => a._dateKey < b._dateKey ? -1 : a._dateKey > b._dateKey ? 1 : timeToMin(a.time||'00:00') - timeToMin(b.time||'00:00'));
    return results;
}

function getAllRecurring(pid) {
    const results = [];
    try {
        const api = cApi();
        const all = filterNotes(api?.getAllNotes?.() ?? []);
        for (const n of all) {
            const fd = n.flagData ?? {};
            // Only recurring events
            if (!isRecurring(fd)) continue;
            const sd = fd.startDate ?? {};
            const pubApi = sd.day != null;
            let yr, mo, dy, ended = false;

            if (api?.getNextOccurrences) {
                try {
                    const occs = api.getNextOccurrences(n.id, 1);
                    if (occs.length) { const o = occs[0]; yr = o.year; mo = o.month; dy = o.day ?? o.dayOfMonth; }
                } catch {}
            }
            // Fallback 1: some notes (e.g. pre-built festivals like Winter Solstice) have
            // condition trees that getNextOccurrences misses. Try a broad forward range.
            if (yr == null && api?.getNoteOccurrencesInRange) {
                try {
                    const curDt = currentDateTime();
                    if (curDt) {
                        const end = { year: curDt.year + 5, month: getMonths().length || 12, day: 28 };
                        const start = { year: curDt.year, month: curDt.month, day: curDt.day };
                        const occs = api.getNoteOccurrencesInRange(n.id, start, end, 1);
                        if (occs?.length) { const o = occs[0]; yr = o.year; mo = o.month; dy = o.day ?? o.dayOfMonth; }
                    }
                } catch {}
            }
            // Fallback 2: use startDate as a last resort, mark as ended
            if (yr == null) {
                const curDt = currentDateTime();
                yr = (sd.year ?? 0) || curDt?.year || 0;
                mo = pubApi ? sd.month : (sd.month??0)+1;
                dy = sd.day ?? ((sd.dayOfMonth??0)+1);
                ended = true;
            }

            results.push({
                title: n.name, time: fd.allDay ? '00:00' : fmtTime(fd.startDate?.hour,fd.startDate?.minute),
                endTime: fd.endDate ? fmtTime(fd.endDate?.hour,fd.endDate?.minute) : '',
                color: (fd.color?.css ?? fd.color) || DEFAULT_COLOR, _dateKey: dateKey(yr, mo, dy),
                _type: 'cal', noteId: n.id, pinned: isCalPinned(pid, n.id),
                category: fd.categories?.[0] || '', _catIcon: fd.icon || '',
                _note: n, _ended: ended
            });
        }
    } catch {}
    // Active first (by date), ended at bottom (by date)
    results.sort((a,b) => {
        if (a._ended !== b._ended) return a._ended ? 1 : -1;
        if (a._dateKey < b._dateKey) return -1;
        if (a._dateKey > b._dateKey) return 1;
        return timeToMin(a.time||'00:00') - timeToMin(b.time||'00:00');
    });
    return results;
}

/* ==================== CalendariaPhoneApp ==================== */

export class CalendariaPhoneApp extends BaseApp {
    static _activeInstance = null;
    static _hasFocus = false;
    static _globalListenerAttached = false;
    static _clearPinOverride() { _clearPinOverride(); }

    static _attachGlobalListener() {
        if (CalendariaPhoneApp._globalListenerAttached) return;
        CalendariaPhoneApp._globalListenerAttached = true;

        // Track focus: clicking inside the phone gives focus, clicking outside removes it
        document.addEventListener('pointerdown', (e) => {
            CalendariaPhoneApp._hasFocus = !!e.target.closest('.smartphone-frame');
        }, true);

        // Escape key — cancel/back when phone focused and in form view.
        // Disabled entirely when the 'escapeGoesBack' setting is off.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || !CalendariaPhoneApp._hasFocus) return;
            let escapeEnabled = true;
            try { escapeEnabled = game.settings.get(MODULE_ID, 'escapeGoesBack'); } catch {}
            if (!escapeEnabled) return;
            const inst = CalendariaPhoneApp._activeInstance;
            if (!inst || inst.widget.currentApp !== 'calendar') return;
            if (inst.currentView === VIEW.EVENT_FORM) {
                e.preventDefault();
                e.stopPropagation();
                inst.currentView = VIEW.CALENDAR;
                inst.editingNote = null;
                inst.render();
            } else if (inst.currentView === VIEW.PINNED) {
                e.preventDefault();
                e.stopPropagation();
                inst.currentView = VIEW.CALENDAR;
                inst.render();
            } else if (inst.currentView === VIEW.CALENDAR) {
                e.preventDefault();
                e.stopPropagation();
                // Click the phone's physical home button to navigate home
                const frame = inst.element?.closest?.('.smartphone-frame') ?? document.querySelector('.smartphone-frame');
                const homeBtn = frame?.querySelector('.home-button, .home-btn, [data-action="home"]');
                if (homeBtn) homeBtn.click();
                CalendariaPhoneApp._hasFocus = false;
            }
        }, true);
    }

    /**
     * Called by game.keybindings. Returns true to consume the event (phone focused),
     * false to let Foundry handle it (token movement, etc).
     */
    static _handleKeybind(dir) {
        if (!CalendariaPhoneApp._hasFocus) return false;
        const inst = CalendariaPhoneApp._activeInstance;
        if (!inst || inst.currentView !== VIEW.CALENDAR || inst.widget.currentApp !== 'calendar') return false;
        if (['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) return false;

        const { year, month, day } = inst.selectedDate;
        const dim = getDaysInMonth(year,month), numWd = getWeekdays().length||7, nmm = getMonths().length||12;
        let nd = day, nmo = month, ny = year;
        switch (dir) {
            case 'left': nd--; break;
            case 'right': nd++; break;
            case 'up': nd -= numWd; break;
            case 'down': nd += numWd; break;
        }
        if (nd < 1) { nmo--; if(nmo<1){nmo=nmm;ny--;} nd = getDaysInMonth(ny,nmo)+nd; }
        else if (nd > dim) { nd -= dim; nmo++; if(nmo>nmm){nmo=1;ny++;} }
        inst.selectedDate = { year:ny, month:nmo, day:nd };
        inst.currentDisplayDate = { year:ny, month:nmo };
        inst._userSelected = true; inst.render();
        return true; // consumed
    }

    constructor(widget) {
        super(widget);
        this.currentDisplayDate = { year: 0, month: 1 };
        this.selectedDate = { year: 0, month: 1, day: 1 };
        this._userSelected = false;
        this._initialized = false;
        this._rendering = false;
        this.currentView = VIEW.CALENDAR;
        this.editingNote = null;
        this.notesTab = 'events'; // 'events' | 'recurring' | 'pinned'
        this.notesSearch = '';
        // Load persisted preferences
        try { this.sortMode = game.settings.get(MODULE_ID, 'sortMode') || 'time'; } catch { this.sortMode = 'time'; }
        try { this.sortAsc = game.settings.get(MODULE_ID, 'sortAsc') ?? true; } catch { this.sortAsc = true; }
        try { this.compact = game.settings.get(MODULE_ID, 'compact') ?? true; } catch { this.compact = true; }
        this._onTimeChange = () => this._handleTimeChange();
        this._onNoteChange = () => this._handleNoteChange();
    }

    /* ==================== Lifecycle ==================== */

    async onPhoneChanged() { if (this.widget.currentApp === 'calendar') this.render(); }

    async loadEvents() { _clearMapCache(); }

    async render() {
        if (this._rendering) return; this._rendering = true;
        CalendariaPhoneApp._activeInstance = this;
        CalendariaPhoneApp._attachGlobalListener();
        try {
            this._ensureCurrentDate();
            _invalidateCache();
            _clearMapCache();
            if (!this._hooksRegistered) { this._registerHooks(); this._hooksRegistered = true; }
            let html;
            if (this.currentView === VIEW.EVENT_FORM) html = this._renderForm();
            else if (this.currentView === VIEW.PINNED) html = this._renderPinned();
            else html = this._renderCalendar();
            this.updateContent(html);
            this._applyTheme();
        } finally { this._rendering = false; }
    }

    _applyTheme(themeName) {
        if (!this.element) return;
        const theme = themeName || (function() { try { return game.settings.get(MODULE_ID, 'calendarTheme'); } catch { return 'default'; } })();
        // Apply the theme class to every top-level app root we render (.calendar-app for the
        // main view and .smcal-pinned-view for the all-notes screen) so scoped theme CSS hits
        // both screens regardless of which is currently mounted.
        const roots = [];
        this.element.querySelectorAll('.calendar-app, .smcal-pinned-view').forEach(r => roots.push(r));
        const outer = this.element.closest('.calendar-app');
        if (outer && !roots.includes(outer)) roots.push(outer);
        if (!roots.length) roots.push(this.element);
        for (const root of roots) {
            for (const t of THEMES) root.classList.remove(`smcal-theme-${t}`);
            if (theme !== 'default') root.classList.add(`smcal-theme-${theme}`);
        }
    }

    cleanup() {
        super.cleanup(); this._safeOffHooks(); this._hooksRegistered = false;
    }

    _registerHooks() {
        try {
            const h = cApi()?.hooks;
            if (h) {
                Hooks.on(h.DATE_TIME_CHANGE, this._onTimeChange);
                Hooks.on(h.NOTE_CREATED, this._onNoteChange);
                Hooks.on(h.NOTE_DELETED, this._onNoteChange);
                Hooks.on(h.NOTE_UPDATED, this._onNoteChange);
            } else {
                // Standalone mode — listen to both Foundry's worldTime hook and
                // smartphone-widget's SmartphoneTime hook so any time change re-renders.
                Hooks.on('updateWorldTime', this._onTimeChange);
                Hooks.on('smartphoneTimeChanged', this._onTimeChange);
            }
        } catch {}
    }
    _safeOffHooks() {
        try {
            const h = cApi()?.hooks;
            if (h) {
                Hooks.off(h.DATE_TIME_CHANGE, this._onTimeChange);
                Hooks.off(h.NOTE_CREATED, this._onNoteChange);
                Hooks.off(h.NOTE_DELETED, this._onNoteChange);
                Hooks.off(h.NOTE_UPDATED, this._onNoteChange);
            } else {
                Hooks.off('updateWorldTime', this._onTimeChange);
                Hooks.off('smartphoneTimeChanged', this._onTimeChange);
            }
        } catch {}
    }

    _ensureCurrentDate() {
        const dt = currentDateTime(); if (!dt || dt.year == null) return;
        if (!this._initialized || this.currentDisplayDate.year === 0) {
            this.currentDisplayDate = { year: dt.year, month: dt.month };
            this.selectedDate = { year: dt.year, month: dt.month, day: dt.day };
            this._initialized = true; this._userSelected = false;
        }
    }

    _handleTimeChange() {
        if (this.currentView === VIEW.EVENT_FORM) return;
        const dt = currentDateTime(); if (!dt) return;
        if (!this._userSelected) {
            if (dt.year !== this.currentDisplayDate.year || dt.month !== this.currentDisplayDate.month)
                this.currentDisplayDate = { year: dt.year, month: dt.month };
            this.selectedDate = { year: dt.year, month: dt.month, day: dt.day };
        }
        if (this.widget.currentApp === 'calendar') this.render();
    }

    _handleNoteChange() { if (this.currentView !== VIEW.EVENT_FORM && this.widget.currentApp === 'calendar') this.render(); }

    /* ==================== Sorting ==================== */

    _sortItems(items) {
        const dir = this.sortAsc ? 1 : -1;
        if (this.sortMode === 'category') {
            return items.sort((a,b) => {
                // Pinned always first
                if (a._pinned && !b._pinned) return -1;
                if (!a._pinned && b._pinned) return 1;
                const ca = (a._cat||'').toLowerCase(), cb = (b._cat||'').toLowerCase();
                return ca < cb ? -1*dir : ca > cb ? dir : 0;
            });
        }
        return items.sort((a,b) => {
            if (a._pinned && !b._pinned) return -1;
            if (!a._pinned && b._pinned) return 1;
            return (a._min - b._min) * dir;
        });
    }

    /**
     * Past check — only events on the CURRENT day are eligible to be grayed out.
     * A timed event is past if:
     *   - it has an end time and current time is past the end time, OR
     *   - it has no end time and current time is more than 30 minutes past the start time.
     * All-day events (time '00:00' with no end) are never past within the current day.
     */
    _isPast(startTime, endTime) {
        const dt = currentDateTime(); if (!dt) return false;
        const { year, month, day } = this.selectedDate;
        if (year !== dt.year || month !== dt.month || day !== dt.day) return false;

        const curMin = (dt.hour ?? 0) * 60 + (dt.minute ?? 0);

        if (endTime && endTime !== '00:00') {
            const [h,m] = endTime.split(':').map(Number);
            return curMin > h * 60 + (m || 0);
        }
        if (!startTime || startTime === '00:00') return false;
        const [h,m] = startTime.split(':').map(Number);
        return curMin > h * 60 + (m || 0) + 30;
    }

    /* ==================== Calendar View ==================== */

    _renderDateHeader() {
        let raw = '';
        if (!game.user.isGM) { try { raw = game.settings.get(MODULE_ID, 'forceDateFormat') || ''; } catch {} }
        if (!raw) { try { raw = game.settings.get(MODULE_ID, 'dateFormat') || ''; } catch {} }
        const fmt = LEGACY_DATE_FORMATS[raw] || (raw.includes('{') ? raw : DEFAULT_DATE_FORMAT);

        const { year, month } = this.currentDisplayDate;
        const day = this.selectedDate?.day || 1;

        // Day-of-week for the selected day
        let wIdx = 0;
        try { wIdx = cApi()?.dayOfWeek({ year, month, day }) ?? 0; } catch {}
        const wd = getWeekdays()[wIdx] ?? {};
        const wdLong  = wd.name || `Day ${wIdx + 1}`;
        const wdShort = (wd.name ? wd.name.slice(0, 3) : wd.abbreviation) || `D${wIdx + 1}`;

        const monthSelect = (style) => {
            const opts = getMonths().map((m, i) => {
                const idx = i + 1;
                let label;
                if (style === 'numeric') label = String(idx).padStart(2, '0');
                else if (style === 'short') label = m.abbreviation || (m.name ? m.name.slice(0, 3) : `M${idx}`);
                else label = m.name || `Month ${idx}`;
                return `<option value="${idx}" ${idx === month ? 'selected' : ''}>${esc(label)}</option>`;
            }).join('');
            return `<select class="smcal-month-edit" data-month-style="${style}" aria-label="Month">${opts}</select>`;
        };

        const yearShort = ((year % 100) + 100) % 100; // handle negative years
        const tokens = {
            'Y':  `<input type="number" class="smcal-year-edit" value="${year}" aria-label="Year">`,
            'y':  `<input type="number" class="smcal-year-edit smcal-year-short" value="${String(yearShort).padStart(2,'0')}" data-year-mode="short" aria-label="Year">`,
            'M':  monthSelect('long'),
            'm':  monthSelect('short'),
            'm#': monthSelect('numeric'),
            'D':  `<span class="smcal-dow">${esc(wdLong)}</span>`,
            'd':  `<span class="smcal-dow">${esc(wdShort)}</span>`,
            '#':  `<span class="smcal-day-num">${day}</span>`,
            '##': `<span class="smcal-day-num">${ordinal(day)}</span>`
        };

        // Split on tokens so literal text between them (commas, spaces, etc.)
        // can be wrapped in <span> to survive the inline-flex container, which
        // collapses whitespace-only text nodes.
        const re = /(\{(?:m#|##|Y|y|M|m|D|d|#)\})/g;
        return fmt.split(re).map(p => {
            const tk = p.match(/^\{(m#|##|Y|y|M|m|D|d|#)\}$/);
            if (tk) return tokens[tk[1]] || '';
            if (!p) return '';
            return `<span class="smcal-sep">${esc(p)}</span>`;
        }).join('');
    }

    _renderCalendar() {
        const dt = currentDateTime() ?? { year:0, month:1, day:1 };
        const appTitle = esc(this.getAppName('calendar', `${I18N}.appName`));
        return `
        <div class="calendar-app smcal-app">
            <div class="app-header">
                <div class="smcal-hdr-left">
                    <button class="all-notes-btn smcal-pin-badge" title="All Notes"><i class="fas fa-list"></i></button>
                </div>
                <h3>${appTitle}</h3>
                <div class="smcal-hdr-right">
                    <button class="today-btn smcal-today-btn" title="${esc(loc(`${I18N}.today`,'Today'))}"><i class="fas fa-calendar-day"></i></button>
                </div>
            </div>
            <div class="calendar-main smcal-main">
                <div class="calendar-header">
                    <button class="nav-btn prev-month"><i class="fas fa-chevron-left"></i></button>
                    <span class="current-month">${this._renderDateHeader()}</span>
                    <button class="nav-btn next-month"><i class="fas fa-chevron-right"></i></button>
                </div>
                ${this._renderGrid(dt)}
                ${this._renderDayInfo()}
                ${(!hasCalendaria() && game.user.isGM) ? this._renderGmControls(dt) : ''}
            </div>
        </div>`;
    }

    /** GM-only time / advanced controls shown in standalone (no-Calendaria) mode.
     *  Ported from smartphone-widget's built-in CalendarApp, but restyled to match
     *  this module's look: compact header rows, no chunky pills/gradients. */
    _renderGmControls(today) {
        const { year, month, day } = this.selectedDate;
        const isOtherDay = !(year === today.year && month === today.month && day === today.day);
        const units = {
            minutes: 'Minutes',
            hours: 'Hours',
            days: 'Days',
            months: 'Months',
            years: 'Years'
        };
        const unit = this._gmTimeUnit || 'days';
        const unitOpts = Object.entries(units).map(([v,l]) =>
            `<option value="${v}" ${v===unit?'selected':''}>${esc(l)}</option>`).join('');

        const shortcuts = [
            { key: 'morning',  label: 'Morning',  icon: 'fas fa-sun' },
            { key: 'midday',   label: 'Midday',   icon: 'fas fa-sun' },
            { key: 'evening',  label: 'Evening',  icon: 'fas fa-cloud-sun' },
            { key: 'midnight', label: 'Midnight', icon: 'fas fa-moon' }
        ];
        const shortcutHtml = shortcuts.map(s =>
            `<button type="button" class="smcal-gm-btn smcal-gm-short" data-shortcut="${s.key}" title="${esc(s.label)}"><i class="${s.icon}"></i><span>${esc(s.label)}</span></button>`
        ).join('');

        return `
        <div class="smcal-gm-ctrls">
            <details class="smcal-gm-section" open>
                <summary><i class="fas fa-clock"></i> Time Controls</summary>
                <div class="smcal-gm-body">
                    <div class="smcal-gm-shortcuts">${shortcutHtml}</div>
                    ${isOtherDay ? `<button type="button" class="smcal-gm-btn smcal-gm-setdate"><i class="fas fa-calendar-check"></i> Set time to selected date</button>` : ''}
                </div>
            </details>
            <details class="smcal-gm-section">
                <summary><i class="fas fa-cogs"></i> Advanced</summary>
                <div class="smcal-gm-body">
                    <button type="button" class="smcal-gm-btn smcal-gm-lighting"><i class="fas fa-lightbulb"></i> Toggle lighting FX for scene</button>
                    <div class="smcal-gm-advance">
                        <button type="button" class="smcal-gm-btn smcal-gm-nav" data-action="advance" data-value="-5" title="Back 5"><i class="fas fa-angles-left"></i></button>
                        <button type="button" class="smcal-gm-btn smcal-gm-nav" data-action="advance" data-value="-1" title="Back 1"><i class="fas fa-angle-left"></i></button>
                        <select class="smcal-gm-unit">${unitOpts}</select>
                        <button type="button" class="smcal-gm-btn smcal-gm-nav" data-action="advance" data-value="1" title="Forward 1"><i class="fas fa-angle-right"></i></button>
                        <button type="button" class="smcal-gm-btn smcal-gm-nav" data-action="advance" data-value="5" title="Forward 5"><i class="fas fa-angles-right"></i></button>
                    </div>
                </div>
            </details>
        </div>`;
    }

    _renderGrid(today) {
        const wd = getWeekdays(), { year, month } = this.currentDisplayDate;
        const dim = getDaysInMonth(year,month), startDow = getWeekdayFor(year,month,1), numWd = wd.length||7;
        const api = cApi();
        let monthNotes = []; try { monthNotes = filterNotes(api?.getNotesForMonth(year,month)); } catch {}
        const noteDays = new Set();      // days with a non-recurring event (blue dot)
        const recurringDays = new Set(); // days that are specifically an occurrence of a recurring note (purple dot)
        for (const n of monthNotes) {
            const fd = n.flagData ?? {};
            // Recurring note — expand occurrences within this month
            if (isRecurring(fd) && api?.getNoteOccurrencesInRange) {
                let added = false;
                try {
                    const occs = api.getNoteOccurrencesInRange(n.id,
                        { year, month, day: 1 },
                        { year, month, day: dim });
                    if (Array.isArray(occs)) {
                        for (const o of occs) {
                            if (o?.year !== year || o?.month !== month) continue;
                            const d = o.day ?? o.dayOfMonth;
                            if (d) { recurringDays.add(d); added = true; }
                        }
                    }
                } catch {}
                if (added) continue;
            }
            // One-off note — use startDate
            const sd = fd.startDate;
            if (sd != null) noteDays.add(sd.day ?? (sd.dayOfMonth != null ? sd.dayOfMonth + 1 : 0));
        }
        for (const d of getEvtDays(this.widget.currentPhoneId,year,month)) noteDays.add(d);

        let html = wd.map(d=>`<div class="weekday">${esc((d.abbreviation||d.name||'?').slice(0,2))}</div>`).join('');
        for (let i=0;i<startDow;i++) html += `<div class="day empty"></div>`;
        for (let d=1;d<=dim;d++) {
            const isT = d===today.day && month===today.month && year===today.year;
            const isS = d===this.selectedDate.day && month===this.selectedDate.month && year===this.selectedDate.year;
            const has = noteDays.has(d);
            const hasRec = recurringDays.has(d);
            let cls = 'day'; if(isT) cls+=' today'; if(isS) cls+=' selected'; if(has||hasRec) cls+=' has-events';
            // Two-dot layout: regular dot for any event, purple dot for recurring occurrences.
            // Wrap in a flex container so they center as a group regardless of count.
            let dots = '';
            if (has || hasRec) {
                let inner = '';
                if (has) inner += '<span class="smcal-dot"></span>';
                if (hasRec) inner += '<span class="smcal-dot smcal-dot-recurring"></span>';
                dots = `<span class="smcal-dots">${inner}</span>`;
            }
            html += `<div class="${cls}" data-day="${d}">${d}${dots}</div>`;
        }
        const total=startDow+dim, rem=total%numWd===0?0:numWd-(total%numWd);
        for (let i=0;i<rem;i++) html += `<div class="day empty"></div>`;
        return `<div class="calendar-grid smcal-grid" style="grid-template-columns:repeat(${numWd},1fr)">${html}</div>`;
    }

    /* ==================== Day Info ==================== */

    _renderDayInfo() {
        const { year, month, day } = this.selectedDate;
        const mName = esc(getMonthName(month));
        let calNotes = []; try { calNotes = filterNotes(cApi()?.getNotesForDate(year,month,day)); } catch {}
        const phoneEvts = getEvts(this.widget.currentPhoneId,year,month,day);

        const items = [];
        for (const n of calNotes) {
            const fd = n.flagData??{};
            const t = fd.allDay ? '00:00' : fmtTime(fd.startDate?.hour, fd.startDate?.minute);
            items.push({ _type:'cal', _min:timeToMin(t), _cat:fd.categories?.[0]||'', _pinned:isCalPinned(this.widget.currentPhoneId, n.id), _time:t, note:n });
        }
        for (const e of phoneEvts) {
            items.push({ _type:'phone', _min:timeToMin(e.time), _cat:e.category||'', _pinned:!!e.pinned, _time:e.time||'00:00', evt:e });
        }
        this._sortItems(items);

        let listHTML;
        if (!items.length) {
            listHTML = `<p class="no-events">${loc(`${I18N}.noEvents`,'No events.')}</p>`;
        } else {
            const pinnedItems = [], unpinnedItems = [];
            for (const i of items) {
                const html = i._type==='cal' ? this._renderCalNote(i.note) : this._renderPhoneEvt(i.evt);
                if (i._pinned) pinnedItems.push(html); else unpinnedItems.push(html);
            }
            listHTML = pinnedItems.join('') + unpinnedItems.join('');
        }

        const tA = this.sortMode==='time', cA = this.sortMode==='category';
        const arr = this.sortAsc ? 'fa-arrow-down-short-wide' : 'fa-arrow-up-wide-short';
        const compIcon = this.compact ? 'fa-solid fa-grid' : 'fa-solid fa-grid-2';

        return `
        <div class="selected-day-info">
            <div class="smcal-day-hdr">
                <h4>${mName} ${day}</h4>
                ${phoneEvts.length>=2 ? `<button class="delete-all-btn smcal-tb" title="Delete All"><i class="fas fa-trash-alt"></i></button>` : ''}
                <button class="add-event-btn smcal-tb" title="Add Event"><i class="fas fa-plus"></i></button>
                <button class="sort-time-btn smcal-tb${tA?'':' smcal-faded'}" title="Sort by time"><i class="fas fa-clock"></i>${tA?` <i class="fas ${arr}"></i>`:''}</button>
                <button class="sort-cat-btn smcal-tb${cA?'':' smcal-faded'}" title="Sort by category"><i class="fas fa-tag"></i>${cA?` <i class="fas ${arr}"></i>`:''}</button>
                <button class="compact-btn smcal-tb" title="Toggle spacing"><i class="${compIcon}"></i></button>
            </div>
            <div class="event-list smcal-note-container">${listHTML}</div>
        </div>`;
    }

    _renderCalNote(note, { showPast = true } = {}) {
        const fd = note.flagData??{}, color = esc((fd.color?.css ?? fd.color) || DEFAULT_COLOR);
        const icon = esc(fd.icon||'fas fa-calendar'), title = esc(note.name||'');
        const t = fd.allDay ? '00:00' : fmtTime(fd.startDate?.hour,fd.startDate?.minute);
        const timeLabel = fd.allDay ? loc(`${I18N}.allDay`,'All Day') : t;
        const canEdit = note.isOwner || canDo('editNotes');
        // Players can always open (view) a calendaria note; editors get edit-mode.
        const openTitle = canEdit ? 'Edit in Calendaria' : 'Open in Calendaria';
        const endTime = fd.allDay ? '' : (fd.endDate ? fmtTime(fd.endDate.hour,fd.endDate.minute) : '');
        const past = showPast && this._isPast(t, endTime);
        const pinned = isCalPinned(this.widget.currentPhoneId, note.id);
        let content=''; try { const doc=cApi()?.getNoteDocument?.(note.id); content=doc?.text?.content||doc?.content||''; } catch {} if(!content) try { content=note.content||note.text||''; } catch {}
        const timeRange = endTime && endTime !== t ? `${timeLabel} – ${endTime}` : timeLabel;
        const category = fd.categories?.[0] || '';
        const metaLine = `${timeRange}${category ? ` · ${esc(category)}` : ''}`;
        const nc = this.compact ? ' smcal-compact' : '';
        const timeCls = fd.allDay ? ' smcal-allday-label' : '';
        const hoverCls = actionsHoverOnly() ? ' smcal-actions-hover' : '';

        return `
        <div class="smcal-note${past?' smcal-past':''}${nc}${hoverCls}" data-source="calendaria" data-note-id="${esc(note.id)}" data-journal-id="${esc(note.journalId??'')}" data-end-time="${esc(endTime)}" style="--smcal-note-color:${color}">
            <div class="smcal-row">
                <span class="smcal-time${timeCls}">${timeLabel}</span>
                <i class="${icon} smcal-cat-icon"></i>
                <span class="smcal-title">${title}</span>
                <div class="smcal-actions">
                    <button class="pin-note-btn smcal-act ${pinned?'smcal-pin-on':'smcal-pin-off'}" data-cal-pin="${esc(note.id)}" title="${pinned?'Unpin':'Pin'}"><i class="${pinned?'fas':'far'} fa-thumbtack"></i></button>
                    <button class="open-note-btn smcal-act" title="${openTitle}"><i class="fas fa-external-link-alt"></i></button>
                    ${(game.user.isGM && showDeleteBtn())?`<button class="delete-note-btn smcal-act" title="Delete (Calendaria)"><i class="fas fa-trash"></i></button>`:''}
                </div>
            </div>
            <div class="smcal-expand" data-open="0">
                <div class="smcal-expand-inner">
                    <div class="smcal-expand-meta">${metaLine}</div>
                    ${content||'<em>No content.</em>'}
                </div>
            </div>
        </div>`;
    }

    _renderPhoneEvt(evt, { showPast = true } = {}) {
        const color = esc(evt.color||DEFAULT_COLOR), title = esc(evt.title||'');
        const t = evt.time||'00:00';
        const isAllDay = t === '00:00';
        const timeLabel = isAllDay ? loc(`${I18N}.allDay`,'All Day') : t;
        const catIcon = evt.categoryIcon ? `<i class="${esc(evt.categoryIcon)} smcal-cat-icon" title="${esc(evt.category||'')}"></i>` : `<i class="fas fa-calendar smcal-cat-icon"></i>`;
        const memo = evt.memo||'';
        const past = showPast && this._isPast(t, evt.endTime);
        const nc = this.compact ? ' smcal-compact' : '';
        const endLabel = evt.endTime && evt.endTime !== t ? ` – ${evt.endTime}` : '';
        const timeCls = isAllDay ? ' smcal-allday-label' : '';
        const hoverCls = actionsHoverOnly() ? ' smcal-actions-hover' : '';

        return `
        <div class="smcal-note${past?' smcal-past':''}${nc}${hoverCls}" data-source="phone" data-phone-evt-id="${esc(evt.id)}" data-end-time="${esc(evt.endTime||'')}" style="--smcal-note-color:${color}">
            <div class="smcal-row">
                <span class="smcal-time${timeCls}">${timeLabel}</span>
                ${catIcon}
                <span class="smcal-title">${title}</span>
                <div class="smcal-actions">
                    <button class="pin-note-btn smcal-act ${evt.pinned?'smcal-pin-on':'smcal-pin-off'}" title="${evt.pinned?'Unpin':'Pin'}"><i class="${evt.pinned?'fas':'far'} fa-thumbtack"></i></button>
                    <button class="edit-note-btn smcal-act" title="Edit"><i class="fas fa-pen-to-square"></i></button>
                    ${showDeleteBtn()?`<button class="delete-note-btn smcal-act" title="Delete"><i class="fas fa-trash"></i></button>`:''}
                </div>
            </div>
            <div class="smcal-expand" data-open="0">
                <div class="smcal-expand-inner">
                    <div class="smcal-expand-meta">${timeLabel}${endLabel}${evt.category?` · ${esc(evt.category)}`:''}</div>
                    ${memo ? nl2br(esc(memo)) : '<em>No details.</em>'}
                </div>
            </div>
        </div>`;
    }

    /* ==================== Pinned View ==================== */

    _renderPinned() {
        const tab = this.notesTab || 'events';
        const pid = this.widget.currentPhoneId;
        const search = (this.notesSearch || '').toLowerCase().trim();

        // Settings tab is rendered separately (no list, no search row)
        if (tab === 'settings') return this._renderPinnedSettings();

        let items;
        if (tab === 'pinned') items = getAllPinned(pid);
        else if (tab === 'recurring') items = getAllRecurring(pid);
        else items = getAllEvents(pid);

        // Search filter — match on title/name (case-insensitive)
        if (search) {
            items = items.filter(e => {
                const name = (e._type === 'cal' && e._note) ? (e._note.name || '') : (e.title || '');
                return name.toLowerCase().includes(search);
            });
        }

        // Sort — events/pinned by date+time; recurring already sorted with ended at bottom
        if (tab !== 'recurring') {
            items.sort((a,b) => {
                if (a._dateKey < b._dateKey) return -1;
                if (a._dateKey > b._dateKey) return 1;
                const at = !a.time || a.time === '00:00' ? 0 : timeToMin(a.time);
                const bt = !b.time || b.time === '00:00' ? 0 : timeToMin(b.time);
                return at - bt;
            });
        }

        // Build list with date-group headers
        let listHTML = '';
        if (!items.length) {
            let msg;
            if (tab === 'pinned') msg = 'No pinned events.';
            else if (tab === 'recurring') {
                msg = hasCalendaria()
                    ? 'No recurring events.'
                    : 'Recurring events require the Calendaria module. Install and enable it to use this feature.';
            }
            else msg = 'No events.';
            listHTML = `<p class="no-events">${msg}</p>`;
        } else {
            let lastDate = '';
            let endedHeaderShown = false;
            for (const e of items) {
                const opts = { showPast: false };
                if (tab === 'recurring' && e._ended) {
                    if (!endedHeaderShown) {
                        listHTML += `<div class="smcal-allnote-date smcal-ended-header">Ended</div>`;
                        endedHeaderShown = true;
                        lastDate = '__ENDED__';
                    }
                } else {
                    const [y,m,d] = (e._dateKey||'').split('-').map(Number);
                    const dateLabel = (y && m && d) ? `${getMonthName(m)} ${d}, ${y}` : '';
                    if (dateLabel !== lastDate) {
                        listHTML += `<div class="smcal-allnote-date">${esc(dateLabel)}</div>`;
                        lastDate = dateLabel;
                    }
                }
                listHTML += (e._type === 'cal' && e._note) ? this._renderCalNote(e._note, opts) : this._renderPhoneEvt(e, opts);
            }
        }

        const eventsCls = tab === 'events' ? '' : ' smcal-faded';
        const recurringCls = tab === 'recurring' ? '' : ' smcal-faded';
        const pinnedCls = tab === 'pinned' ? '' : ' smcal-faded';
        const settingsCls = tab === 'settings' ? '' : ' smcal-faded';

        let actionBtn = '';
        if (tab === 'pinned') {
            actionBtn = `<button class="unpin-all-btn smcal-tb" title="Unpin All"><i class="fas fa-thumbtack"></i> <i class="fas fa-xmark"></i></button>`;
        } else if (tab === 'events') {
            actionBtn = `<button class="delete-all-events-btn smcal-tb" title="Delete All"><i class="fas fa-trash-alt"></i></button>`;
        }

        return `
        <div class="calendar-app smcal-app smcal-pinned-view smcal-tab-active-${esc(tab)}">
            <div class="app-header smcal-pinned-hdr">
                <button class="back-btn smcal-tb"><i class="fas fa-arrow-left"></i></button>
                <div class="smcal-tabs">
                    <button class="smcal-tab${eventsCls}" data-tab="events">Events</button>
                    <button class="smcal-tab${recurringCls}" data-tab="recurring">Recurring</button>
                    <button class="smcal-tab${pinnedCls}" data-tab="pinned">Pinned</button>
                    <button class="smcal-tab smcal-tab-settings${settingsCls}" data-tab="settings" title="Settings"><i class="fas fa-cog"></i></button>
                </div>
            </div>
            <div class="smcal-pinned-body">
                <div class="smcal-search-row">
                    <input type="text" class="smcal-search" placeholder="Search..." value="${esc(this.notesSearch||'')}">
                    ${actionBtn}
                </div>
                <div class="smcal-main smcal-note-container">${listHTML}</div>
            </div>
        </div>`;
    }

    /* ==================== Pinned Settings Tab ==================== */

    _renderPinnedSettings() {
        // Read current values (with safe fallback)
        const get = (k, d) => { try { return game.settings.get(MODULE_ID, k); } catch { return d; } };
        const deleteMode = get('deleteMode', 'right-click');
        const actionsVis = get('actionButtonsVisibility', 'always');
        const dateFmt    = get('dateFormat', 'ymonth');
        const forcedFmt  = get('forceDateFormat', '');
        const theme      = get('calendarTheme', 'default');
        const escBack    = get('escapeGoesBack', true);
        const cats       = getCustomCategories();
        const calActive  = hasCalendaria();

        const radio = (key, val, cur, label) =>
            `<label class="smcal-setting-opt"><input type="radio" name="smcal-setting-${key}" data-setting-key="${key}" value="${val}" ${val===cur?'checked':''}> ${esc(label)}</label>`;

        const dropdown = (key, options, cur) => {
            const opts = Object.entries(options).map(([v,l]) =>
                `<option value="${esc(v)}" ${v===cur?'selected':''}>${esc(l)}</option>`).join('');
            return `<select class="smcal-setting-select" data-setting-key="${key}">${opts}</select>`;
        };

        const themes = { 'default': 'Default', 'golden-squares': 'Golden Squares' };
        // Convert any legacy preset key to its token string so the text input shows tokens
        const dateFmtValue = LEGACY_DATE_FORMATS[dateFmt] || dateFmt || DEFAULT_DATE_FORMAT;

        // Settings content uses the same tab header/gradient as other tabs
        const eventsCls    = ' smcal-faded';
        const recurringCls = ' smcal-faded';
        const pinnedCls    = ' smcal-faded';
        const settingsCls  = '';

        return `
        <div class="calendar-app smcal-app smcal-pinned-view smcal-tab-active-settings">
            <div class="app-header smcal-pinned-hdr">
                <button class="back-btn smcal-tb"><i class="fas fa-arrow-left"></i></button>
                <div class="smcal-tabs">
                    <button class="smcal-tab${eventsCls}" data-tab="events">Events</button>
                    <button class="smcal-tab${recurringCls}" data-tab="recurring">Recurring</button>
                    <button class="smcal-tab${pinnedCls}" data-tab="pinned">Pinned</button>
                    <button class="smcal-tab smcal-tab-settings${settingsCls}" data-tab="settings" title="Settings"><i class="fas fa-cog"></i></button>
                </div>
            </div>
            <div class="smcal-pinned-body">
            <div class="smcal-main smcal-settings-body">
                <div class="smcal-setting">
                    <div class="smcal-setting-label">Delete mode</div>
                    <div class="smcal-setting-control">
                        ${radio('deleteMode', 'right-click', deleteMode, 'Right-click only')}
                        ${radio('deleteMode', 'button',      deleteMode, 'Show button')}
                    </div>
                </div>
                <div class="smcal-setting">
                    <div class="smcal-setting-label">Action buttons</div>
                    <div class="smcal-setting-control">
                        ${radio('actionButtonsVisibility', 'always', actionsVis, 'Always visible')}
                        ${radio('actionButtonsVisibility', 'hover',  actionsVis, 'Only on hover')}
                    </div>
                </div>
                <div class="smcal-setting">
                    <div class="smcal-setting-label">Date format${game.user.isGM
                        ? ` <button class="smcal-padlock smcal-datefmt-padlock" title="${forcedFmt ? 'Unlock for players' : 'Lock for all players'}"><i class="fas ${forcedFmt ? 'fa-lock' : 'fa-lock-open'}"></i></button>`
                        : (forcedFmt ? ' <i class="fas fa-lock smcal-padlock-indicator"></i>' : '')}</div>
                    <div class="smcal-setting-control">
                        <input type="text" class="smcal-setting-input" data-setting-key="dateFormat" value="${esc(forcedFmt && !game.user.isGM ? (LEGACY_DATE_FORMATS[forcedFmt] || forcedFmt) : dateFmtValue)}" placeholder="${esc(DEFAULT_DATE_FORMAT)}" ${forcedFmt && !game.user.isGM ? 'disabled' : ''}>
                    </div>
                    <div class="smcal-setting-hint">
                        <code>{Y}</code>year <code>{y}</code>year short <code>{M}</code>month <code>{m}</code>month short <code>{m#}</code>month num <code>{D}</code>wkday <code>{d}</code>wkday short <code>{#}</code>day <code>{##}</code>day ordinal
                    </div>
                </div>
                <div class="smcal-setting">
                    <div class="smcal-setting-label">Escape key goes back</div>
                    <div class="smcal-setting-control">
                        <label class="smcal-setting-opt"><input type="checkbox" data-setting-key="escapeGoesBack" data-setting-type="bool" ${escBack?'checked':''}> Enabled</label>
                    </div>
                    <div class="smcal-setting-hint">When off, Escape falls back to Foundry's default behavior while the phone is focused.</div>
                </div>
                <div class="smcal-setting">
                    <div class="smcal-setting-label">Theme</div>
                    <div class="smcal-setting-control">${dropdown('calendarTheme', themes, theme)}</div>
                </div>
                <div class="smcal-setting smcal-setting-categories${calActive ? ' smcal-setting-disabled' : ''}">
                    <div class="smcal-setting-label">Categories${calActive ? ' <span class="smcal-setting-pill">Managed by Calendaria</span>' : ''}</div>
                    ${calActive
                        ? '<div class="smcal-setting-hint">Calendaria is active — categories are managed from Calendaria\'s preset editor instead.</div>'
                        : this._renderCustomCategoriesList(cats)}
                </div>
            </div>
            </div>
        </div>`;
    }

    _renderCustomCategoriesList(cats) {
        const rows = (cats || []).map((c, i) => {
            const icon = esc(c.icon || 'fas fa-tag');
            const color = esc(c.color || DEFAULT_COLOR);
            const name = esc(c.name || '');
            return `
                <div class="smcal-cat-row" data-cat-idx="${i}">
                    <span class="smcal-cat-swatch" style="background:${color}"><i class="${icon}"></i></span>
                    <input type="text" class="smcal-cat-name" data-cat-field="name" value="${name}" placeholder="Name">
                    <input type="color" class="smcal-cat-color" data-cat-field="color" value="${color}" title="Color">
                    <input type="text" class="smcal-cat-icon-in" data-cat-field="icon" value="${icon}" placeholder="fas fa-tag" title="Font Awesome icon class">
                    <button class="smcal-cat-del smcal-tb" title="Remove"><i class="fas fa-xmark"></i></button>
                </div>`;
        }).join('');
        return `
            <div class="smcal-cat-list">${rows}</div>
            <button class="smcal-cat-add smcal-tb"><i class="fas fa-plus"></i> Add category</button>`;
    }

    /* ==================== Event Form ==================== */

    _renderForm() {
        const isEdit = this.editingNote!=null, evt = this.editingNote??{};
        const title = esc(evt.title||'');
        const h = isEdit ? parseInt((evt.time||'12:00').split(':')[0]) : 12;
        const m = isEdit ? parseInt((evt.time||'00:00').split(':')[1]) : 0;
        const eH = isEdit && evt.endTime ? parseInt(evt.endTime.split(':')[0]) : '';
        const eM = isEdit && evt.endTime ? parseInt(evt.endTime.split(':')[1]) : '';
        // Track color with empty-string meaning "use category / default color"
        const color = evt.color ?? '';
        const category = evt.category||'', memo = evt.memo||'';
        const allDay = isEdit ? (!evt.time||evt.time==='00:00') : false;

        const cats = new Set();
        // 1) Calendaria presets (if available)
        try { for (const p of (cApi()?.getPresets?.()??cApi()?.getCategories?.()??[])) { const l=p.label?(game.i18n.localize(p.label)||p.label):p.id; if(l)cats.add(l); } } catch {}
        // 2) User-defined custom categories (standalone mode, but also merged in if present)
        for (const c of getCustomCategories()) if (c?.name) cats.add(c.name);
        // 3) Categories in use on phone events (back-compat)
        for (const evts of loadMap(this.widget.currentPhoneId).values()) for (const e of evts) if(e.category) cats.add(e.category);
        const catOpts = [...cats].sort().map(c=>`<option value="${esc(c)}" ${c===category?'selected':''}>${esc(c)}</option>`).join('');

        return `
        <div class="smcal-form">
            <div class="app-header"><h3>${loc(isEdit?`${I18N}.editEvent`:`${I18N}.addEvent`)}</h3></div>
            <div class="smcal-form-body">
                <div class="smcal-fg">
                    <label class="smcal-fl">${loc(`${I18N}.title`)}</label>
                    <input type="text" id="smcal-title" value="${title}" placeholder="${esc(loc(`${I18N}.eventTitlePlaceholder`))}">
                </div>
                <div class="smcal-inline" style="gap:16px">
                    <label class="smcal-fl"><input type="checkbox" id="smcal-allday" ${allDay?'checked':''}> ${loc(`${I18N}.allDay`)}</label>
                    <label class="smcal-fl">${loc(`${I18N}.category`)}:
                        <select id="smcal-category" class="smcal-cat-sel"><option value="">${loc(`${I18N}.none`,'None')}</option>${catOpts}</select>
                    </label>
                </div>
                <div class="smcal-time-rows" ${allDay?'hidden':''}>
                    <div class="smcal-inline">
                        <label class="smcal-fl">${loc(`${I18N}.startTime`,'Start')}:</label>
                        <input type="number" id="smcal-hour" value="${h}" min="0" max="${getHoursPerDay()-1}" class="smcal-time-in">
                        <span>:</span>
                        <input type="number" id="smcal-minute" value="${String(m).padStart(2,'0')}" min="0" max="${getMinutesPerHour()-1}" class="smcal-time-in">
                        <label class="smcal-fl" style="margin-left:4px">${loc(`${I18N}.endTime`,'End')}:</label>
                        <input type="number" id="smcal-end-hour" value="${eH}" min="0" max="${getHoursPerDay()-1}" class="smcal-time-in" placeholder="--">
                        <span>:</span>
                        <input type="number" id="smcal-end-minute" value="${eM !== '' ? String(eM).padStart(2,'0') : ''}" min="0" max="${getMinutesPerHour()-1}" class="smcal-time-in" placeholder="--">
                    </div>
                </div>
                <div class="smcal-fg smcal-memo-fg">
                    <label class="smcal-fl">${loc(`${I18N}.memo`)}</label>
                    <textarea id="smcal-memo" placeholder="${esc(loc(`${I18N}.memoPlaceholder`))}">${esc(memo)}</textarea>
                </div>
                <div class="smcal-fg">
                    <label class="smcal-fl">${loc(`${I18N}.color`)}</label>
                    <div class="smcal-colors">
                        <button class="smcal-copt smcal-copt-none ${color===''?'selected':''}" data-color="" title="Use category color (or default)">
                            ${color===''?'<i class="fas fa-check"></i>':'<i class="fas fa-ban"></i>'}
                        </button>
                        ${COLORS.map(c=>
                        `<button class="smcal-copt ${c===color?'selected':''}" data-color="${c}" style="background:${c};">
                            ${c===color?'<i class="fas fa-check"></i>':''}
                        </button>`).join('')}
                    </div>
                </div>
            </div>
            <div class="smcal-form-foot">
                ${isEdit ? `<button class="smcal-form-delete"><i class="fas fa-trash"></i> ${loc(`${I18N}.delete`,'Delete')}</button>` : ''}
                <button class="cancel-btn">${loc(`${I18N}.cancel`)}</button>
                <button class="save-btn">${loc(`${I18N}.save`)}</button>
            </div>
        </div>`;
    }

    /* ==================== Listeners ==================== */

    setupListeners() {
        super.removeAllListeners(); if (!this.element) return;
        if (this.currentView === VIEW.EVENT_FORM) this._setupFormL();
        else if (this.currentView === VIEW.PINNED) this._setupPinnedL();
        else this._setupCalL();
    }

    _setupPinnedL() {
        const el = this.element;
        const bb = el.querySelector('.back-btn');
        if (bb) this.addListener(bb, 'click', () => { this.currentView = VIEW.CALENDAR; this.notesSearch = ''; this._searchFocused = false; this.render(); });
        // Tab switching
        el.querySelectorAll('.smcal-tab').forEach(tab => {
            this.addListener(tab, 'click', () => { this.notesTab = tab.dataset.tab; this.render(); });
        });
        // Settings controls (when on the settings tab)
        el.querySelectorAll('[data-setting-key]').forEach(input => {
            this.addListener(input, 'change', async () => {
                const key = input.dataset.settingKey;
                const value = input.type === 'checkbox' ? input.checked : input.value;
                try { await game.settings.set(MODULE_ID, key, value); } catch (e) { console.warn(`${MODULE_ID} | setting ${key}:`, e); }
                if (key === 'dateFormat' && game.user.isGM) {
                    let forced = ''; try { forced = game.settings.get(MODULE_ID, 'forceDateFormat'); } catch {}
                    if (forced) {
                        const resolved = LEGACY_DATE_FORMATS[value] || value || DEFAULT_DATE_FORMAT;
                        try { await game.settings.set(MODULE_ID, 'forceDateFormat', resolved); } catch {}
                    }
                }
                this.render();
            });
        });
        // Date format padlock (GM only)
        const dfLock = el.querySelector('.smcal-datefmt-padlock');
        if (dfLock) this.addListener(dfLock, 'click', async () => {
            let cur = ''; try { cur = game.settings.get(MODULE_ID, 'forceDateFormat') || ''; } catch {}
            if (cur) {
                await game.settings.set(MODULE_ID, 'forceDateFormat', '');
            } else {
                let myFmt = ''; try { myFmt = game.settings.get(MODULE_ID, 'dateFormat') || ''; } catch {}
                myFmt = LEGACY_DATE_FORMATS[myFmt] || myFmt || DEFAULT_DATE_FORMAT;
                await game.settings.set(MODULE_ID, 'forceDateFormat', myFmt);
            }
            this.render();
        });
        // Custom categories — add / edit / delete (standalone mode)
        const addCatBtn = el.querySelector('.smcal-cat-add');
        if (addCatBtn) this.addListener(addCatBtn, 'click', async () => {
            const cats = getCustomCategories();
            cats.push({ id: foundry.utils.randomID(), name: 'New Category', color: DEFAULT_COLOR, icon: 'fas fa-tag' });
            await setCustomCategories(cats);
            this.render();
        });
        el.querySelectorAll('.smcal-cat-row').forEach(row => {
            const idx = parseInt(row.dataset.catIdx);
            row.querySelectorAll('[data-cat-field]').forEach(input => {
                this.addListener(input, 'change', async () => {
                    const cats = getCustomCategories();
                    if (!cats[idx]) return;
                    cats[idx][input.dataset.catField] = input.value;
                    await setCustomCategories(cats);
                    this.render();
                });
            });
            const delBtn = row.querySelector('.smcal-cat-del');
            if (delBtn) this.addListener(delBtn, 'click', async () => {
                const cats = getCustomCategories();
                cats.splice(idx, 1);
                await setCustomCategories(cats);
                this.render();
            });
        });
        // Search input — live filter, preserve focus+cursor across re-renders
        const si = el.querySelector('.smcal-search');
        if (si) {
            // Restore focus + caret if the search input held focus before the re-render.
            // Track this independently of the value so emptying the input doesn't drop focus.
            if (this._searchFocused) {
                si.focus();
                const n = si.value.length;
                try { si.setSelectionRange(n, n); } catch {}
            }
            this.addListener(si, 'input', (e) => {
                this._searchFocused = true;
                this.notesSearch = e.target.value;
                this.render();
            });
            // Don't clear _searchFocused on blur — DOM replacement during render() can
            // fire blur on the old input before we restore focus on the new one.
        }
        // Unpin All
        const upBtn = el.querySelector('.unpin-all-btn');
        if (upBtn) this.addListener(upBtn, 'click', async () => {
            const ok = await foundry.applications.api.DialogV2.confirm({window:{title:'Unpin All'},content:'<p>Unpin all events and notes?</p>'});
            if (!ok) return;
            // Unpin phone events
            const pid = this.widget.currentPhoneId;
            const map = loadMap(pid);
            _clearMapCache();
            for (const [dk, evts] of map) for (const e of evts) if (e.pinned) await _socketUpdateEvent(pid, dk, { ...e, pinned: false });
            // Unpin calendaria notes
            await setCalPins(pid, []);
            this.render();
        });
        // Delete All Events
        const daBtn = el.querySelector('.delete-all-events-btn');
        if (daBtn) this.addListener(daBtn, 'click', async () => {
            const allEvts = getAllEvents(this.widget.currentPhoneId);
            if (!allEvts.length) return;
            const hasPinned = allEvts.some(e => e.pinned || (e._type==='cal' && isCalPinned(this.widget.currentPhoneId, e.noteId)));
            let choice = 'all';
            if (hasPinned) {
                const result = await foundry.applications.api.DialogV2.wait({
                    window: { title: 'Delete Events' },
                    content: '<p>Some events are pinned. What would you like to do?</p>',
                    buttons: [
                        { action: 'all', label: 'Delete All', icon: 'fas fa-trash' },
                        { action: 'skip', label: 'Ignore Pinned', icon: 'fas fa-thumbtack' },
                        { action: 'cancel', label: 'Cancel', icon: 'fas fa-times' }
                    ]
                });
                if (!result || result === 'cancel') return;
                choice = result;
            }
            const label = choice === 'all' ? 'delete ALL events (including pinned)' : 'delete all non-pinned events';
            const ok = await foundry.applications.api.DialogV2.confirm({window:{title:'Confirm'},content:`<p>Are you sure you want to ${label}?</p>`});
            if (!ok) return;
            // Delete phone events
            const pid = this.widget.currentPhoneId;
            const map = loadMap(pid);
            _clearMapCache();
            for (const [dk, evts] of map) for (const e of evts) {
                if (choice === 'all' || !e.pinned) await _socketDeleteEvent(pid, dk, e.id);
            }
            // Delete calendaria notes (GM only)
            if (game.user.isGM) {
                for (const e of allEvts) {
                    if (e._type !== 'cal') continue;
                    if (choice !== 'all' && isCalPinned(pid, e.noteId)) continue;
                    try { await cApi()?.deleteNote(e.noteId); } catch {}
                }
            }
            this.render();
        });
        // Reuse expand/collapse, pin, delete, open listeners from calendar view
        this._setupNoteItemListeners(el);
    }

    _setupNoteItemListeners(el) {
        // Expand/collapse
        el.querySelectorAll('.smcal-note').forEach(item => {
            this.addListener(item,'click',(e)=>{
                if (e.target.closest('button')) return;
                const exp = item.querySelector('.smcal-expand'); if(!exp) return;
                const isOpen = exp.dataset.open==='1';
                if (!isOpen) {
                    exp.style.display='block'; exp.style.overflow='hidden'; exp.style.maxHeight='0'; exp.style.transition='max-height 0.25s ease-out';
                    requestAnimationFrame(()=>{ exp.style.maxHeight=exp.scrollHeight+'px'; });
                    const done=()=>{
                        exp.removeEventListener('transitionend',done); exp.style.maxHeight=MAX_EXPAND; exp.style.overflowY='auto';
                        const inner = exp.querySelector('.smcal-expand-inner');
                        if (inner) inner.classList.toggle('smcal-truncated', inner.scrollHeight > inner.clientHeight);
                    };
                    exp.addEventListener('transitionend',done); exp.dataset.open='1';
                } else {
                    exp.style.overflowY='hidden'; exp.style.maxHeight=exp.scrollHeight+'px'; exp.style.transition='none';
                    void exp.offsetHeight;
                    exp.style.transition='max-height 0.2s ease-in'; exp.style.maxHeight='0';
                    const done=()=>{ exp.removeEventListener('transitionend',done); exp.style.display='none'; };
                    exp.addEventListener('transitionend',done); exp.dataset.open='0';
                }
            });
        });
        // Open in Calendaria (edit mode for journal page)
        el.querySelectorAll('.open-note-btn').forEach(b=>{ this.addListener(b,'click',(e)=>{ e.stopPropagation(); const item = e.currentTarget.closest('[data-note-id]'); const id=item?.dataset.noteId; const jid=item?.dataset.journalId; if(!id)return; this._openCalNoteEdit(id, jid); }); });
        // Pin
        el.querySelectorAll('.pin-note-btn').forEach(b=>{
            this.addListener(b,'click',async(e)=>{
                e.stopPropagation();
                const calPinId = e.currentTarget.dataset.calPin;
                if (calPinId) { await toggleCalPin(this.widget.currentPhoneId, calPinId); }
                else { const eid=e.currentTarget.closest('[data-phone-evt-id]')?.dataset.phoneEvtId; if(eid) await togglePin(this.widget.currentPhoneId,eid); }
                this.render();
            });
        });
        // Edit (phone events — search across all dates)
        el.querySelectorAll('.edit-note-btn').forEach(b=>{
            this.addListener(b,'click',(e)=>{
                e.stopPropagation();
                const item=e.currentTarget.closest('[data-phone-evt-id]');
                const eid=item?.dataset.phoneEvtId; if(!eid)return;
                const map = loadMap(this.widget.currentPhoneId);
                for (const [dk,evts] of map) {
                    const evt = evts.find(ev=>ev.id===eid);
                    if (evt) {
                        const [y,m,d] = dk.split('-').map(Number);
                        this.selectedDate = { year:y, month:m, day:d };
                        this.editingNote = evt;
                        this.currentView = VIEW.EVENT_FORM;
                        this.render();
                        return;
                    }
                }
            });
        });
        // Delete — click handler (button hidden but kept for accessibility)
        el.querySelectorAll('.delete-note-btn').forEach(b=>{
            this.addListener(b,'click',async(e)=>{
                e.stopPropagation();
                await this._confirmAndDeleteNote(e.currentTarget.closest('.smcal-note'));
            });
        });
        // Right-click on any note = delete (replaces hidden button)
        el.querySelectorAll('.smcal-note').forEach(item => {
            this.addListener(item, 'contextmenu', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this._confirmAndDeleteNote(item);
            });
        });
    }

    /** Shared delete flow — confirms, deletes, re-renders. */
    async _confirmAndDeleteNote(item) {
        if (!item) return;
        const src = item.dataset.source;
        const name = item.querySelector('.smcal-title')?.textContent?.trim() || '';
        // Calendaria notes are GM-owned; non-GMs get an informational dialog rather
        // than a permission error from the Calendaria API.
        if (src === 'calendaria' && !game.user.isGM) {
            await foundry.applications.api.DialogV2.prompt({
                window: { title: 'Cannot Delete' },
                content: `<p>Calendaria notes can only be deleted by the GM.</p>`,
                ok: { label: 'OK' }
            });
            return;
        }
        const label = src === 'calendaria' ? ' (Calendaria Note)' : '';
        const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: 'Delete?' }, content: `<p>Delete <strong>${esc(name)}${label}</strong>?</p>` });
        if (!ok) return;
        if (src === 'calendaria') { const nid = item.dataset.noteId; if (nid) try { await cApi()?.deleteNote(nid); } catch {} }
        else { const eid = item.dataset.phoneEvtId; if (eid) await delEvt(this.widget.currentPhoneId, eid); }
        this.render();
    }

    /** Open a Calendaria note in edit mode on its Content tab.
     *  Uses the Calendaria public API to open (which handles its custom sheet correctly),
     *  then activates the content tab once the DOM is in place. */
    async _openCalNoteEdit(noteId) {
        try {
            const api = cApi();
            const page = api?.getNoteDocument?.(noteId);
            // Non-editors open in view mode so they don't hit permission errors.
            const canEdit = page?.isOwner || canDo('editNotes');
            await api?.openNote?.(noteId, { mode: canEdit ? 'edit' : 'view' });
            if (!canEdit) return;
            const sheet = page?.sheet;
            if (!sheet) return;
            // Give the sheet a moment to finish rendering before we swap tabs.
            const activate = () => {
                try {
                    if (sheet.changeTab) sheet.changeTab('content', 'primary');
                    else if (sheet._tabs?.[0]?.activate) sheet._tabs[0].activate('content');
                    const link = sheet.element?.querySelector?.('[data-tab="content"]');
                    if (link) link.click();
                } catch {}
            };
            setTimeout(activate, 80);
            // In case the sheet renders twice (v13 mode switch), re-activate once more
            setTimeout(activate, 250);
        } catch (e) { console.warn(`${MODULE_ID} | openCalNoteEdit failed:`, e); }
    }

    _setupCalL() {
        const el = this.element;
        // Today
        const tb = el.querySelector('.today-btn');
        if (tb) this.addListener(tb,'click',()=>{ const dt=currentDateTime(); if(!dt)return; this.currentDisplayDate={year:dt.year,month:dt.month}; this.selectedDate={year:dt.year,month:dt.month,day:dt.day}; this._userSelected=false; this.render(); });
        // All notes
        const pb = el.querySelector('.all-notes-btn');
        if (pb) this.addListener(pb,'click',()=>{ this.currentView = VIEW.PINNED; this.notesTab = 'pinned'; this.render(); });
        // Month nav
        const nm = getMonths().length||12;
        const prev = el.querySelector('.prev-month');
        if (prev) this.addListener(prev,'click',()=>{ this.currentDisplayDate.month--; if(this.currentDisplayDate.month<1){this.currentDisplayDate.month=nm;this.currentDisplayDate.year--;} this._userSelected=true; this.render(); });
        const next = el.querySelector('.next-month');
        if (next) this.addListener(next,'click',()=>{ this.currentDisplayDate.month++; if(this.currentDisplayDate.month>nm){this.currentDisplayDate.month=1;this.currentDisplayDate.year++;} this._userSelected=true; this.render(); });
        // Inline year editor (click + type, or scroll wheel). Handles both {Y} full-year
        // and {y} 2-digit-year inputs; the user may have multiple of each in their format.
        const sizeYearInput = (ye) => {
            const probe = document.createElement('span');
            const cs = getComputedStyle(ye);
            probe.style.cssText = 'visibility:hidden;position:absolute;white-space:nowrap;';
            probe.style.font = cs.font;
            probe.style.letterSpacing = cs.letterSpacing;
            probe.textContent = ye.value;
            document.body.appendChild(probe);
            ye.style.width = (probe.offsetWidth + 4) + 'px';
            probe.remove();
        };
        el.querySelectorAll('.smcal-year-edit').forEach(ye => {
            const isShort = ye.dataset.yearMode === 'short';
            sizeYearInput(ye);
            const commitYear = () => {
                const v = parseInt(ye.value);
                if (!Number.isFinite(v)) return;
                let newYear;
                if (isShort) {
                    const cur = this.currentDisplayDate.year;
                    const century = Math.trunc(cur / 100) * 100;
                    newYear = century + Math.max(0, Math.min(99, v));
                } else {
                    newYear = v;
                }
                if (newYear !== this.currentDisplayDate.year) {
                    this.currentDisplayDate.year = newYear; this._userSelected = true; this.render();
                }
            };
            this.addListener(ye, 'change', commitYear);
            this.addListener(ye, 'blur', commitYear);
            this.addListener(ye, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ye.blur(); } });
            this.addListener(ye, 'wheel', (e) => {
                e.preventDefault();
                ye.value = (parseInt(ye.value) || 0) + (e.deltaY < 0 ? 1 : -1);
                commitYear();
            });
        });
        // Inline month selector (click + pick, or scroll wheel). Multiple selects possible
        // via {M}/{m}/{m#} tokens in the format string.
        const sizeMonthSelect = (me) => {
            const opt = me.options[me.selectedIndex]; if (!opt) return;
            const probe = document.createElement('span');
            const cs = getComputedStyle(me);
            probe.style.cssText = 'visibility:hidden;position:absolute;white-space:nowrap;';
            probe.style.font = cs.font;
            probe.style.letterSpacing = cs.letterSpacing;
            probe.textContent = opt.textContent;
            document.body.appendChild(probe);
            me.style.width = (probe.offsetWidth + 8) + 'px';
            probe.remove();
        };
        el.querySelectorAll('.smcal-month-edit').forEach(me => {
            sizeMonthSelect(me);
            this.addListener(me, 'change', () => {
                const v = parseInt(me.value);
                if (Number.isFinite(v) && v !== this.currentDisplayDate.month) {
                    this.currentDisplayDate.month = v; this._userSelected = true; this.render();
                }
            });
            this.addListener(me, 'wheel', (e) => {
                e.preventDefault();
                let v = parseInt(me.value) || 1;
                // Scroll up = forward (higher month); scroll down = backward
                v += (e.deltaY < 0 ? 1 : -1);
                if (v < 1) { v = nm; this.currentDisplayDate.year--; }
                if (v > nm) { v = 1; this.currentDisplayDate.year++; }
                this.currentDisplayDate.month = v; this._userSelected = true; this.render();
            });
        });
        // Day cells
        el.querySelectorAll('.day:not(.empty)').forEach(c=>{ this.addListener(c,'click',(e)=>{ this.selectedDate={year:this.currentDisplayDate.year,month:this.currentDisplayDate.month,day:parseInt(e.currentTarget.dataset.day)}; this._userSelected=true; this.render(); }); });
        // GM right-click on a day cell = set world date to that day (with confirm)
        if (game.user.isGM) {
            el.querySelectorAll('.day:not(.empty)').forEach(c => {
                this.addListener(c, 'contextmenu', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const d = parseInt(c.dataset.day);
                    const y = this.currentDisplayDate.year;
                    const m = this.currentDisplayDate.month;
                    const label = `${getMonthName(m)} ${d}, ${y}`;
                    const ok = await foundry.applications.api.DialogV2.confirm({
                        window: { title: 'Set World Date' },
                        content: `<p>Set the world date to <strong>${esc(label)}</strong>?</p>`,
                        yes: { label: 'Set Date' },
                        no: { label: 'Cancel' }
                    });
                    if (!ok) return;
                    try {
                        const api = cApi();
                        if (api?.jumpToDate) {
                            // Calendaria — respects the active calendar's rules
                            await api.jumpToDate({ year: y, month: m, day: d });
                        } else {
                            // Standalone — compute Gregorian day delta, same approach as the
                            // GM Set Date button. Avoids SmartphoneTime's shifting semantics.
                            const dt = currentDateTime(); if (!dt) return;
                            const curDay = Date.UTC(dt.year, (dt.month || 1) - 1, dt.day || 1);
                            const tgtDay = Date.UTC(y, (m || 1) - 1, d || 1);
                            const deltaSec = Math.round((tgtDay - curDay) / 1000);
                            if (deltaSec) await game.time.advance(deltaSec);
                        }
                        this.selectedDate = { year: y, month: m, day: d };
                        this._userSelected = true;
                        this.render();
                    } catch (err) {
                        console.warn(`${MODULE_ID} | right-click set date failed:`, err);
                        ui.notifications?.warn('Failed to set world date.');
                    }
                });
            });
        }
        // Add event
        const addBtn = el.querySelector('.add-event-btn');
        if (addBtn) this.addListener(addBtn,'click',()=>{ this.currentView=VIEW.EVENT_FORM; this.editingNote=null; this.render(); });
        // Delete All
        const daBtn = el.querySelector('.delete-all-btn');
        if (daBtn) this.addListener(daBtn,'click',async()=>{ const {year,month,day}=this.selectedDate; const ok=await foundry.applications.api.DialogV2.confirm({window:{title:'Delete All'},content:`<p>Delete all phone events for ${esc(getMonthName(month))} ${day}?</p>`}); if(ok){await delAllEvts(this.widget.currentPhoneId,year,month,day);this.render();} });
        // Sort
        const stb = el.querySelector('.sort-time-btn');
        if (stb) this.addListener(stb,'click',()=>{ if(this.sortMode==='time') this.sortAsc=!this.sortAsc; else { this.sortMode='time'; this.sortAsc=true; } this._savePrefs(); this.render(); });
        const scb = el.querySelector('.sort-cat-btn');
        if (scb) this.addListener(scb,'click',()=>{ if(this.sortMode==='category') this.sortAsc=!this.sortAsc; else { this.sortMode='category'; this.sortAsc=true; } this._savePrefs(); this.render(); });
        // Compact toggle
        const cpb = el.querySelector('.compact-btn');
        if (cpb) this.addListener(cpb,'click',()=>{ this.compact = !this.compact; this._savePrefs(); this.render(); });
        // Expand/collapse
        el.querySelectorAll('.smcal-note').forEach(item => {
            this.addListener(item,'click',(e)=>{
                if (e.target.closest('button')) return;
                const exp = item.querySelector('.smcal-expand'); if(!exp) return;
                const isOpen = exp.dataset.open==='1';
                if (!isOpen) {
                    exp.style.display='block'; exp.style.overflow='hidden'; exp.style.maxHeight='0'; exp.style.transition='max-height 0.25s ease-out';
                    requestAnimationFrame(()=>{ exp.style.maxHeight=exp.scrollHeight+'px'; });
                    const done=()=>{
                        exp.removeEventListener('transitionend',done); exp.style.maxHeight=MAX_EXPAND; exp.style.overflowY='auto';
                        // Only show fade if content is actually truncated
                        const inner = exp.querySelector('.smcal-expand-inner');
                        if (inner) inner.classList.toggle('smcal-truncated', inner.scrollHeight > inner.clientHeight);
                    };
                    exp.addEventListener('transitionend',done); exp.dataset.open='1';
                } else {
                    exp.style.overflowY='hidden'; exp.style.maxHeight=exp.scrollHeight+'px'; exp.style.transition='none';
                    void exp.offsetHeight; // force reflow
                    exp.style.transition='max-height 0.2s ease-in'; exp.style.maxHeight='0';
                    const done=()=>{ exp.removeEventListener('transitionend',done); exp.style.display='none'; };
                    exp.addEventListener('transitionend',done); exp.dataset.open='0';
                }
            });
        });
        // Open in Calendaria — edit mode
        el.querySelectorAll('.open-note-btn').forEach(b=>{ this.addListener(b,'click',(e)=>{ e.stopPropagation(); const item=e.currentTarget.closest('[data-note-id]'); const id=item?.dataset.noteId; const jid=item?.dataset.journalId; if(id) this._openCalNoteEdit(id, jid); }); });
        // Edit
        el.querySelectorAll('.edit-note-btn').forEach(b=>{
            this.addListener(b,'click',(e)=>{ e.stopPropagation(); const item=e.currentTarget.closest('[data-phone-evt-id]'); const eid=item?.dataset.phoneEvtId; if(!eid)return;
                const {year,month,day}=this.selectedDate; const evt=getEvts(this.widget.currentPhoneId,year,month,day).find(ev=>ev.id===eid);
                if(evt){this.editingNote=evt;this.currentView=VIEW.EVENT_FORM;this.render();}
            });
        });
        // Pin (phone + calendaria)
        el.querySelectorAll('.pin-note-btn').forEach(b=>{
            this.addListener(b,'click',async(e)=>{
                e.stopPropagation();
                const calPinId = e.currentTarget.dataset.calPin;
                if (calPinId) {
                    await toggleCalPin(this.widget.currentPhoneId, calPinId);
                } else {
                    const eid=e.currentTarget.closest('[data-phone-evt-id]')?.dataset.phoneEvtId;
                    if(eid) await togglePin(this.widget.currentPhoneId,eid);
                }
                this.render();
            });
        });
        // Delete — click handler (button hidden but kept for accessibility)
        el.querySelectorAll('.delete-note-btn').forEach(b=>{
            this.addListener(b,'click',async(e)=>{
                e.stopPropagation();
                await this._confirmAndDeleteNote(e.currentTarget.closest('.smcal-note'));
            });
        });
        // Right-click on a note = delete (replaces hidden button)
        el.querySelectorAll('.smcal-note').forEach(item => {
            this.addListener(item, 'contextmenu', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                await this._confirmAndDeleteNote(item);
            });
        });

        // GM time controls (standalone mode, no Calendaria)
        this._setupGmCtrls(el);
    }

    /** Wires the GM Time/Advanced controls. No-op if they aren't rendered
     *  (Calendaria present, or not a GM). Uses SmartphoneTime.advance for unit-based
     *  time changes (so Simple Calendar / S&S / internal all work), and falls back to
     *  game.time.advance directly for set-date (to avoid SmartphoneTime's shifting
     *  timestamp semantics across time sources). */
    async _setupGmCtrls(el) {
        const root = el.querySelector('.smcal-gm-ctrls');
        if (!root) return;

        let ST, TOL;
        try {
            const stMod = await import('/modules/smartphone-widget/scripts/core/SmartphoneTime.js');
            ST = stMod.SmartphoneTime;
        } catch (e) { console.warn(`${MODULE_ID} | SmartphoneTime import failed:`, e); return; }

        // Time shortcuts — SmartphoneTime handles the "advance to next occurrence" math
        root.querySelectorAll('.smcal-gm-short').forEach(b => {
            this.addListener(b, 'click', () => {
                const key = b.dataset.shortcut;
                try { ST.setTimeToShortcut(key); } catch (e) { console.warn(`${MODULE_ID} | shortcut ${key}:`, e); }
            });
        });

        // Set-time-to-selected-date.
        // We compute the day delta directly against worldTime instead of round-tripping
        // through ST.fromObjectToTimestamp → ST.set, which silently no-ops on some time
        // sources (simple-timekeeping returns 0 from componentsToTime if not fully set up).
        const setDateBtn = root.querySelector('.smcal-gm-setdate');
        if (setDateBtn) this.addListener(setDateBtn, 'click', async () => {
            try {
                const dt = currentDateTime(); if (!dt) return;
                const curDay = Date.UTC(dt.year, (dt.month || 1) - 1, dt.day || 1);
                const tgtDay = Date.UTC(this.selectedDate.year, (this.selectedDate.month || 1) - 1, this.selectedDate.day || 1);
                const deltaSec = Math.round((tgtDay - curDay) / 1000);
                if (deltaSec) await game.time.advance(deltaSec);
            } catch (e) { console.warn(`${MODULE_ID} | set date failed:`, e); }
        });

        // Lighting FX toggle
        const lightingBtn = root.querySelector('.smcal-gm-lighting');
        if (lightingBtn) {
            const scene = game.scenes?.active;
            const enabled = !!scene?.getFlag?.('smartphone-widget', 'enableAutoLighting');
            lightingBtn.classList.toggle('smcal-gm-active', enabled);
            this.addListener(lightingBtn, 'click', async () => {
                try {
                    if (!TOL) {
                        const m = await import('/modules/smartphone-widget/scripts/core/TimeOfDayLighting.js');
                        TOL = m.TimeOfDayLighting;
                    }
                    const newState = await TOL.toggleCurrentSceneLighting();
                    if (newState !== null) lightingBtn.classList.toggle('smcal-gm-active', !!newState);
                } catch (e) { console.warn(`${MODULE_ID} | lighting toggle failed:`, e); }
            });
        }

        // Time manipulation.
        // Try SmartphoneTime first (respects active time source); if it silently
        // no-ops (common on some time sources for months/years), fall back to direct
        // game.time.advance with approximated seconds.
        const unitSel = root.querySelector('.smcal-gm-unit');
        if (unitSel) this.addListener(unitSel, 'change', () => { this._gmTimeUnit = unitSel.value; });
        const SEC_PER = { minutes: 60, hours: 3600, days: 86400, months: 86400 * 30, years: 86400 * 365 };
        root.querySelectorAll('[data-action="advance"]').forEach(b => {
            this.addListener(b, 'click', async () => {
                const value = parseInt(b.dataset.value);
                const unit = unitSel?.value || this._gmTimeUnit || 'days';
                this._gmTimeUnit = unit;
                if (!Number.isFinite(value) || value === 0) return;
                const before = game.time.worldTime;
                try { await ST.advance({ [unit]: value }); } catch {}
                // If ST.advance didn't change worldTime, fall back to direct advance.
                if (game.time.worldTime === before) {
                    try { await game.time.advance(value * (SEC_PER[unit] ?? 86400)); }
                    catch (e) { console.warn(`${MODULE_ID} | advance fallback failed:`, e); }
                }
            });
        });

        // Persist open/closed state of the accordion sections
        root.querySelectorAll('.smcal-gm-section').forEach((sec, i) => {
            const key = `_gmSec${i}`;
            if (this[key] != null) sec.open = this[key];
            this.addListener(sec, 'toggle', () => { this[key] = sec.open; });
        });
    }

    _setupFormL() {
        const el = this.element;
        const saveBtn = el.querySelector('.save-btn');
        if (saveBtn) this.addListener(saveBtn,'click',()=>this._saveNote());
        const cancelBtn = el.querySelector('.cancel-btn');
        if (cancelBtn) this.addListener(cancelBtn,'click',()=>{this.currentView=VIEW.CALENDAR;this.editingNote=null;this.render();});
        const deleteBtn = el.querySelector('.smcal-form-delete');
        if (deleteBtn) this.addListener(deleteBtn,'click',async ()=>{
            const evt = this.editingNote; if (!evt?.id) return;
            const ok = await foundry.applications.api.DialogV2.confirm({
                window: { title: 'Delete Event' },
                content: `<p>Delete <strong>${esc(evt.title || 'Untitled')}</strong>?</p>`
            });
            if (!ok) return;
            await delEvt(this.widget.currentPhoneId, evt.id);
            this.currentView = VIEW.CALENDAR; this.editingNote = null; this.render();
        });
        const form = el.querySelector('.smcal-form-body');
        if (form) this.addListener(form,'keydown',(e)=>{ if(e.key==='Enter'&&e.target.tagName!=='TEXTAREA'){e.preventDefault();this._saveNote();} });
        const ad = el.querySelector('#smcal-allday');
        if (ad) this.addListener(ad,'change',()=>{ const r=el.querySelector('.smcal-time-rows'); if(r) r.hidden=ad.checked; });
        // Auto-adjust end
        const sh=el.querySelector('#smcal-hour'),sm=el.querySelector('#smcal-minute');
        const eH=el.querySelector('#smcal-end-hour'),eM=el.querySelector('#smcal-end-minute');

        // Pull active calendar's hours/day + minutes/hour for validation clamping
        const hpd = getHoursPerDay(), mph = getMinutesPerHour();
        // Ensure max attributes reflect the active calendar (default was 23/59 which may be wrong)
        if (sh) sh.max = String(hpd - 1);
        if (sm) sm.max = String(mph - 1);
        if (eH) eH.max = String(hpd - 1);
        if (eM) eM.max = String(mph - 1);
        // Clamp helper — validates on change/blur, replaces invalid values silently
        const clampInput = (input, max) => {
            if (!input) return;
            if (input.value === '') return; // allow empty (placeholder) state
            let v = parseInt(input.value);
            if (isNaN(v) || v < 0) v = 0;
            else if (v > max - 1) v = max - 1;
            input.value = String(v).padStart(2, '0');
        };
        if (sh) { this.addListener(sh, 'blur', () => clampInput(sh, hpd)); this.addListener(sh, 'change', () => clampInput(sh, hpd)); }
        if (sm) { this.addListener(sm, 'blur', () => clampInput(sm, mph)); this.addListener(sm, 'change', () => clampInput(sm, mph)); }
        if (eH) { this.addListener(eH, 'blur', () => clampInput(eH, hpd)); this.addListener(eH, 'change', () => clampInput(eH, hpd)); }
        if (eM) { this.addListener(eM, 'blur', () => clampInput(eM, mph)); this.addListener(eM, 'change', () => clampInput(eM, mph)); }

        const maxMin = hpd * mph - 1;
        const autoEnd=()=>{
            if(!sh||!sm||!eH||!eM) return;
            const sv=parseInt(sh.value)||0,smv=parseInt(sm.value)||0;
            const ev=parseInt(eH.value),emv=parseInt(eM.value);
            if(isNaN(ev)||isNaN(emv)) return;
            if(sv*mph+smv >= ev*mph+emv){ const n=Math.min(sv*mph+smv+30, maxMin); eH.value=Math.floor(n/mph); eM.value=String(n%mph).padStart(2,'0'); }
        };
        if(sh) this.addListener(sh,'change',autoEnd);
        if(sm) this.addListener(sm,'change',autoEnd);
        const clampEnd=()=>{
            if(!sh||!sm||!eH||!eM) return;
            const sv=parseInt(sh.value)||0,smv=parseInt(sm.value)||0;
            const ev=parseInt(eH.value),emv=parseInt(eM.value);
            if(isNaN(ev)||isNaN(emv)) return;
            if(ev*mph+emv < sv*mph+smv){ eH.value=sh.value; eM.value=sm.value; }
        };
        if(eH) this.addListener(eH,'change',clampEnd);
        if(eM) this.addListener(eM,'change',clampEnd);
        // Auto-populate end time on focus if either end field is empty
        const autoPopulateEnd=()=>{
            if(!sh||!sm||!eH||!eM) return;
            if(eH.value!==''&&eM.value!=='') return;
            const sv=parseInt(sh.value), smv=parseInt(sm.value);
            if(isNaN(sv)||isNaN(smv)) return;
            const n=Math.min(sv*mph+smv+30, maxMin);
            eH.value=Math.floor(n/mph); eM.value=String(n%mph).padStart(2,'0');
        };
        if(eH) this.addListener(eH,'focus',autoPopulateEnd);
        if(eM) this.addListener(eM,'focus',autoPopulateEnd);
        // Color picker
        el.querySelectorAll('.smcal-copt').forEach(b=>{ this.addListener(b,'click',(e)=>{
            el.querySelectorAll('.smcal-copt').forEach(x=>{
                x.classList.remove('selected');
                // "None" option keeps its ban icon; color swatches clear their check
                x.innerHTML = x.classList.contains('smcal-copt-none') ? '<i class="fas fa-ban"></i>' : '';
            });
            e.currentTarget.classList.add('selected');
            e.currentTarget.innerHTML='<i class="fas fa-check"></i>';
        }); });
        // When a category is chosen, auto-select the "None" color option so the
        // category's own color is used. User can override by re-picking a swatch.
        const catSel = el.querySelector('#smcal-category');
        if (catSel) this.addListener(catSel, 'change', () => {
            if (!catSel.value) return;
            el.querySelectorAll('.smcal-copt').forEach(x => {
                x.classList.remove('selected');
                x.innerHTML = x.classList.contains('smcal-copt-none') ? '<i class="fas fa-ban"></i>' : '';
            });
            const none = el.querySelector('.smcal-copt-none');
            if (none) { none.classList.add('selected'); none.innerHTML = '<i class="fas fa-check"></i>'; }
        });
    }

    /* ==================== Save ==================== */

    _savePrefs() {
        try { game.settings.set(MODULE_ID, 'sortMode', this.sortMode); } catch {}
        try { game.settings.set(MODULE_ID, 'sortAsc', this.sortAsc); } catch {}
        try { game.settings.set(MODULE_ID, 'compact', this.compact); } catch {}
    }

    async _saveNote() {
        const el=this.element; if(!el)return;
        const pid=this.widget.currentPhoneId;
        if(!pid){ui.notifications.warn('No phone active.');return;}
        const name=el.querySelector('#smcal-title')?.value?.trim()||loc(`${I18N}.untitledEvent`,'Untitled');
        const allDay=el.querySelector('#smcal-allday')?.checked??false;
        const hour=parseInt(el.querySelector('#smcal-hour')?.value)||0;
        const minute=parseInt(el.querySelector('#smcal-minute')?.value)||0;
        const endHour=parseInt(el.querySelector('#smcal-end-hour')?.value);
        const endMinute=parseInt(el.querySelector('#smcal-end-minute')?.value);
        const memo=el.querySelector('#smcal-memo')?.value?.trim()||'';
        // Selected swatch; empty string = "None" (use category color / default)
        const pickedColor = el.querySelector('.smcal-copt.selected')?.dataset?.color;
        const category=el.querySelector('#smcal-category')?.value?.trim()||'';
        const {year,month,day}=this.selectedDate;
        const time=allDay?'00:00':fmtTime(hour,minute);

        // End time (only if both fields are filled)
        let endTime = '';
        if (!allDay && !isNaN(endHour) && !isNaN(endMinute)) {
            endTime = fmtTime(endHour, endMinute);
        }

        let categoryIcon='';
        let categoryColor='';
        if (category) {
            // Calendaria presets take precedence
            try {
                for (const p of (cApi()?.getPresets?.() ?? cApi()?.getCategories?.() ?? [])) {
                    const l = p.label ? (game.i18n.localize(p.label) || p.label) : p.id;
                    if (l === category) {
                        if (p.icon) categoryIcon = /^fa[srlbd] /.test(p.icon) ? p.icon : `fas ${p.icon}`;
                        if (p.color) categoryColor = p.color;
                        break;
                    }
                }
            } catch {}
            // Fallback to user-defined custom categories
            const cu = getCustomCategories().find(c => c?.name === category);
            if (cu) {
                if (!categoryIcon && cu.icon) categoryIcon = /^fa[srlbd] /.test(cu.icon) ? cu.icon : `fas ${cu.icon}`;
                if (!categoryColor && cu.color) categoryColor = cu.color;
            }
        }

        // Resolve color: explicit swatch → that color; "None" → category color → default
        const resolvedColor = (pickedColor && pickedColor !== '') ? pickedColor : (categoryColor || DEFAULT_COLOR);
        const evt = { id: this.editingNote?.id || foundry.utils.randomID(), title: name, time, memo, color: resolvedColor };
        if (endTime) evt.endTime = endTime;
        if (category) { evt.category = category; evt.categoryIcon = categoryIcon; }
        if(this.editingNote?.pinned) evt.pinned=true;
        if(this.editingNote?.id) await delEvt(pid,this.editingNote.id);
        try{await addEvt(pid,year,month,day,evt);}catch(err){console.error(`${MODULE_ID}|save:`,err);}
        this.currentView=VIEW.CALENDAR;this.editingNote=null;this.render();
    }
}
