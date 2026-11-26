// Trip companion — generic engine. Everything trip-specific comes from data/trip.json.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (name, cls = '') => `<svg class="ico ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

// Each kind of thing has one tag colour (css .k-*) and one icon.
const EV_KIND = { flight: 'flight', transit: 'train', food: 'food', sight: 'ticket', task: 'task', rest: 'stay' };
const EV_ICON = { flight: 'flight', transit: 'train', food: 'food', sight: 'sight', task: 'task', rest: 'bed' };
const BK_KIND = { flight: 'flight', train: 'train', hotel: 'stay', ticket: 'ticket', rental: 'ticket', other: 'other' };
const BK_ICON = { flight: 'flight', train: 'train', hotel: 'bed', ticket: 'ticket', rental: 'ticket', other: 'doc' };
const BK_LABEL = { flight: 'Flight', train: 'Train', hotel: 'Stay', ticket: 'Ticket', rental: 'Rental', other: 'Document' };
const evKind = (e) => EV_KIND[e.type] || 'other';
const bkKind = (b) => BK_KIND[b.type] || 'other';

let trip, byId = {}, bookingById = {};
const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem('trip.' + k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('trip.' + k, JSON.stringify(v)); } catch {} },
};

// ---------- time ----------
// "Preview time" lets you rehearse a day before the trip: ?now=2026-12-08T14:00 or the picker on Today.
let simNow = new URLSearchParams(location.search).get('now') || store.get('simNow');
function now() {
  if (!simNow) return new Date();
  // interpret a zone-less value as trip-local time
  if (/[zZ]|[+-]\d\d:\d\d$/.test(simNow)) return new Date(simNow);
  return zonedToDate(simNow, zone());
}

// ---------- legs ----------
// A trip can be split into legs (trip.legs): parts with their own title, dates, timezone, currency and language.
// One leg is shown at a time: the one we are in, else the next one, unless the traveller picked another from the title.
let leg = null;
const legOf = (date) => (trip.legs || []).find((l) => date >= l.startDate && date <= l.endDate) || null;
const inLeg = (date) => !leg || legOf(date) === leg;
const legDays = () => trip.days.filter((d) => inLeg(d.date));
const forLeg = (list) => (list || []).filter((x) => !x.leg || !leg || x.leg === leg.id);
const head = () => leg || trip; // whose title and subtitle to show
const zone = () => (leg && leg.tz) || trip.tz;
const cur = () => (leg && leg.currency) || trip.currency;
function autoLeg() {
  const L = trip.legs || [], at = new Date(), day = (l) => dateKey(at, l.tz || trip.tz);
  return L.find((l) => day(l) >= l.startDate && day(l) <= l.endDate) || L.find((l) => day(l) < l.startDate) || L[L.length - 1] || null;
}
function pickLeg() {
  if (simNow) { const l = legOf(String(simNow).slice(0, 10)); if (l) return l; }
  const auto = autoLeg(), saved = store.get('leg');
  // a picked leg holds until the calendar moves on to another leg
  return (saved && auto && saved.auto === auto.id && trip.legs.find((l) => l.id === saved.id)) || auto;
}
function setLeg(l, picked) {
  if (!l || l === leg) return;
  leg = l;
  if (picked) store.set('leg', { id: l.id, auto: (autoLeg() || {}).id });
  loadRate();
}
// the day to open when none is asked for: today, else the last one looked at, else the leg's first
const defaultDay = (first = legDays()[0] || trip.days[0]) => [todayKey(), store.get('day')].find((d) => d && trip.days.some((x) => x.date === d) && inLeg(d)) || first.date;
function legSheet() {
  const span = (l) => `${dayLabel(l.startDate, { day: 'numeric', month: 'short' })} – ${dayLabel(l.endDate, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  return `<div class="legs">${trip.legs.map((l) => `<button class="legrow${l === leg ? ' on' : ''}" data-leg="${esc(l.id)}" aria-pressed="${l === leg}"><b>${esc(l.title)}</b><span>${span(l)}${l.subtitle ? ' · ' + esc(l.subtitle) : ''}</span></button>`).join('')}</div>`;
}
function zonedToDate(local, tz) {
  const guess = new Date(local + (local.length === 16 ? ':00' : '') + 'Z');
  const shown = new Date(new Intl.DateTimeFormat('sv-SE', { timeZone: tz, dateStyle: 'short', timeStyle: 'medium' }).format(guess).replace(' ', 'T') + 'Z');
  return new Date(guess.getTime() - (shown - guess));
}
const fmtTime = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const fmtDate = (iso, tz, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...opts }).format(new Date(iso));
const dateKey = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const hourOf = (iso, tz) => +new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso));
const noon = (date) => date + 'T12:00:00Z'; // safe anchor for formatting a calendar date
const dayLabel = (date, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(noon(date)));
function dur(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  if (h < 24) return r ? `${h} h ${r} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? 's' : ''}${h % 24 ? ` ${h % 24} h` : ''}`;
}
// countdown split into big numbers and small units
function countParts(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  const p = d ? [[d, d > 1 ? 'days' : 'day'], [h % 24, 'h']] : h ? [[h, 'h'], [m % 60, 'min']] : [[m, 'min']];
  return p.filter(([n], i) => i === 0 || n).map(([n, u]) => `${n}<small>${u}</small>`).join(' ');
}
const tzAbbr = (iso, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName').value;
function todayKey() {
  // the trip day we are "in": match against each day's own timezone
  const n = now();
  const hit = trip.days.find((d) => dateKey(n, d.tz) === d.date);
  return hit ? hit.date : null;
}

// ---------- links ----------
function mapLinks(p) {
  const ll = `${p.lat},${p.lng}`;
  const q = encodeURIComponent(p.approx ? (p.address || p.name) : ll);
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=transit`,
    apple: `https://maps.apple.com/?daddr=${encodeURIComponent(p.approx ? (p.address || p.name) : ll)}&dirflg=r`,
  };
}
const dirButtons = (p, more = '') => {
  const l = mapLinks(p);
  return `<a class="btn ink" href="${l.google}" target="_blank" rel="noopener">${ico('arrow')}Directions</a>${more}<a class="btn" href="${l.apple}" target="_blank" rel="noopener">Apple Maps</a>`;
};

// ---------- small renderers ----------
function timeRange(e) {
  const a = fmtTime(e.start, e.tz), b = fmtTime(e.end, e.endTz || e.tz);
  const z = e.endTz && e.endTz !== e.tz ? ` ${tzAbbr(e.end, e.endTz)}` : '';
  return `${a} – ${b}${z}`;
}
const firstCode = (b) => Object.entries(b.confirmation || {})[0] || null;
function badges(e) {
  return `${e.critical ? '<span class="badge must">Must</span>' : ''}${e.optional ? '<span class="badge opt">Optional</span>' : ''}`;
}
function evRow(e, state, opts = {}) {
  const p = e.place && trip.places[e.place];
  const norm = (x) => x.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, ' ').trim();
  const parent = e.parent && byId[e.parent];
  const where = p && !norm(e.title).includes(norm(p.name)) && !norm(p.name).includes(norm(e.title)) && !(parent && parent.place === e.place) ? p.name : '';
  const meta = [dur(new Date(e.end) - new Date(e.start)), e.cost, where].filter(Boolean).join(' · ') || e.summary;
  const [hm, ap] = fmtTime(e.start, e.tz).split(' ');
  const tag = opts.tag || 'li';
  return `<${tag} class="ev k-${evKind(e)} ${state}" data-ev="${e.id}" role="button" tabindex="0">
    <div class="time">${opts.date ? `<small>${dayLabel(e.date, { day: 'numeric', month: 'short' })}</small>` : ''}${hm}<small>${ap}</small></div>
    <div class="tile">${ico(EV_ICON[e.type] || 'sight')}</div>
    <div class="body">
      <div class="name">${state === 'now' ? '<span class="nowpill">Now</span> ' : ''}${badges(e)}${esc(e.title)}${e.alerts.length ? `<span class="badge warn">${ico('alert')}${e.alerts.length}</span>` : ''}</div>
      <div class="meta">${esc(meta)}</div>
    </div></${tag}>`;
}
function stateOf(e, n) {
  if (new Date(e.end) <= n) return 'past';
  if (new Date(e.start) <= n) return 'now';
  return '';
}
const PARTS = [['Morning', 0, 12], ['Afternoon', 12, 17], ['Evening', 17, 24]];
// nowId (Today only): when given, just that event carries NOW; other running events show as plain rows
function rowsHtml(items, evs, n, nowId) {
  const st = (x) => { const s = stateOf(x, n); return nowId !== undefined && s === 'now' && x.id !== nowId ? '' : s; };
  return items.map((e) => {
    if (!e.group) return evRow(e, st(e));
    const kids = evs.filter((k) => k.parent === e.id);
    return `<li class="grp">${evRow(e, stateOf(e, n) === 'past' ? 'past' : '', { tag: 'div' })}<ul class="tl">${kids.map((k) => evRow(k, st(k))).join('')}</ul></li>`;
  }).join('');
}
let earlierOpen = false; // Today: the "Earlier" row is open; kept here so the 60 s refresh does not close it
const stops = (items, evs) => items.reduce((s, e) => s + (e.group ? evs.filter((k) => k.parent === e.id).length || 1 : 1), 0);
function timeline(date, opts = {}) {
  const n = now();
  const evs = trip.events.filter((e) => e.date === date);
  let top = evs.filter((e) => !e.parent);
  let html = '';
  if (opts.foldPast) {
    // done items quiet down and fold away; a group stays out until its last stop is over
    const done = top.filter((e) => new Date(e.end) <= n);
    top = top.filter((e) => new Date(e.end) > n);
    if (done.length) html += `<div class="earlier${earlierOpen ? ' open' : ''}"><button class="earlier-btn" data-earlier aria-expanded="${earlierOpen}"><span>Earlier · ${stops(done, evs)}</span>${ico('chev')}</button>${earlierOpen ? `<div class="stock"><ul class="tl">${rowsHtml(done, evs, n, opts.nowId)}</ul></div>` : ''}</div>`;
    if (!top.length) return html + `<div class="stock empty">Nothing else planned today.</div>`;
  }
  for (const [name, a, b] of PARTS) {
    const items = top.filter((e) => { const h = hourOf(e.start, e.tz); return h >= a && h < b; });
    if (!items.length) continue;
    const c = stops(items, evs);
    html += `<section><h2 class="guide">${name}<span>${c} ${c === 1 ? 'stop' : 'stops'}</span></h2><div class="stock"><ul class="tl">${rowsHtml(items, evs, n, opts.nowId)}</ul></div></section>`;
  }
  return html;
}
// ---------- calendar view of a day ----------
// Every hour has the same height (--hh in the css), so a block's size is its length and a gap is free time.
// Blocks sit at their true elapsed time; the hours down the side are the day's own timezone.
const SPINE = 0.32; // a group keeps this much of the lane for its own name; its stops fill the rest
const minOf = (d, tz) => +new Intl.DateTimeFormat('en-US', { timeZone: tz, minute: 'numeric' }).format(d);
function calendar(date) {
  const day = trip.days.find((d) => d.date === date), tz = day.tz, H = 36e5, n = now();
  const all = trip.events.filter((e) => e.date === date).map((e) => ({ e, a: +new Date(e.start), b: +new Date(e.end) })).sort((x, y) => x.a - y.a || y.b - x.b);
  if (!all.length) return '';
  // from the first whole hour to the last, stopping at midnight: a flight that lands tomorrow is cut there
  const first = all[0].a, last = Math.max(...all.map((x) => x.b));
  const midnight = +zonedToDate(new Date(+new Date(noon(date)) + 864e5).toISOString().slice(0, 10) + 'T00:00', tz);
  const t0 = first - minOf(first, tz) * 6e4;
  const t1 = Math.min(t0 + Math.ceil((last - t0) / H) * H, Math.max(midnight, t0 + H));
  for (const x of all) { x.end = Math.min(x.b, t1); x.vis = Math.max(x.end, x.a + H / 4); } // vis: a block is never drawn under 15 min tall
  // side-by-side columns for things that overlap, as a calendar does
  const leaves = all.filter((x) => !x.e.group);
  const place = (cl) => {
    const cols = Math.max(...cl.map((x) => x.col)) + 1;
    const l = cl.some((x) => x.e.parent && byId[x.e.parent]) ? SPINE : 0;
    for (const x of cl) {
      let span = 1; // widen into free columns to the right
      while (x.col + span < cols && !cl.some((y) => y.col === x.col + span && y.a < x.vis && x.a < y.vis)) span++;
      x.l = l + (1 - l) * x.col / cols; x.w = (1 - l) * span / cols;
    }
  };
  let cl = [], clEnd = 0, ends = [];
  for (const x of leaves) {
    if (cl.length && x.a >= clEnd) { place(cl); cl = []; ends = []; }
    x.col = ends.findIndex((t) => t <= x.a);
    if (x.col < 0) x.col = ends.length;
    ends[x.col] = x.vis; clEnd = Math.max(clEnd, x.vis); cl.push(x);
  }
  if (cl.length) place(cl);
  const block = (x) => {
    const { e } = x, mins = (x.b - x.a) / 6e4, cut = x.b > t1;
    const size = e.group ? 'grp' : mins < 30 ? 'xs' : mins < 50 ? 'sm' : '';
    // a one-line block has room for the bare times only, and for none at all when it shares the row
    const bare = shortRange(e).replace(/\s?[AP]M/g, '').replace(' – ', '–'), narrow = x.w < 0.6;
    const when = size === 'xs' ? (narrow ? '' : bare) : narrow ? bare
      : `${shortRange(e)}${cut ? ' · next day' : ''}${e.group ? '' : ' · ' + dur(x.b - x.a)}`;
    return `<div class="cb k-${evKind(e)} ${size} ${stateOf(e, n) === 'past' ? 'past' : ''} ${cut ? 'cut' : ''}" data-ev="${e.id}" role="button" tabindex="0" aria-label="${esc(e.title)}, ${esc(timeRange(e))}"
      style="--t:${(x.a - t0) / H};--d:${(x.end - x.a) / H}${e.group ? '' : `;--l:${x.l};--w:${x.w}`}"><div class="cb-n">${ico(EV_ICON[e.type] || 'sight')}${esc(e.title)}</div>${when ? `<div class="cb-m">${esc(when)}</div>` : ''}</div>`;
  };
  const hrs = Math.round((t1 - t0) / H);
  const hour = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric' });
  const labels = Array.from({ length: hrs + 1 }, (_, k) => `<span class="cal-h" style="--t:${k}">${hour.format(t0 + k * H)}</span>`).join('');
  const nowLine = date === todayKey() && n >= t0 && n <= t1 ? `<div class="cal-now" style="--t:${(n - t0) / H}"></div>` : '';
  return `<section class="stock cal" style="--hrs:${hrs};--spine:${SPINE}" aria-label="Calendar of the day">
    <div class="cal-grid"><div class="cal-hours" aria-hidden="true">${labels}</div><div class="cal-lane">${all.map(block).join('')}${nowLine}</div></div></section>`;
}
// ---------- storyboard view of a day ----------
// The day top to bottom: every block is as tall as the time it takes (SB px an hour), with its place photo and name.
// Travel sits between the blocks, unplanned time is a dashed block, and the rail is the sky at that hour.
const SB = 150, SB_MIN = 44, SB_MAX = 600, SB_FREE = 20 * 6e4; // a block is never under 44px or over four hours tall
function sunTimes(date, lat, lng) { // sunrise and sunset of a calendar date at a place, in ms (the sunrise equation)
  const rad = Math.PI / 180, sin = (d) => Math.sin(d * rad), cos = (d) => Math.cos(d * rad);
  const J = Math.round(Date.parse(noon(date)) / 864e5 + 2440587.5 - 2451545) - lng / 360;
  const M = (357.5291 + 0.98560028 * J) % 360, L = (M + 1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M) + 282.9372) % 360;
  const transit = 2451545 + J + 0.0053 * sin(M) - 0.0069 * sin(2 * L), dec = Math.asin(sin(L) * sin(23.44)) / rad;
  const c = (sin(-0.833) - sin(lat) * sin(dec)) / (cos(lat) * cos(dec));
  if (Math.abs(c) > 1) return null; // no sunrise or sunset that day
  const w = Math.acos(c) / rad / 360, ms = (jd) => (jd - 2440587.5) * 864e5;
  return { rise: ms(transit - w), set: ms(transit + w) };
}
function skyAt(t, sun) { // the colour of the sky, keyed to hours from sunrise and sunset
  const h = (t - sun.rise) / 36e5, L = (sun.set - sun.rise) / 36e5, N = [11, 16, 38];
  const S = [[-1.3, N], [-0.6, [74, 74, 134]], [0, [242, 185, 143]], [1.2, [188, 217, 238]], [L / 2, [143, 193, 234]], [L - 2.3, [156, 198, 230]],
    [L - 0.85, [241, 194, 122]], [L, [232, 128, 92]], [L + 0.75, [74, 74, 134]], [L + 2.2, [22, 29, 63]], [L + 5, N]];
  let c = N;
  for (let i = 1; i < S.length; i++) if (h >= S[i - 1][0] && h <= S[i][0]) {
    const [h0, a] = S[i - 1], [h1, b] = S[i], f = (h - h0) / (h1 - h0 || 1);
    c = a.map((v, j) => Math.round(v + (b[j] - v) * f));
    break;
  }
  return `rgb(${c.join(',')})`;
}
function storyboard(date) {
  const day = trip.days.find((d) => d.date === date), tz = day.tz, H = 36e5, n = now();
  const midnight = +zonedToDate(new Date(+new Date(noon(date)) + 864e5).toISOString().slice(0, 10) + 'T00:00', tz);
  const all = trip.events.filter((e) => e.date === date && !e.group)
    .map((e) => { const a = +new Date(e.start); return { e, a, b: Math.max(a, Math.min(+new Date(e.end), midnight)) }; })
    .sort((x, y) => x.a - y.a || y.b - x.b);
  if (!all.length) return '';
  const at = [day.stay, ...all.map((x) => x.e.place)].map((id) => trip.places[id]).find((p) => p && p.lat != null);
  const sun = at && sunTimes(date, at.lat, at.lng);
  const marked = new Set();
  const height = (ms) => Math.min(Math.round(ms / H * SB), SB_MAX);
  const row = (cls, a, b, px, time, body) => {
    const k = Math.max(1, Math.min(8, Math.round((b - a) / (H / 2))));
    const sky = sun ? `linear-gradient(${Array.from({ length: k + 1 }, (_, i) => skyAt(a + (b - a) * i / k, sun)).join(',')})` : 'var(--rule)';
    const marks = (sun ? [['Sunrise', sun.rise], ['Sunset', sun.set]] : []).filter(([l, t]) => t >= a && t < b && !marked.has(l)).map(([l, t]) => {
      marked.add(l);
      const y = Math.round((t - a) / (b - a) * px);
      return `<div class="sb-sun" style="--y:${y}px;--ly:${time ? Math.max(0, 50 - y) : 0}px"><span>${l}<br>${fmtTime(t, tz)}</span></div>`;
    }).join('');
    return `<li class="${cls}" style="--px:${px}px;--sky:${sky}"><div class="sb-t">${time}</div><span class="sb-rail"></span><div class="sb-b">${body}</div>${marks}</li>`;
  };
  let out = '', prevEnd = null, lastParent = null, lastPhoto = null;
  for (const x of all) {
    const { e } = x, gap = prevEnd === null ? 0 : x.a - prevEnd;
    // the first stop of a group ("Explore Shibuya") is announced by the group's name
    const ch = e.parent && e.parent !== lastParent && byId[e.parent];
    lastParent = e.parent || null;
    const from = gap > 0 ? prevEnd : x.a;
    if (ch) {
      const open = gap >= SB_FREE;
      out += row('sb-ch', from, x.a, Math.max(height(Math.max(gap, 0)), SB_MIN), '', `<div class="${open ? 'sb-free' : 'sb-chn'}" data-ev="${ch.id}" role="button" tabindex="0"><b>${esc(ch.title)}</b>${open ? dur(gap) : ''}</div>`);
    } else if (gap >= SB_FREE) out += row('sb-gap', from, x.a, height(gap), '', `<div class="sb-free"><b>Free</b>${dur(gap)}</div>`);
    else if (height(gap) > 0) out += row('sb-gap', from, x.a, height(gap), '', '');
    const px = Math.max(height(x.b - x.a), SB_MIN), len = dur(new Date(e.end) - x.a), past = stateOf(e, n) === 'past' ? ' past' : '';
    const [hm, ap] = fmtTime(e.start, e.tz).split(' ');
    const time = `${hm}<small>${ap}</small>`, label = `${esc(e.title)}, ${esc(timeRange(e))}`;
    if (e.type === 'transit' && !e.photo) {
      out += row('sb-leg' + past, x.a, x.b, px, time, `<div class="sb-hop" data-ev="${e.id}" role="button" tabindex="0" aria-label="${label}">${ico('train')}<span>${esc(e.story || e.title)}</span><b>${len}</b></div>`);
    } else {
      const p = e.place && trip.places[e.place];
      let ph = e.photo || (p && p.photo && !/^(task|transit|flight)$/.test(e.type) ? p.photo : null); // same rule as the event sheet
      if (ph && ph.src === lastPhoto) ph = null; // two stops at one place: the picture is shown once
      if (ph) lastPhoto = ph.src;
      out += row('sb-ev' + past, x.a, x.b, px, time, `<article class="sb-c k-${evKind(e)}${ph ? '' : ' nophoto'}${e.optional ? ' opt' : ''}" data-ev="${e.id}" role="button" tabindex="0" aria-label="${label}">
        ${ph ? `<div class="sb-ph"><img src="${esc(ph.src)}" alt="" loading="lazy"></div>` : ''}
        <div class="sb-tx"><div class="sb-k">${ico(EV_ICON[e.type] || 'sight')}${len}</div><h3 class="sb-n">${badges(e)}${esc(e.title)}</h3></div></article>`);
    }
    prevEnd = Math.max(prevEnd ?? 0, x.b);
  }
  return `<ol class="sb" aria-label="Storyboard of the day">${out}</ol>`;
}
// text that does not fit its block is trimmed: the duration line first, then the name to one line
function fitStory() {
  for (const tx of document.querySelectorAll('#view .sb-tx')) {
    const k = tx.querySelector('.sb-k'), t = tx.querySelector('.sb-n');
    const over = () => tx.scrollHeight > tx.clientHeight + 1;
    k.hidden = false; t.classList.remove('one');
    if (over()) k.hidden = true;
    if (over()) t.classList.add('one');
  }
}
function dayChips(sel, hrefFor) {
  const tk = todayKey();
  // with legs, each leg's days start with its month
  const sep = (d, i) => (trip.legs && legOf(d.date) && legOf(d.date) !== (i ? legOf(trip.days[i - 1].date) : null) ? `<span class="chipsep" role="presentation">${dayLabel(d.date, { month: 'short' })}</span>` : '');
  return `<div class="chips" role="list">${trip.days.map((d, i) => `${sep(d, i)}<a role="listitem" class="chip ${d.date === sel ? 'on' : ''} ${d.date === tk ? 'today' : ''}" href="${hrefFor(d.date)}" data-date="${d.date}" ${d.date === sel ? 'aria-current="date"' : ''}>
    <span class="dow">${dayLabel(d.date, { weekday: 'short' })}</span><span class="dom">${dayLabel(d.date, { day: 'numeric' })}</span></a>`).join('')}</div>`;
}
function stayCard(day) {
  const p = day.stay && trip.places[day.stay];
  if (!p) return '';
  const b = bookingById[day.stayBooking];
  return `<article class="tag stay"><span class="eyelet"></span>
    <h2 class="tag-t">${esc(p.name)}</h2>
    <p class="tag-m">Tonight's stay${p.address ? ' · ' + esc(p.address) : ''}</p>
    <div class="perf"></div>
    <div class="acts"><a class="btn ink" href="${mapLinks(p).google}" target="_blank" rel="noopener">${ico('arrow')}Directions</a>${b ? `<a class="btn ghost" href="#/booking/${b.id}">${ico('ticket')}Booking</a>` : ''}</div></article>`;
}
const dayOf = (day) => { const ds = trip.days.filter((d) => legOf(d.date) === legOf(day.date)); return `Day ${ds.indexOf(day) + 1} of ${ds.length} · ${esc(day.base)}`; };
function dayHead(date, bare) { // bare: the Days tab prints the "Day N of M" line beside its layout switch instead
  const day = trip.days.find((d) => d.date === date);
  return `<header class="dh${bare ? ' bare' : ''}"><div><h1>${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}</h1><div class="dt">${esc(day.title)}</div>${bare ? '' : `<p>${dayOf(day)}</p>`}</div>${wxBadge(date)}</header>`;
}
// alerts on list screens show their headline only; the event sheet carries the full text
function alertHead(html) {
  const bold = html.match(/<(b|strong)>([\s\S]*?)<\/\1>/i);
  const text = (bold ? bold[2] : html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const first = bold ? text : (text.match(/^.*?[.!?](\s|$)/) || [text])[0];
  return esc(first.length > 120 ? first.slice(0, 117).trimEnd() + '…' : first);
}
const alertBox = (e, a) => `<div class="alert ${a.level === 'critical' ? 'critical' : ''}" data-ev="${e.id}" role="button" tabindex="0">${ico('alert')}<div><span class="from">${fmtTime(e.start, e.tz)} · ${esc(e.title)}</span>${alertHead(a.html)} <u>More</u></div></div>`;

// ---------- wallet passes ----------
// the face of a pass: identical in the stack and at the top of the open pass, so the card can travel between them
function passFace(b, open) {
  const c = firstCode(b);
  const imgs = b.files.filter((f) => f.image).length, docs = b.files.length - imgs;
  const code = c ? `<small>${esc(c[0])}</small><b class="${String(c[1]).length > 12 ? 'long' : ''}">${esc(c[1])}</b>` : '<small>No reference number</small>';
  return `<div class="wp-band">${ico(BK_ICON[b.type] || 'doc')}<div class="bt"><b>${esc(b.short || b.title)}</b><span>${esc(BK_LABEL[b.type] || b.type)}${b.providerShort || b.provider ? ' · ' + esc(b.providerShort || b.provider) : ''}</span></div>
      ${b.startIso ? `<div class="when">${fmtDate(b.startIso, b.tz, { day: 'numeric', month: 'short' })}<small>${fmtTime(b.startIso, b.tz)}</small></div>` : ''}</div>
    <div class="wp-body">${open && c ? `<button class="wp-code" data-copy="${esc(c[1])}" aria-label="Copy ${esc(c[0])}">${code}<span class="cp">${ico('copy')}</span></button>` : `<div class="wp-code">${code}</div>`}
      <div class="wp-has">${imgs ? `<span>${ico('qr')}${imgs > 1 ? imgs : 'QR'}</span>` : ''}${docs ? `<span>${ico('doc')}${docs}</span>` : ''}</div></div>`;
}
function walletPass(b) {
  return `<div class="wpw"><article class="wp k-${bkKind(b)}" data-bk="${b.id}" tabindex="0" role="button" aria-label="${esc(b.title)}">${passFace(b)}</article></div>`;
}

// ---------- views ----------
const views = {
  today() {
    const n = now(), tk = todayKey();
    const mine = trip.events.filter((e) => inLeg(e.date)), e0 = mine[0];
    const first = new Date(e0.start), last = new Date(mine[mine.length - 1].end);
    if (!tk || n < first - 864e5 || n > last) {
      const before = n < first;
      return `<header class="dh"><p>${esc(head().subtitle || '')}</p></header>
        ${before ? `<article class="tag next" data-ev="${e0.id}" role="button" tabindex="0"><span class="eyelet"></span>
          <div class="count">${countParts(first - n)}</div>
          <h2 class="tag-t">${esc(e0.title)}</h2>
          <p class="tag-m">Trip starts ${fmtDate(e0.start, e0.tz, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(e0.start, e0.tz)}</p>
          <div class="perf"></div>
          <div class="acts"><a class="btn ink" href="#/days/${e0.date}">See day 1</a><a class="btn ghost" href="#/bookings">${ico('ticket')}Bookings</a></div></article>`
        : `<article class="tag next"><span class="eyelet"></span><h2 class="tag-t" style="font-size:30px">Welcome home.</h2><p class="tag-m">${esc(head().title)} is over. Everything stays here to look back on.</p></article>`}
        ${openChecklists()}
        ${upcomingBookings(n)}`;
    }
    const day = trip.days.find((d) => d.date === tk);
    const evs = trip.events.filter((e) => e.date === tk);
    const leaf = evs.filter((e) => !e.group);
    const current = leaf.filter((e) => new Date(e.start) <= n && n < new Date(e.end)).pop();
    const next = trip.events.filter((e) => !e.group && new Date(e.start) > n)[0];
    const musts = evs.filter((e) => e.critical && new Date(e.end) > n);
    const alerts = evs.filter((e) => new Date(e.end) > n).flatMap((e) => e.alerts.filter((a) => a.level === 'critical').map((a) => ({ e, a })));
    let h = dayHead(tk);
    if (next) {
      const p = trip.places[next.place];
      const sameDay = next.date === tk;
      h += `<article class="tag next" data-ev="${next.id}" role="button" tabindex="0"><span class="eyelet"></span>
        <div class="count" aria-label="Next, in ${dur(new Date(next.start) - n)}"><span class="in">in</span> ${countParts(new Date(next.start) - n)}</div>
        <h2 class="tag-t">${badges(next)}${esc(next.title)}</h2>
        <p class="tag-m">${sameDay ? '' : fmtDate(next.start, next.tz, { weekday: 'long' }) + ' · '}${timeRange(next)}${p ? ' · ' + esc(p.name) : ''}${next.cost ? ' · ' + esc(next.cost) : ''}</p>
        <div class="perf"></div>
        <div class="acts">${p ? `<a class="btn ink" href="${mapLinks(p).google}" target="_blank" rel="noopener">${ico('arrow')}Directions</a>` : ''}<button class="btn ghost">Details</button>${next.booking && bookingById[next.booking] ? `<a class="btn ghost" href="#/booking/${next.booking}">${ico('ticket')}Ticket</a>` : ''}</div></article>`;
    }
    if (current) {
      const pct = Math.min(100, ((n - new Date(current.start)) / (new Date(current.end) - new Date(current.start))) * 100);
      h += `<article class="stock now" data-ev="${current.id}" role="button" tabindex="0"><div class="row1"><span class="t">${esc(current.title)}</span><span class="until">until ${fmtTime(current.end, current.endTz || current.tz)}</span></div>
        <div class="progress" role="progressbar" aria-label="Now: ${esc(current.title)}" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div></article>`;
    }
    h += planSwitch(tk);
    if (musts.length || alerts.length) {
      h += `<h2 class="sec">Don't miss today</h2>`;
      if (musts.length) h += `<div class="stock"><ul class="tl">${musts.map((e) => evRow(e, stateOf(e, n) === 'now' && (!current || e.id !== current.id) ? '' : stateOf(e, n))).join('')}</ul></div>`;
      h += alerts.map(({ e, a }) => alertBox(e, a)).join('');
    }
    h += timeline(tk, { foldPast: true, nowId: current ? current.id : null });
    h += stayCard(day);
    return h;
  },

  days(date) {
    date = trip.days.some((d) => d.date === date) ? date : defaultDay();
    store.set('day', date);
    const day = trip.days.find((d) => d.date === date);
    const i = trip.days.indexOf(day);
    const evs = trip.events.filter((e) => e.date === date);
    const warn = evs.flatMap((e) => e.alerts.filter((a) => a.level === 'critical').map((a) => ({ e, a })));
    const stored = store.get('dayView', 'story'), dv = ['story', 'cal', 'list'].includes(stored) ? stored : 'story', cal = dv === 'cal';
    const seg = (id, label, icon) => `<button class="${dv === id ? 'on' : ''}" aria-pressed="${dv === id}" aria-label="${label}" data-dayview="${id}">${ico(icon)}</button>`;
    return `${dayChips(date, (d) => '#/days/' + d)}
      ${dayHead(date, true)}
      <div class="daybar"><p>${dayOf(day)}</p><div class="seg2" role="group" aria-label="Day layout">${seg('story', 'Story', 'story')}${seg('cal', 'Calendar', 'days')}${seg('list', 'List', 'list')}</div><a class="btn" href="#/map/${date}" aria-label="Map of this day">${ico('map')}</a></div>
      ${planSwitch(date)}
      ${warn.map(({ e, a }) => alertBox(e, a)).join('')}
      ${(dv === 'story' ? storyboard(date) : cal ? calendar(date) : timeline(date)) || '<div class="stock empty">Nothing planned this day.</div>'}
      ${stayCard(day)}`;
  },

  bookings() {
    const n = now();
    if (!trip.bookings.length) return `<header class="dh"><div><h1>Bookings</h1></div></header><div class="stock empty">No bookings added yet.</div>`;
    const up = trip.bookings.filter((b) => !b.endIso || new Date(b.endIso) > n);
    const past = trip.bookings.filter((b) => b.endIso && new Date(b.endIso) <= n);
    const active = up.filter((b) => b.startIso && new Date(b.startIso) <= n);
    const ahead = up.filter((b) => !active.includes(b));
    const [head, ...rest] = ahead;
    return `<header class="dh"><div><h1>Bookings</h1><p>${trip.bookings.length} reservations</p></div></header>
      ${active.length ? `<h2 class="sec">In use now</h2><div class="wallet">${active.map(walletPass).join('')}</div>` : ''}
      ${head ? `<h2 class="sec">Up next</h2><div class="wallet">${walletPass(head)}</div>` : ''}
      ${rest.length ? `<h2 class="sec">Later <span class="muted">${rest.length}</span></h2><div class="wallet">${rest.map(walletPass).join('')}</div>` : ''}
      ${past.length ? `<h2 class="sec">Past <span class="muted">${past.length}</span></h2><div class="wallet past">${past.map(walletPass).join('')}</div>` : ''}`;
  },
};

// ---------- plans (Plan B switches) ----------
function planChoice(p) { return (store.get('plans', {})[p.id]) || p.default; }
function applyPlans() {
  const pick = Object.fromEntries((trip.plans || []).map((p) => [p.id, planChoice(p)]));
  trip.events = trip.allEvents.filter((e) => !e.plan || pick[e.plan.id] === e.plan.option);
}
function planSwitch(date) {
  return (trip.plans || []).filter((p) => !date || p.date === date).map((p) => `<div class="stock plan">
    <div class="t">${esc(p.title)}</div><p class="small">${esc(p.note || '')}</p>
    <div class="seg2" role="group" aria-label="${esc(p.title)}">${p.options.map((o) => `<button aria-pressed="${planChoice(p) === o.id}" class="${planChoice(p) === o.id ? 'on' : ''}" data-plan="${p.id}:${o.id}">${esc(o.label)}</button>`).join('')}</div></div>`).join('');
}

// ---------- weather (Open-Meteo, no key; falls back to typical values) ----------
const WX = [[0, 'sun', 'Clear'], [2, 'part', 'Partly cloudy'], [3, 'cloud', 'Cloudy'], [48, 'fog', 'Fog'], [57, 'rain', 'Drizzle'], [67, 'rain', 'Rain'], [77, 'snow', 'Snow'], [82, 'rain', 'Showers'], [86, 'snow', 'Snow showers'], [99, 'storm', 'Thunderstorm']];
const wxCode = (c) => WX.find(([max]) => c <= max) || WX[2];
let wx = {};
const temp = (c) => (trip.weather.units === 'F' ? `${Math.round(c * 9 / 5 + 32)}°` : `${Math.round(c)}°`);
function wxInfo(date) {
  const w = trip.weather; if (!w) return null;
  const key = w.byDate[date], loc = key && w.locations[key]; if (!loc) return null;
  const f = wx.days && wx.days[key + '|' + date];
  if (f) {
    const [, icon, word] = wxCode(f.code);
    const extra = f.snow > 0 ? `snow ${f.snow} cm` : f.pop >= 30 ? `rain ${f.pop}%` : '';
    return { loc, icon, word, hi: f.hi, lo: f.lo, extra, live: true };
  }
  return { loc, icon: 'temp', word: 'Typical', hi: loc.typical.hi, lo: loc.typical.lo, extra: loc.typical.note, live: false };
}
function wxBadge(date) {
  const i = wxInfo(date);
  if (!i) return '';
  return `<div class="wx" title="${esc(i.loc.label)}"><b>${ico('w-' + i.icon)}${temp(i.hi)}</b><span>${i.live ? esc(i.word) : 'Typical'} · low ${temp(i.lo)}${i.live && i.extra ? '<br>' + esc(i.extra) : ''}</span></div>`;
}
async function loadWeather() {
  if (!trip.weather) return;
  wx = store.get('wx', {});
  if (wx.at && Date.now() - wx.at < 3 * 3600e3) return;
  const days = {};
  try {
    await Promise.all(Object.entries(trip.weather.locations).map(async ([key, loc]) => {
      const u = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,snowfall_sum&timezone=auto&forecast_days=16`;
      const d = (await (await fetch(u)).json()).daily;
      d.time.forEach((t, i) => { days[key + '|' + t] = { code: d.weather_code[i], hi: d.temperature_2m_max[i], lo: d.temperature_2m_min[i], pop: d.precipitation_probability_max[i] ?? 0, snow: Math.round(d.snowfall_sum[i] ?? 0) }; });
    }));
    wx = { at: Date.now(), days }; store.set('wx', wx);
    if (lastTab === 'more') { const el = $('#wxstrip'); if (el) el.innerHTML = wxStrip(); const v = $('#wxval'); if (v) v.textContent = wxNow(); } else if (lastTab !== 'map' && $('#sheet').hidden) route();
  } catch { /* offline: keep cached or typical values */ }
}
const wxStrip = () => legDays().map((d) => {
  const i = wxInfo(d.date);
  if (!i) return '';
  return `<div class="wxrow ${i.live ? '' : 'typ'}"><b>${dayLabel(d.date, { weekday: 'short', day: 'numeric' })}</b>${ico('w-' + i.icon)}<span class="w">${esc(i.loc.label)}<small>${i.live ? esc(i.word) + (i.extra ? ', ' + esc(i.extra) : '') : 'Typical'}</small></span><span class="t">${temp(i.hi)} / ${temp(i.lo)}</span></div>`;
}).join('');

// ---------- currency converter ----------
let fxs = {}; // one saved market rate per currency pair, e.g. USDJPY
const pair = (c = cur()) => c.home + c.local;
const fxOf = () => fxs[pair()] || null;
const rate = () => (fxOf() || cur()).rate;
async function loadRate() {
  const c = cur(), p = pair(c);
  fxs = store.get('fxs', {});
  if (fxs[p] && Date.now() - fxs[p].at < 12 * 3600e3) return;
  try {
    const j = await (await fetch(`https://api.frankfurter.dev/v1/latest?base=${c.home}&symbols=${c.local}`)).json();
    const r = j.rates && j.rates[c.local];
    if (r) { fxs = { ...store.get('fxs', {}), [p]: { rate: r, at: Date.now(), date: j.date } }; store.set('fxs', fxs); if (lastTab === 'more') { const n = $('#fxnote'); if (n) n.textContent = fxNote(); const v = $('#fxval'); if (v) v.textContent = fxVal(); convert('local'); } }
  } catch { /* offline: planning rate */ }
}
const fxNote = () => `${cur().homeSymbol}1 = ${cur().localSymbol}${rate().toFixed(1)} · ${fxOf() ? 'market rate from ' + fxOf().date : 'planning rate (offline)'}`;
function convert(from) {
  const l = $('#fx-local'), h = $('#fx-home'); if (!l || !h) return;
  const num = (el) => parseFloat(el.value.replace(/,/g, ''));
  if (from === 'local') { const v = num(l); h.value = isFinite(v) ? (v / rate()).toFixed(2) : ''; }
  else { const v = num(h); l.value = isFinite(v) ? Math.round(v * rate()) : ''; }
}

// ---------- search ----------
function search(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return '';
  const strip = (h) => h.replace(/<[^>]+>/g, ' ');
  const ev = trip.events.filter((e) => (e.title + ' ' + strip(e.html) + ' ' + ((trip.places[e.place] || {}).name || '')).toLowerCase().includes(q)).slice(0, 25);
  const bk = trip.bookings.filter((b) => JSON.stringify([b.title, b.short, b.provider, b.providerShort, b.confirmation, b.notes, b.location]).toLowerCase().includes(q));
  if (!ev.length && !bk.length) return `<div class="stock empty">Nothing matches “${esc(q)}”. Try a place, a day or a booking code.</div>`;
  return (bk.length ? `<div class="wallet" style="margin-top:12px">${bk.map(walletPass).join('')}</div>` : '')
    + (ev.length ? `<div class="stock"><ul class="tl">${ev.map((e) => evRow(e, '', { date: true })).join('')}</ul></div>` : '');
}

// ---------- phrases: saved cards to show to staff, a search over them, and Google Translate for the rest ----------
const lang = () => head().lang || 'ja';
const translateUrl = (q) => `https://translate.google.com/?sl=auto&tl=${lang()}&op=translate` + (q ? '&text=' + encodeURIComponent(q) : '');
function phrases(stays) {
  phSel = 0;
  const card = (id, en, local, find) => `<div class="stock staff" data-card="${id}" data-find="${esc(find.toLowerCase())}" role="button" tabindex="0"><div class="small">${esc(en)}</div><div class="jpline jp" lang="${lang()}">${esc(local)}</div></div>`;
  const groups = [];
  if (stays.length) groups.push(['Take me to', stays.map((p) => card('stay:' + p.id, 'Take me to ' + p.name, p.local || p.address || p.name, `take me to hotel taxi address ${p.name} ${p.local || ''}`))]);
  for (const k of forLeg(trip.cards)) {
    const name = k.group || 'Phrases';
    let g = groups.find((x) => x[0] === name);
    if (!g) groups.push(g = [name, []]);
    g[1].push(card(k.id, k.en, k.local, `${k.en} ${k.local} ${k.tags || ''} ${name}`));
  }
  return `<div class="searchbox">${ico('search')}<input id="pq" class="field" type="search" enterkeyhint="search" placeholder="Search phrases, or type your own" autocomplete="off" aria-label="Search phrases, or type something to translate"></div>
    ${groups.length > 1 ? `<div class="chips wrap" id="phchips" role="group" aria-label="Phrase groups">${groups.map(([name], i) => `<button class="chip pill ${i === 0 ? 'on' : ''}" aria-pressed="${i === 0}" data-pg="${i}">${esc(name)}</button>`).join('')}</div>` : ''}
    <div id="phrases">${groups.map(([name, list], i) => `<section class="ph-grp" data-g="${i}" ${i ? 'hidden' : ''}><h3 class="ph-g">${esc(name)}</h3>${list.join('')}</section>`).join('')}</div>
    <div class="stock pad gt"><p class="small" id="ph-none" hidden>No saved phrase matches. Translate it instead:</p>
      <a class="btn ink" id="gt" data-gt href="${translateUrl('')}" target="_blank" rel="noopener">${ico('arrow')}<span>Open Google Translate</span></a></div>`;
}
function filterPhrases(value) {
  const q = value.trim(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const g of document.querySelectorAll('#phrases .ph-grp')) {
    let any = false;
    for (const el of g.querySelectorAll('.staff')) { const hit = words.every((w) => el.dataset.find.includes(w)); el.hidden = !hit; any = any || hit; shown += hit; }
    g.hidden = q ? !any : g.dataset.g !== String(phSel);
  }
  $('#phrases').classList.toggle('srch', !!q);
  const chips = $('#phchips'); if (chips) chips.hidden = !!q;
  $('#ph-none').hidden = shown > 0;
  $('#gt').href = translateUrl(q);
  $('#gt span').textContent = q ? `Translate “${q}”` : 'Open Google Translate';
}

// ---------- more: a short menu, one screen per tool (#/more/<id>) ----------
const fxVal = () => `${cur().homeSymbol}1 = ${cur().localSymbol}${rate().toFixed(1)}`;
function wxNow() { // the high for today, or for the first day of the leg that has a forecast
  const d = [todayKey(), ...legDays().map((x) => x.date)].find((x) => x && inLeg(x) && wxInfo(x));
  return d ? temp(wxInfo(d).hi) : '';
}
function chkTotals() {
  const chk = store.get('chk', {});
  return forLeg(trip.checklists).reduce((t, l) => ({ done: t.done + l.items.filter((i) => chk[l.id + ':' + i.id]).length, all: t.all + l.items.length }), { done: 0, all: 0 });
}
function planVal(plans) { // only while a decision is still ahead
  const open = plans.filter((p) => new Date(noon(p.date)) > now() - 864e5)[0];
  return open ? (open.deadline ? 'By ' : '') + dayLabel(open.deadline || open.date, { day: 'numeric', month: 'short' }) : '';
}
function moreItems() {
  const c = cur();
  const stays = [...new Set(legDays().map((d) => d.stay).filter(Boolean))].map((id) => trip.places[id]);
  const plans = (trip.plans || []).filter((p) => inLeg(p.date));
  const em = forLeg(trip.emergency), cards = forLeg(trip.cards), lists = forLeg(trip.checklists);
  const tot = chkTotals();
  return [
    em.length && { id: 'emergency', title: 'Emergency', icon: 'phone', body: () => `<div class="stock">${em.map((e) => `<div class="em"><div><div class="t">${esc(e.label)}</div><div class="small muted">${esc(e.note || '')}</div></div><a class="btn ink" href="tel:${esc(e.phone.replace(/[^+\d]/g, ''))}">${ico('phone')}${esc(e.phone)}</a></div>`).join('')}</div>` },
    (stays.length || cards.length) && { id: 'staff', title: 'Show to staff', icon: 'book', body: () => phrases(stays) },
    { id: 'currency', title: 'Currency', icon: 'coin', value: `<span id="fxval">${fxVal()}</span>`, body: () => `<div class="stock pad"><div class="fx"><label>${esc(c.localSymbol)} ${esc(c.local)}<input id="fx-local" class="field" inputmode="decimal" placeholder="0"></label><span>=</span><label>${esc(c.homeSymbol)} ${esc(c.home)}<input id="fx-home" class="field" inputmode="decimal" placeholder="0"></label></div>
      <div class="fxq">${[500, 1000, 3000, 5000, 10000].map((v) => `<button class="btn sm" data-fx="${v}">${esc(c.localSymbol)}${v.toLocaleString('en-US')}</button>`).join('')}</div>
      <p class="note" id="fxnote">${fxNote()}</p></div>` },
    trip.weather && { id: 'weather', title: 'Weather', icon: 'w-part', value: `<span id="wxval">${esc(wxNow())}</span>`, body: () => `<div class="stock" id="wxstrip">${wxStrip()}</div>` },
    lists.length && { id: 'checklists', title: 'Checklists', icon: 'task', value: `${tot.done} / ${tot.all}`, body: () => { const chk = store.get('chk', {}); return lists.map((l) => { const done = l.items.filter((i) => chk[l.id + ':' + i.id]).length; return `<details class="stock list"><summary><span>${esc(l.title)}</span><span class="cnt" data-count="${l.id}">${done} / ${l.items.length}</span></summary>
      ${l.items.map((i) => `<label class="chk"><input type="checkbox" data-chk="${l.id}:${i.id}" ${chk[l.id + ':' + i.id] ? 'checked' : ''}><span>${esc(i.text)}</span></label>`).join('')}</details>`; }).join(''); } },
    plans.length && { id: 'plans', title: 'Plan switches', icon: 'list', value: esc(planVal(plans)), body: () => [...new Set(plans.map((p) => p.date))].map((d) => planSwitch(d)).join('') },
    { id: 'offline', title: 'Offline', icon: 'offline', value: '<span id="offval"></span>', body: () => '<div class="stock pad offcard" id="offline"><p class="small muted">Checking what is saved on this phone…</p></div>' },
    legDays().length && { id: 'rehearse', title: 'Rehearse a day', icon: 'days', body: () => `<div class="stock pad"><div class="btns" style="margin-top:0">${legDays().map((d) => `<button class="btn sm" data-sim="${d.date}T10:00">${dayLabel(d.date, { day: 'numeric', month: 'short' })}</button>`).join('')}</div></div>` },
  ].filter(Boolean);
}
views.more = function (id) {
  const items = moreItems(), it = items.find((x) => x.id === id);
  if (it) return `<a class="back" href="#/more">${ico('chev')}More</a><header class="dh" style="margin-top:2px"><div><h1>${esc(it.title)}</h1></div></header>${it.body()}`;
  const row = (x) => `<a class="mrow" href="#/more/${x.id}">${ico(x.icon)}<span class="ml">${esc(x.title)}</span>${x.value ? `<span class="mv">${x.value}</span>` : ''}${ico('chev', 'go')}</a>`;
  const em = items.find((x) => x.id === 'emergency');
  return `<div class="searchbox">${ico('search')}<input id="q" class="field" type="search" placeholder="Search places, days, booking codes" autocomplete="off" aria-label="Search the whole trip"></div><div id="results"></div>
    ${em ? `<a class="mem" href="#/more/emergency">${ico('phone')}<span>Emergency</span>${ico('chev', 'go')}</a>` : ''}
    <div class="stock mlist">${items.filter((x) => x !== em).map(row).join('')}</div>`;
};
let phSel = 0; // the phrase group shown while the search box is empty
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-pg]');
  if (!b) return;
  phSel = +b.dataset.pg;
  document.querySelectorAll('#phchips [data-pg]').forEach((c) => { const on = c === b; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
  filterPhrases($('#pq').value);
});

// ---------- offline: what is saved on this phone ----------
const DATA_CACHE = 'trip-data'; // must match sw.js
let savedPaths = []; // every document file as the service worker stores it (set at boot)
const tripFiles = () => ({
  docs: savedPaths,
  photos: [...Object.values(trip.places), ...trip.events].map((p) => p.photo && p.photo.src).filter(Boolean),
});
let saving = false;
async function offlineStatus() {
  const el = $('#offline'), ov = $('#offval');
  if (!el && !ov) return;
  if (!('serviceWorker' in navigator) || !window.caches || !isSecureContext) {
    if (ov) ov.textContent = 'Unavailable';
    if (el) el.innerHTML =`<div class="offrow warn">${ico('alert')}<div><b>Can't save for offline here</b><span>Open the app from its https address (or add it to the home screen) to keep a copy on this phone.</span></div></div>`;
    return;
  }
  const { docs, photos } = tripFiles();
  let cache, tripSaved = false, haveDocs = 0, havePhotos = 0;
  try {
    cache = await caches.open(DATA_CACHE);
    const has = async (p) => !!(await cache.match(new URL(p, location.href).href));
    tripSaved = await has(vault ? vault.index.trip : 'data/trip.json');
    for (const p of docs) haveDocs += await has(p);
    for (const p of photos) havePhotos += await has(p);
  } catch { /* storage blocked: shown as not saved */ }
  const ready = tripSaved && haveDocs === docs.length && havePhotos === photos.length;
  const missing = docs.length - haveDocs + photos.length - havePhotos + (tripSaved ? 0 : 1);
  const head = saving ? 'Saving to this phone…' : ready ? 'Ready without signal' : tripSaved ? `${missing} file${missing === 1 ? '' : 's'} still to save` : 'Not saved on this phone yet';
  const sub = ready
    ? `The plan, ${trip.bookings.length} bookings, ${docs.length} tickets and documents, and ${photos.length} photos are on this phone.`
    : `${haveDocs} of ${docs.length} tickets and documents · ${havePhotos} of ${photos.length} photos.${navigator.onLine ? '' : ' Connect to save the rest.'}`;
  if (ov) ov.textContent = saving ? 'Saving…' : ready ? 'Ready' : tripSaved ? `${missing} to save` : 'Not saved';
  if (!el) return;
  el.innerHTML =`<div class="offrow ${ready ? 'ok' : 'warn'}">${ico(ready ? 'task' : 'alert')}<div><b>${head}</b><span>${sub}</span></div></div>
    <button class="btn sm" data-offsave ${saving || !navigator.onLine ? 'disabled' : ''}>${ready ? 'Check for updates' : 'Save now'}</button>`;
}
async function saveOffline() {
  const reg = await navigator.serviceWorker?.ready;
  if (!reg?.active) return toast('Offline saving is not ready yet');
  saving = true; offlineStatus();
  reg.active.postMessage('save');
  setTimeout(() => { if (saving) { saving = false; offlineStatus(); } }, 60000);
}
navigator.serviceWorker?.addEventListener('message', (ev) => {
  if (ev.data?.type !== 'saved') return;
  saving = false;
  toast(ev.data.failed ? `${ev.data.failed} file${ev.data.failed === 1 ? '' : 's'} could not be saved` : 'Saved on this phone');
  offlineStatus();
});
function netChange() {
  document.documentElement.classList.toggle('offline', !navigator.onLine);
  if (!$('#top').hidden && trip) header();
  offlineStatus();
}
addEventListener('online', netChange);
addEventListener('offline', netChange);
function cardSheet(id) {
  let en, local, say = '';
  if (id.startsWith('stay:')) { const p = trip.places[id.slice(5)]; en = 'Please take me to this address · ' + p.name; local = (head().takeMe || 'ここへ行ってください。') + '\n' + (p.local || p.address || p.name); }
  else { const k = trip.cards.find((c) => c.id === id); en = k.en; local = k.local; say = k.say || ''; }
  return `<div class="bigcard"><div class="big jp" lang="${lang()}">${esc(local).replace(/\n/g, '<br>')}</div>${say ? `<div class="say">${esc(say).replace(/\n/g, '<br>')}</div>` : ''}<div class="en">${esc(en)}</div>
    ${'speechSynthesis' in window ? `<button class="btn" data-speak="${esc(local)}">${ico('speak')}Play</button>` : ''}</div>`;
}
function speak(text) { // the phone's own voice for the leg's language; works offline where that voice is installed
  const u = new SpeechSynthesisUtterance(text), l = lang();
  u.lang = l; u.rate = 0.85;
  const v = speechSynthesis.getVoices().find((x) => x.lang.replace('_', '-').toLowerCase().startsWith(l));
  if (v) u.voice = v;
  u.onerror = (e) => { if (!/interrupted|canceled/.test(e.error)) toast('No voice for this language on this phone'); };
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// Today before the trip: one link row per checklist of this leg that still has open items
function openChecklists() {
  const chk = store.get('chk', {});
  const rows = forLeg(trip.checklists).map((l) => ({ l, done: l.items.filter((i) => chk[l.id + ':' + i.id]).length })).filter((x) => x.done < x.l.items.length);
  if (!rows.length) return '';
  return `<h2 class="sec">Checklists</h2><div class="stock"><ul class="tl">${rows.map(({ l, done }) => `<li><a class="chkrow" href="#/more/checklists"><span>${esc(l.title)}</span><span class="cnt">${done} / ${l.items.length}</span>${ico('chev')}</a></li>`).join('')}</ul></div>`;
}
function upcomingBookings(n) {
  const up = trip.bookings.filter((b) => b.startIso && new Date(b.startIso) > n).slice(0, 3);
  if (!up.length) return '';
  return `<h2 class="sec">First bookings</h2><div class="wallet">${up.map(walletPass).join('')}</div>`;
}

// ---------- detail sheets ----------
// ---------- event descriptions: prose in, scannable blocks out (pattern-based, works for any trip) ----------
const ALERT_RE = /^(<b>)?\s*(⚠️|‼️)/;
const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const shortLinks = (h) => h.replace(/<a ([^>]*)>(https?:\/\/[^<]+)<\/a>/g, (m, a, u) => { try { return `<a ${a}>${new URL(u).hostname.replace(/^www\./, '')}</a>`; } catch { return m; } });
const tidyTime = (s) => s.replace(/:00(?=\s?[AP]M)/gi, '').replace(/\s?([AP]M)/gi, ' $1');
const T = '(\\d{1,2}(?::\\d{2})?\\s?[AP]M)';
const RANGE = new RegExp(`${T}\\s?(?:-|–|to)\\s?${T}`, 'gi');
const HOURS = new RegExp(`\\b(?:open|opens|hours)\\b[^.;]{0,48}?${T}\\s?(?:-|–|to)\\s?${T}`, 'gi');
function openHours(e, text) {
  // only for places you visit, and only when the text names exactly one opening range (several = several places; don't guess)
  if (e.group || !/^(sight|food|rest)$/.test(e.type)) return '';
  const hours = [...text.matchAll(HOURS)], ranges = text.match(RANGE) || [];
  return hours.length === 1 && ranges.length === 1 ? `${tidyTime(hours[0][1])}–${tidyTime(hours[0][2])}` : '';
}
const MONEY = /[¥$€£₩]\s?\d|\d\s?(yen|JPY|USD|EUR)\b/i;
const IMPERATIVE = /(?:^|[.!?]\s+)(?:Take|Go|Walk|Buy|Bring|Ask|Keep|Use|Check|Allow|Get|Head|Try|Book|Arrive|Leave|Look|Pick|Order|Avoid|Wear|Pay|Visit|Plan|Grab|Skip|Stop|Start|Follow|Turn|Cross|Show|Queue|Reserve|Make sure|Don't|Do not|Time)\b/;
function blockKind(h, t) {
  if (/^Route:/i.test(t) && /<a /.test(h)) return 'route';
  if (/<(ul|ol)>/.test(h) || /(^|<br>)\s*(<b>)?\s*(\d+[a-z]?\.|•)\s/.test(h)) return 'list';
  const lines = h.split(/<br>/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => /^<b>[^<]{1,24}<\/b>\s*[—–:-]\s/.test(l))) return 'labels';
  if (/^(Costs?\b|Budget|Only paid|Free\b|Everything[^.]*\bfree\b|[~≈]?\s?[A-Z]{0,3}[¥$€£₩]\s?\d|\d[\d,.]*\s?(yen|JPY|USD|EUR)\b)/i.test(t)) return 'cost';
  const first = t.split(/[.!?]\s/)[0];
  if (/\bfree\b/i.test(first) && MONEY.test(t.split(/[.!?]\s/).slice(0, 2).join(' '))) return 'cost';
  if (/\b(1[0-8]\d\d|19[0-8]\d)\b/.test(first) && !/\d{4}-\d{2}/.test(t) && !IMPERATIVE.test(t.slice(first.length))) return 'story';
  if (/\b(sunset|last (admission|entry|train|service|order)|gates? (are )?locked|closes at|closed on|leave by|be on (a|the) train by|winter hours)\b/i.test(t)) return 'time';
  return 'tip';
}
const KIND_ICON = { cost: 'coin', story: 'book', time: 'today' };
function listHtml(h) {
  // lead text, then the list items: native lists, "1." steps or "•" bullets
  if (/<(ul|ol)>/.test(h)) {
    const [lead] = h.split(/<(?:ul|ol)>/);
    const items = [...h.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
    const tail = h.split(/<\/(?:ul|ol)>/).pop();
    return { lead, items, numbered: /<ol>/.test(h), tail };
  }
  const lines = h.split(/<br>/).map((l) => l.trim()).filter(Boolean);
  const isItem = (l) => /^(<b>)?\s*(\d+[a-z]?\.|•)\s/.test(l) && !/^<b>[^<]*<\/b>:?$/.test(l); // a wholly bold "1. Title" line is a heading
  const first = lines.findIndex(isItem);
  if (first < 0) return { lead: h, items: [], numbered: false, tail: '' };
  const items = lines.slice(first).map((l) => l.replace(/^(<b>)?\s*(\d+[a-z]?\.|•)\s*/, '$1'));
  return { lead: lines.slice(0, first).join('<br>'), items, numbered: /^(<b>)?\s*\d/.test(lines[first]), tail: '' };
}
// "Topic — detail": bold the topic when the author didn't, so each paragraph starts with its point
const boldLead = (h) => (/^<b>/.test(h) ? h : h.replace(/^([^<—–:.!?]{3,60}?)(\s[—–]\s|:\s)/, '<b>$1</b>$2'));
function infoRow(h, kind = blockKind(h, txt(h))) {
  if (!KIND_ICON[kind]) return `<li class="ib-tip"><div>${boldLead(h)}</div></li>`; // plain advice: no icon, so the icons that remain mean something
  return `<li class="ib-${kind}"><span class="ib-i">${ico(KIND_ICON[kind])}</span><div>${kind === 'story' ? '<span class="ib-k">Story</span>' : ''}${h}</div></li>`;
}
const cap1 = (h) => h.replace(/^(\s*(?:<[^>]+>\s*)*)([a-z])/, (m, a, c) => a + c.toUpperCase());
function richText(e) {
  if (!e.html) return '';
  const blocks = e.html.split(/(?:<br>\s*){2,}/).map((s) => shortLinks(s.trim())).filter((b) => b && !ALERT_RE.test(b));
  let out = '', infos = [];
  const flush = () => { if (infos.length) out += `<ul class="ib">${infos.join('')}</ul>`; infos = []; };
  blocks.forEach((h, i) => {
    const t = txt(h), kind = blockKind(h, t);
    if (i === 0 && (kind === 'tip' || kind === 'story')) { out += `<p class="lede">${h}</p>`; return; }
    if (kind === 'route') {
      const href = /href="([^"]+)"/.exec(h)[1];
      flush(); out += `<a class="btn routebtn" href="${href}" target="_blank" rel="noopener">${ico('map')}Walking route in Maps</a>`; return;
    }
    if (kind === 'list') {
      const l = listHtml(h);
      flush();
      out += `${l.lead ? `<p class="steps-h">${l.lead.replace(/^<b>\s*(\d+[a-z]?)\.\s*/, '<span class="sn">$1</span><b>')}</p>` : ''}${l.items.length ? `<ol class="steps ${l.numbered ? 'num' : 'dot'}">${l.items.map((x) => `<li>${x}</li>`).join('')}</ol>` : ''}`;
      const tail = l.tail.replace(/^(<br>\s*)+/, '').trim();
      if (ALERT_RE.test(tail)) out += `<div class="alert">${ico('alert')}<div>${tail.replace(ALERT_RE, '$1').trim()}</div></div>`;
      else if (tail) infos.push(infoRow(tail));
      return;
    }
    if (kind === 'labels') {
      flush();
      out += `<dl class="opts">${h.split(/<br>/).filter((l) => l.trim()).map((l) => { const m = /^<b>([^<]+)<\/b>\s*[—–:-]\s*([\s\S]*)$/.exec(l.trim()); return `<div><dt>${m[1]}</dt><dd>${cap1(m[2])}</dd></div>`; }).join('')}</dl>`;
      return;
    }
    infos.push(infoRow(h, kind));
  });
  flush();
  return `<div class="rich">${out}</div>`;
}
function shortRange(e) { // "1:45 – 3:15 PM" when both ends share AM/PM
  const a = fmtTime(e.start, e.tz), b = fmtTime(e.end, e.endTz || e.tz);
  if (e.start === e.end) return a;
  if (e.endTz && e.endTz !== e.tz) return timeRange(e);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)} – ${b}` : `${a} – ${b}`;
}
function lastEntry(text) {
  const m = new RegExp(`last (?:admission|entry)[^.;]{0,24}?${T}`, 'i').exec(text);
  return m ? `last entry ${tidyTime(m[1])}` : '';
}
function facts(e) {
  const html = e.html || '';
  // "Free" only when a paragraph opens with it as the verdict and names no price; a wrong "Free" is worse than none
  const free = !e.cost && html.split(/(?:<br>\s*){2,}/).map(txt).some((b) => /^Free\s*[.,;:—–-]/.test(b) && !MONEY.test(b));
  const hours = openHours(e, txt(html));
  let cost = e.cost ? e.cost.split(/[.;]\s|\.$/)[0].trim() : '';
  const pp = /\/\s*pp\b|per person/i.test(cost);
  cost = cost.replace(/\s*\/\s*pp\b|\s*per person/i, '');
  const f = [
    ['today', shortRange(e), dur(new Date(e.end) - new Date(e.start))],
    cost || free ? ['coin', cost ? esc(cost) : 'Free', cost ? (pp ? 'per person' : 'cost') : 'no ticket'] : null,
    hours ? ['door', hours, lastEntry(txt(html)) || 'hours'] : null,
  ].filter(Boolean);
  return `<div class="facts ${f.length === 3 ? 'three' : ''}">${f.map(([i, v, s]) => `<div><b>${v}</b><small>${ico(i)}${s}</small></div>`).join('')}</div>`;
}
function eventSheet(e) {
  const p = e.place && trip.places[e.place];
  const b = e.booking && bookingById[e.booking];
  const kids = trip.events.filter((k) => k.parent === e.id);
  // a photo of where you'll be, not of where a task happens; an event's own photo (a special train) wins
  const ph = e.photo || (p && p.photo && !/^(task|transit|flight)$/.test(e.type) ? p.photo : null);
  return `<article class="ps k-${evKind(e)}">
    <div class="ps-band">${ico(EV_ICON[e.type] || 'sight')}<span>${fmtDate(e.start, e.tz, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
    ${ph ? `<figure class="hero"><img src="${esc(ph.src)}" alt="${esc(e.photo ? e.title : p.name)}" loading="lazy">${ph.credit ? `<figcaption>${esc(ph.credit)}${ph.license ? ' · ' + esc(ph.license) : ''}</figcaption>` : ''}</figure>` : ''}
    <div class="ps-in">
      <h2>${esc(e.title)}</h2>
      ${e.critical || e.optional ? `<div class="chipline">${badges(e)}</div>` : ''}
      ${e.story && e.type !== 'transit' ? `<p class="ps-story">${esc(e.story)}</p>` : ''}
      ${facts(e)}
      ${e.alerts.map((a) => `<div class="alert ${a.level}">${ico('alert')}<div>${a.html}</div></div>`).join('')}
      ${p || b ? `<div class="btns">${p ? `<a class="btn ink" href="${mapLinks(p).google}" target="_blank" rel="noopener">${ico('arrow')}Directions</a>` : ''}${p && p.map ? `<a class="btn" href="${esc(p.map)}" target="_blank" rel="noopener">${ico('map')}Terminal map</a>` : ''}${b ? `<a class="btn ${p ? '' : 'ink'}" href="#/booking/${b.id}">${ico('ticket')}Booking</a>` : ''}</div>` : ''}
      ${richText(e)}
      ${kids.length ? `<div class="box"><h3>In this block · ${kids.length} stops</h3><ol class="kids">${kids.map((k) => `<li data-ev="${k.id}" role="button" tabindex="0"><span class="t">${fmtTime(k.start, k.tz)}</span><span class="n">${esc(k.title)}</span>${ico('chev')}</li>`).join('')}</ol></div>` : ''}
      ${p ? `<div class="perf"></div><div class="box"><h3>Where</h3><div class="name">${esc(p.name)}</div>
        ${p.address ? `<div class="small muted">${esc(p.address)}</div>` : ''}
        ${p.local ? `<div class="jpline jp" lang="ja">${esc(p.local)}</div>` : ''}
        ${p.approx ? `<p class="small muted" style="margin-top:6px">Pin is approximate. Directions searches by name.</p>` : ''}
        <div class="btns">${dirButtons(p, `<a class="btn" href="#/map/${e.date}/${p.id}">${ico('map')}On map</a>`)}</div></div>` : ''}
    </div></article>`;
}
const URGENT = /^(CONFLICT|ACTION|UNPAID|NOT YET)/;
function sharedPrefix(labels) { // longest common start that ends at a " · " boundary
  let p = labels[0];
  for (const l of labels) while (p && !l.startsWith(p)) p = p.slice(0, -1);
  const i = p.lastIndexOf(' · ');
  return i < 0 ? '' : p.slice(0, i + 3);
}
function bookingSheet(b) {
  const codes = Object.entries(b.confirmation || {}).slice(1).map(([k, v]) => `<button class="code" data-copy="${esc(v)}" aria-label="Copy ${esc(k)}"><span><small>${esc(k)}</small><b class="${String(v).length > 28 ? 'long' : ''}">${esc(v)}</b></span>${ico('copy')}</button>`).join('');
  const seg = (b.segments || []).map((s) => `<div class="seg"><div class="route">${esc(s.number || '')} · ${esc(s.from || '?')} → ${esc(s.to || '?')}</div>
    <div class="small">${s.departIso ? `Departs ${fmtDate(s.departIso, s.depart_tz)} ${fmtTime(s.departIso, s.depart_tz)}` : 'Departure time not on ticket'} · ${s.arriveIso ? `arrives ${fmtDate(s.arriveIso, s.arrive_tz)} ${fmtTime(s.arriveIso, s.arrive_tz)}` : 'arrival time not on ticket'}</div>
    <div class="small muted">${[s.seat, s.cabin_class, s.aircraft].filter(Boolean).map(esc).join(' · ')}</div></div>`).join('');
  const pol = Object.entries(b.policies || {}).filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd class="plain">${esc(v)}</dd>`).join('');
  const loc = b.location;
  const price = b.price && b.price.amount != null ? `${b.price.currency} ${Number(b.price.amount).toLocaleString('en-US')}${b.price.paid === true ? ' · paid' : b.price.paid === false ? ' · NOT yet paid' : ''}` : '';
  const imgs = b.files.filter((f) => f.image), docs = b.files.filter((f) => !f.image);
  // several codes with one shared label prefix ("Tower QR · ticket 1 of 4"): show only what differs
  const cut = imgs.length > 1 ? sharedPrefix(imgs.map((f) => f.label)) : '';
  const capOf = (l) => { const r = l.slice(cut.length); return r ? r[0].toUpperCase() + r.slice(1) : l; };
  return `<div class="pv-top"><span>${esc(BK_LABEL[b.type] || b.type)}</span><button class="pv-done" data-close>Done</button></div>
    <div class="pv-w"><article class="wp pv-card k-${bkKind(b)}">${passFace(b, true)}</article></div>
    <div class="pv-more">
    ${imgs.length ? `<button class="btn ink showcodes" data-lb="${b.id}:0">${ico('qr')}${imgs.length > 1 ? `Show all ${imgs.length} codes full screen` : 'Show code full screen'}</button>
      <div class="qrs ${imgs.length > 1 ? 'multi' : ''}">${imgs.map((f, i) => `<button class="qr" data-lb="${b.id}:${i}" aria-label="Show ${esc(f.label)} full screen">${codeImg(f)}<span class="qr-cap">${esc(capOf(f.label))}</span><span class="qr-go">${ico('expand')}</span></button>`).join('')}</div>` : ''}
    <article class="ps ps-rest k-${bkKind(b)}">
    <div class="ps-in">
      <h2>${esc(b.title)}</h2>
      ${b.startIso ? `<p class="ps-when">${fmtDate(b.startIso, b.tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · ${fmtTime(b.startIso, b.tz)}${b.endIso ? ' → ' + fmtDate(b.endIso, b.tz) + ' ' + fmtTime(b.endIso, b.tz) : ''}</p>` : ''}
      ${codes ? `<div class="codes">${codes}</div>` : ''}
      ${(b.links || []).length || docs.length ? `<div class="btns">${(b.links || []).map((k) => `<a class="btn ink" href="${esc(k.url)}" target="_blank" rel="noopener">${ico('link')}${esc(k.label)}</a>`).join('')}${docs.map((f) => `<button class="btn" data-doc="${b.id}:${b.files.indexOf(f)}">${ico('doc')}${esc(f.label)}</button>`).join('')}</div>` : ''}
      ${b.pickup ? `<div class="alert">${ico('alert')}<div><span class="from">How to use or collect</span>${esc(b.pickup)}</div></div>` : ''}
      ${(b.notes || []).filter((x) => URGENT.test(x)).map((x) => `<div class="alert critical">${ico('alert')}<div>${esc(x)}</div></div>`).join('')}
      <div class="perf"></div>
      ${seg ? `<div class="box"><h3>Segments</h3>${seg}</div>` : ''}
      ${loc ? `<div class="box"><h3>Where</h3><div class="name">${esc(loc.name)}</div><div class="small muted">${esc(loc.address || '')}</div>
        ${loc.phone ? `<div class="btns"><a class="btn" href="tel:${esc(String(loc.phone).replace(/[^+\d]/g, ''))}">${ico('phone')}${esc(loc.phone)}</a></div>` : ''}</div>` : ''}
      ${(b.notes || []).some((x) => !URGENT.test(x)) ? `<div class="box"><h3>Good to know</h3><ul class="notes">${b.notes.filter((x) => !URGENT.test(x)).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
      ${pol || price ? `<div class="box"><h3>Details</h3><dl class="kv">${price ? `<dt>Price</dt><dd>${esc(price)}</dd>` : ''}${pol}</dl></div>` : ''}
      <p class="travelers">Travellers: ${(b.travelers || []).map(esc).join(', ')}</p>
    </div></article></div>`;
}
let sheetFrom = null;
function openSheet(html) {
  if ($('#sheet').hidden && !sheetFrom) sheetFrom = document.activeElement?.closest?.('[data-ev], [data-card]') || null;
  $('#sheet-card').innerHTML = `<div class="grab"><button aria-label="Close" data-close>${ico('close')}</button></div>${html}`;
  $('#sheet').hidden = false;
  $('#sheet-card').scrollTop = 0;
  $('#sheet-card').style.transform = ''; // a swipe-closed sheet leaves the card offset
  shell(true);
  $('#sheet [data-close]').focus({ preventScroll: true });
}
function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true;
  shell(false);
}
// after the view re-renders, put focus back on the row that opened the sheet
function refocusSheetOrigin() {
  if (!sheetFrom) return;
  const sel = sheetFrom.dataset.ev ? `[data-ev="${sheetFrom.dataset.ev}"]` : `[data-card="${sheetFrom.dataset.card}"]`;
  sheetFrom = null;
  $('#view ' + sel)?.focus({ preventScroll: true });
}

// ---------- open pass: Wallet-style. The tapped card rises to the top, the rest of the stack drops away ----------
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const RISE = 'cubic-bezier(.2, .9, .25, 1)', DROP = 'cubic-bezier(.45, 0, .2, 1)';
let passCtx = null;
const shell = (on) => { for (const el of [$('#view'), $('#tabs'), $('#top')]) el.inert = on; };
function openBooking(id, from) {
  if (passCtx || closing || !$('#pass').hidden) return; // one pass at a time: taps mid-lift or mid-return are ignored
  if (!from || !from.closest('.wallet')) { location.hash = '#/booking/' + id; return; }
  const back = location.hash || '#/today';
  history.pushState(null, '', '#/booking/' + id);
  openPass(id, from.closest('.wpw'), back);
}
// One element moves: the open pass's own card flies from the tapped slot to the top and back.
// The stack card is hidden while it is away, so two copies never overlap or swap mid-flight.
const PAST = 'saturate(.3) brightness(.92)';
function openPass(id, sel, backHash) {
  const pass = $('#pass');
  pass.innerHTML = `<div id="pass-in">${bookingSheet(bookingById[id])}</div>`;
  pass.hidden = false; pass.scrollTop = 0; pass.className = '';
  sizeCodes(pass);
  passCtx = { pushed: !!backHash, back: backHash, sel: null, lift: null, anims: [], focus: document.activeElement };
  shell(true);
  $('#pass .pv-done').focus({ preventScroll: true });
  if (reduced()) return;
  if (!sel || !sel.animate) { // no card to lift (deep link, button): the pass slides up from the bottom
    pass.animate([{ transform: 'translateY(56px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 340, easing: RISE });
    return;
  }
  const card = $('#pass .pv-w');
  const from = sel.getBoundingClientRect(), to = card.getBoundingClientRect();
  pass.classList.add('opening'); // see-through and untouchable until the card lands
  sel.style.visibility = 'hidden';
  const past = !!sel.closest('.wallet.past');
  const lift = card.animate([{ transform: `translate(${from.left - to.left}px, ${from.top - to.top}px)` }, { transform: 'none' }], { duration: 420, easing: RISE, fill: 'both' });
  const anims = [];
  if (past) anims.push($('.wp-band', card).animate([{ filter: PAST }, { filter: 'none' }], { duration: 420 }));
  const H = innerHeight;
  [...document.querySelectorAll('#view .wpw')].filter((c) => c !== sel).forEach((c, i) => {
    const r = c.getBoundingClientRect();
    if (r.top > H || r.bottom < 0) return;
    anims.push(c.animate([{ transform: 'none' }, { transform: `translateY(${H - r.top + 40}px)` }], { duration: 380, delay: Math.min(i, 5) * 18, easing: DROP, fill: 'forwards' }));
  });
  // cards drop solid; everything that isn't a card fades, so nothing is covered abruptly when the pass turns opaque
  for (const f of [...document.querySelectorAll('#view > *')].filter((x) => !x.matches('.wallet')).concat($('#top'))) anims.push(f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }));
  anims.push($('#tabs').animate([{ transform: 'translateX(-50%)' }, { transform: 'translate(-50%, 140%)' }], { duration: 300, easing: DROP, fill: 'forwards' }));
  $('#pass .pv-more').animate([{ opacity: 0, transform: 'translateY(48px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 200, easing: RISE, fill: 'backwards' });
  for (const el of document.querySelectorAll('#pass .pv-top, #pass .cp')) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 260, fill: 'backwards' });
  Object.assign(passCtx, { sel, lift, anims, past });
  lift.finished.then(() => pass.classList.remove('opening'), () => {});
}
let closing = false; // the stack stays untouchable until every card is home
let endClose = null; // finishes a close in progress at once (a tab was tapped mid-flight)
function closePass(animate = true) {
  const pass = $('#pass');
  if (pass.hidden) return;
  if (!animate && endClose) return endClose();
  const ctx = passCtx; passCtx = null;
  const hide = () => { pass.hidden = true; pass.innerHTML = ''; pass.className = ''; pass.style.pointerEvents = ''; };
  const refocus = () => { const f = (ctx?.sel && $('.wp', ctx.sel)) || ctx?.focus; if (f && f.isConnected && f.focus) f.focus({ preventScroll: true }); };
  const settle = () => { if (!ctx?.sel) return; ctx.anims.forEach((a) => a.cancel()); ctx.sel.style.visibility = ''; };
  let ended = false;
  const finish = () => { if (ended) return; ended = true; endClose = null; settle(); hide(); closing = false; shell(false); refocus(); };
  const later = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]); // never stuck if the page stops painting
  const tabsLive = () => { endClose = finish; $('#tabs').inert = false; }; // the bar works as soon as the close starts
  if (!animate || reduced() || !ctx?.lift || !ctx.sel.isConnected) {
    if (!animate || reduced() || !ctx?.lift) settle();
    if (!animate || reduced()) return finish();
    closing = true; tabsLive(); pass.style.pointerEvents = 'none';
    later(pass.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(40px)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished, 400).then(finish);
    return;
  }
  closing = true; tabsLive();
  pass.classList.add('opening');
  const card = $('#pass .pv-w');
  let fly;
  if (ctx.lift.playState === 'running') { // Done or Back mid-lift: play the opening backwards
    fly = ctx.lift; fly.playbackRate = -1.3; fly.play();
  } else {
    const r = card.getBoundingClientRect(), home = ctx.sel.getBoundingClientRect();
    fly = card.animate([{ transform: 'none' }, { transform: `translate(${home.left - r.left}px, ${home.top - r.top}px)` }], { duration: 400, easing: RISE, fill: 'forwards' });
    if (ctx.past) $('.wp-band', card).animate([{ filter: 'none' }, { filter: PAST }], { duration: 400, fill: 'forwards' });
  }
  for (const el of document.querySelectorAll('#pass .pv-more, #pass .pv-top, #pass .cp')) el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(24px)' }], { duration: 160, easing: 'ease-in', fill: 'forwards' });
  for (const a of ctx.anims) { a.playbackRate = -1.2; a.play(); }
  // the card lands exactly on its slot; the slot's own card reappears in the same frame the pass goes away
  later(fly.finished, 800).then(finish, finish);
}
// pull down to put it away: the close sits within reach of a thumb, wherever the Done button is
function pullToClose(el, part, canStart, close) {
  let x0 = null, y0 = 0, dy = 0, axis = '';
  el.addEventListener('touchstart', (ev) => { if (ev.touches.length !== 1 || !canStart()) return; x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; dy = 0; axis = ''; }, { passive: true });
  el.addEventListener('touchmove', (ev) => {
    if (x0 === null) return;
    const dx = ev.touches[0].clientX - x0; dy = ev.touches[0].clientY - y0;
    if (!axis && Math.hypot(dx, dy) > 8) axis = Math.abs(dy) > Math.abs(dx) && dy > 0 ? 'down' : 'other';
    if (axis !== 'down') { if (axis) x0 = null; return; }
    ev.preventDefault();
    part().style.transform = `translateY(${Math.max(0, dy) * 0.6}px)`;
  }, { passive: false });
  el.addEventListener('touchend', () => {
    if (x0 === null) return;
    x0 = null;
    const node = part();
    if (!node || axis !== 'down') return;
    if (dy > 110) return close();
    const from = node.style.transform; node.style.transform = '';
    if (!reduced()) node.animate([{ transform: from }, { transform: 'none' }], { duration: 260, easing: RISE });
  });
}

// ---------- codes: framed on the code itself when the data says where it is (file.focus = [x, y, w, h] as fractions) ----------
function codeImg(f, alt = '') {
  const fx = Array.isArray(f.focus) && f.focus.length === 4 ? f.focus : null;
  return `<span class="cf" ${fx ? `data-focus style="--x:${fx[0]};--y:${fx[1]};--w:${fx[2]};--h:${fx[3]}"` : ''}><img src="${esc(f.path)}" alt="${esc(alt)}"></span>`;
}
function sizeCode(img) {
  const cf = img.parentElement;
  if (!cf || !cf.classList.contains('cf')) return;
  if (img.naturalWidth && img.naturalWidth < 400) img.classList.add('px'); // tiny barcodes: scale up crisp, not blurred
  if (cf.hasAttribute('data-focus')) {
    const s = getComputedStyle(cf);
    cf.style.setProperty('--ar', (s.getPropertyValue('--w') * img.naturalWidth) / (s.getPropertyValue('--h') * img.naturalHeight));
  }
}
document.addEventListener('load', (ev) => { if (ev.target.tagName === 'IMG') sizeCode(ev.target); }, true);
const sizeCodes = (root) => root.querySelectorAll('.cf img').forEach((i) => i.complete && sizeCode(i));

// ---------- full-screen codes: white, awake, swipeable ----------
let wake = null, lbFrom = null;
const keepAwake = () => navigator.wakeLock?.request('screen').then((w) => { wake = w; w.addEventListener('release', () => { if (wake === w) wake = null; }); }, () => {});
function openLightbox(bid, start) {
  const b = bookingById[bid], imgs = b.files.filter((f) => f.image);
  const lb = $('#lightbox');
  const pre = imgs.length > 1 ? sharedPrefix(imgs.map((f) => f.label)) : '';
  const capOf = (l) => { const r = l.slice(pre.length).replace(/\s*\d+ of \d+$/i, ''); return r ? r[0].toUpperCase() + r.slice(1) : esc(b.title); };
  lbFrom = document.activeElement;
  lb.innerHTML = `<div class="lb-top"><span class="lb-n" aria-live="polite"></span><p>${ico('w-sun')}Turn brightness up</p></div>
    <div class="lb-track">${imgs.map((f) => `<figure class="lb-slide" data-mode="${f.focus ? 'crop' : 'zoom'}"><div class="lb-frame">${codeImg(f, f.label)}</div>
      <figcaption>${esc(capOf(f.label))}<small>${f.focus ? 'Tap to see the whole ticket' : 'Tap to zoom'}</small></figcaption></figure>`).join('')}</div>
    <div class="lb-foot">${imgs.length > 1 ? `<button class="lb-step" data-lbstep="-1" aria-label="Previous code">${ico('chev')}</button>` : ''}
      <button class="lb-done" data-lbclose>Done</button>
      ${imgs.length > 1 ? `<button class="lb-step next" data-lbstep="1" aria-label="Next code">${ico('chev')}</button>` : ''}</div>`;
  lb.hidden = false;
  if (!$('#pass').hidden) $('#pass').inert = true;
  shell(true); sizeCodes(lb);
  const track = $('.lb-track', lb);
  let at = -1;
  const count = () => {
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (i === at) return;
    at = i;
    lb.querySelectorAll('.lb-slide.on').forEach((s) => { s.classList.remove('on'); s.scrollTo(0, 0); });
    $('.lb-n', lb).textContent = imgs.length > 1 ? `${i + 1} of ${imgs.length}` : '';
  };
  track.scrollLeft = start * track.clientWidth;
  track.addEventListener('scroll', count, { passive: true }); count();
  if (!reduced()) lb.animate([{ opacity: 0, transform: 'scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: RISE });
  $('.lb-done', lb).focus({ preventScroll: true });
  keepAwake();
  history.pushState({ lb: 1 }, '', location.href);
}
function closeLightbox() {
  const lb = $('#lightbox');
  if (lb.hidden) return;
  lb.hidden = true; lb.innerHTML = '';
  wake?.release().catch(() => {}); wake = null;
  const pass = $('#pass');
  pass.inert = false;
  if (pass.hidden) shell(false);
  if (lbFrom?.isConnected) lbFrom.focus({ preventScroll: true });
}
function toggleCode(slide, ev) {
  const on = !slide.classList.contains('on');
  if (slide.dataset.mode === 'crop' || !on) return slide.classList.toggle('on', on);
  const r = slide.querySelector('.cf').getBoundingClientRect(), fx = (ev.clientX - r.left) / r.width, fy = (ev.clientY - r.top) / r.height;
  slide.classList.add('on'); // zoom: the frame grows and the slide scrolls natively, so a finger can pan
  const g = slide.querySelector('.cf').getBoundingClientRect();
  slide.scrollTo(fx * g.width - slide.clientWidth / 2, fy * g.height - slide.clientHeight / 2);
}
window.addEventListener('popstate', (ev) => { if (!ev.state?.lb) closeLightbox(); });
pullToClose($('#pass'), () => $('#pass-in'), () => $('#pass').scrollTop <= 0 && !$('#pass').classList.contains('opening'), () => $('#pass [data-close]')?.click());
pullToClose($('#lightbox'), () => $('#lightbox .lb-track'), () => !$('#lightbox .lb-slide.on[data-mode="zoom"]'), () => $('#lightbox [data-lbclose]')?.click());
// event and card sheets: the sheet card itself follows the finger, only from the top of its scroll
pullToClose($('#sheet-card'), () => $('#sheet-card'), () => !$('#sheet').hidden && $('#sheet-card').scrollTop <= 0, () => $('#sheet [data-close]')?.click());

// ---------- locked builds: trip data and documents are AES-GCM encrypted, the passcode opens them ----------
// A published build has data/index.json (salt, file list) and data/trip.enc instead of data/trip.json.
// The derived key is kept on this phone (IndexedDB, not exportable), so the passcode is asked once.
let vault = null; // { index, key } when the build is locked
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function keyDb(mode, fn) {
  return new Promise((res, rej) => {
    const o = indexedDB.open('trip-key', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('k');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const tx = o.result.transaction('k', mode); const r = fn(tx.objectStore('k')); tx.oncomplete = () => res(r.result); tx.onerror = () => rej(tx.error); };
  });
}
async function deriveKey(pass, kdf) {
  const raw = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(kdf.salt), iterations: kdf.iterations }, raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
const unlockBuf = (buf, key = vault.key) => crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
const MIME = { pdf: 'application/pdf', html: 'text/html', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
const opened = new Map();
// a URL the page can show for a trip file: the path itself, or an in-memory copy of the unlocked file
function urlOf(p) {
  const enc = vault && trip.enc && trip.enc[p];
  if (!enc) return Promise.resolve(p);
  if (!opened.has(p)) {
    opened.set(p, fetch(enc).then((r) => { if (!r.ok) throw new Error('not saved'); return r.arrayBuffer(); }).then((b) => unlockBuf(b))
      .then((plain) => URL.createObjectURL(new Blob([plain], { type: MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream' })))
      .catch((err) => { opened.delete(p); throw err; }));
  }
  return opened.get(p);
}
function askPasscode(tryKey) {
  $('#tabs').hidden = true; $('#top').hidden = true;
  $('#view').innerHTML = `<form id="lock" class="lock" autocomplete="off">
    <header class="dh"><div><h1>Locked</h1><p>This trip is private. Enter the family passcode once and this phone remembers it.</p></div></header>
    <input id="lock-pass" class="field" type="password" autocapitalize="none" autocorrect="off" spellcheck="false" aria-label="Passcode" placeholder="Passcode" required>
    <p class="note" id="lock-msg" role="alert"></p>
    <div class="btns"><button class="btn ink" type="submit">Unlock</button></div></form>`;
  return new Promise((done) => {
    $('#lock').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('#lock button'), msg = $('#lock-msg');
      btn.disabled = true; msg.textContent = 'Checking…';
      try { const out = await tryKey($('#lock-pass').value); $('#tabs').hidden = false; $('#top').hidden = false; done(out); }
      catch { btn.disabled = false; msg.textContent = 'That passcode does not open this trip. Check capitals and spaces.'; $('#lock-pass').select(); }
    });
  });
}
async function loadTrip() {
  let index = null;
  try { const r = await fetch('data/index.json', { cache: 'no-cache' }); if (r.ok) index = await r.json(); } catch { /* not a locked build, or nothing saved yet */ }
  if (!index || !index.kdf) return (await fetch('data/trip.json', { cache: 'no-cache' })).json();
  const res = await fetch(index.trip, { cache: 'no-cache' });
  if (!res.ok) throw new Error('trip file ' + res.status);
  const buf = await res.arrayBuffer();
  const open = async (key) => JSON.parse(new TextDecoder().decode(await unlockBuf(buf, key)));
  vault = { index, key: null };
  const saved = await keyDb('readonly', (s) => s.get('key')).catch(() => null);
  if (saved && saved.salt === index.kdf.salt) {
    try { const t = await open(saved.key); vault.key = saved.key; return t; } catch { /* passcode changed: ask again */ }
  }
  return askPasscode(async (pass) => {
    const key = await deriveKey(pass, index.kdf);
    const t = await open(key);
    vault.key = key;
    keyDb('readwrite', (s) => s.put({ salt: index.kdf.salt, key }, 'key')).catch(() => {});
    navigator.storage?.persist?.().catch(() => {});
    return t;
  });
}

// ---------- documents: shown inside the app (page pictures for PDFs, a sealed frame for saved emails) ----------
async function openDoc(bid, i) {
  const b = bookingById[bid], f = b.files[i], el = $('#doc');
  el.innerHTML = `<div class="doc-top"><span>${esc(f.label)}</span><button class="pv-done" data-docclose>Done</button></div><div class="doc-body"><p class="note">Opening…</p></div>`;
  el.hidden = false; el.scrollTop = 0;
  $('#pass').inert = true; shell(true);
  $('[data-docclose]', el).focus({ preventScroll: true });
  history.pushState({ doc: 1 }, '', location.href);
  const body = $('.doc-body', el);
  try {
    if (f.pages && f.pages.length) {
      const urls = await Promise.all(f.pages.map(urlOf));
      body.innerHTML = `<div class="doc-pages">${urls.map((u, n) => `<img src="${u}" alt="${esc(f.label)}, page ${n + 1} of ${urls.length}" draggable="false">`).join('')}</div>`;
      docZoom(body);
    } else if (/\.html?$/i.test(f.path)) {
      // saved emails are someone else's HTML: no scripts, no network except pictures
      const html = await (await fetch(await urlOf(f.path))).text();
      const sealed = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'"><base target="_blank">` + html;
      body.innerHTML = '<iframe sandbox="allow-popups" title="' + esc(f.label) + '"></iframe>';
      $('iframe', body).src = URL.createObjectURL(new Blob([sealed], { type: 'text/html' }));
    } else {
      body.innerHTML = `<div class="btns"><a class="btn ink" href="${await urlOf(f.path)}" target="_blank" rel="noopener">${ico('doc')}Open ${esc(f.label)}</a></div>`;
    }
  } catch {
    body.innerHTML = `<div class="alert">${ico('alert')}<div>This document is not saved on this phone yet. Connect, then open More and tap Save now.</div></div>`;
  }
}
// PDF pages zoom inside the app, so it works the same on every phone and in the installed app
function docZoom(body) {
  const pages = $('.doc-pages', body);
  let z = 1, pinch = null, tap = null;
  const at = (x, y) => { const r = pages.getBoundingClientRect(); return [(x - r.left) / r.width, (y - r.top) / r.height]; };
  const set = (nz, x, y, [ax, ay]) => { // keep the same spot of the page under (x, y)
    z = Math.min(5, Math.max(1, nz));
    pages.style.setProperty('--z', z);
    const r = pages.getBoundingClientRect();
    body.scrollLeft += r.left + ax * r.width - x;
    body.scrollTop += r.top + ay * r.height - y;
  };
  const two = (t) => [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2, Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1];
  body.addEventListener('touchstart', (ev) => { if (ev.touches.length !== 2) return; const [x, y, d] = two(ev.touches); pinch = { d, z, a: at(x, y) }; }, { passive: true });
  body.addEventListener('touchmove', (ev) => {
    if (!pinch || ev.touches.length !== 2) return;
    ev.preventDefault();
    const [x, y, d] = two(ev.touches);
    set(pinch.z * d / pinch.d, x, y, pinch.a);
  }, { passive: false });
  body.addEventListener('touchend', (ev) => { if (ev.touches.length < 2) pinch = null; });
  body.addEventListener('gesturestart', (ev) => ev.preventDefault()); // iOS: no page zoom on top of ours
  body.addEventListener('wheel', (ev) => { // trackpad pinch / ctrl + wheel
    if (!ev.ctrlKey) return;
    ev.preventDefault();
    set(z * Math.exp(-ev.deltaY / 100), ev.clientX, ev.clientY, at(ev.clientX, ev.clientY));
  }, { passive: false });
  body.addEventListener('click', (ev) => { // double tap: in close, or back out
    if (tap && ev.timeStamp - tap.t < 350 && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) < 40) {
      tap = null;
      set(z > 1.05 ? 1 : 2.5, ev.clientX, ev.clientY, at(ev.clientX, ev.clientY));
    } else tap = { t: ev.timeStamp, x: ev.clientX, y: ev.clientY };
  });
}
function closeDoc() {
  const el = $('#doc');
  if (el.hidden) return;
  el.hidden = true; el.innerHTML = '';
  $('#pass').inert = false;
  if ($('#pass').hidden) shell(false);
}
window.addEventListener('popstate', (ev) => { if (!ev.state?.doc) closeDoc(); });

// ---------- map ----------
let map, meMarker, mapDate;
// numbered pins that collide on screen at the current zoom fold into one badge ("5–15"); tapping it zooms in to its pins
let pinSet = [], pinLayer, grpLayer;
const PIN_GAP = 36, PIN_NO_GROUP_ZOOM = 18;
function pinGroups(zoom) {
  const loose = pinSet.filter((p) => !p.stay && !p.solo); // the ends of the leg in focus always show
  if (zoom >= PIN_NO_GROUP_ZOOM) return loose.map((p) => [p]);
  // a pin joins any group it touches, and groups it bridges merge, so no lone pin is left half under a badge
  const groups = [];
  for (const p of loose) {
    const a = { p, pt: map.project(p.ll, zoom) };
    const near = groups.filter((g) => g.some((b) => Math.hypot(a.pt.x - b.pt.x, a.pt.y - b.pt.y) < PIN_GAP));
    const g = near[0] || (groups.push([]), groups[groups.length - 1]);
    g.push(a);
    for (const o of near.slice(1)) { g.push(...o); groups.splice(groups.indexOf(o), 1); }
  }
  return groups.map((g) => g.map((x) => x.p));
}
function pinLabel(items) {
  const n = items.map((p) => p.n).sort((a, b) => a - b);
  return n[n.length - 1] - n[0] === n.length - 1 ? `${n[0]}–${n[n.length - 1]}` : `×${n.length}`;
}
function regroupPins() {
  if (!map || !map._loaded || !pinLayer) return;
  grpLayer.clearLayers();
  const hidden = new Set();
  for (const items of pinGroups(map.getZoom())) {
    if (items.length < 2) continue;
    items.forEach((p) => hidden.add(p));
    const lat = items.reduce((s, p) => s + p.ll[0], 0) / items.length, lng = items.reduce((s, p) => s + p.ll[1], 0) / items.length;
    const label = pinLabel(items);
    L.marker([lat, lng], { icon: L.divIcon({ className: '', html: `<div class="hit"><div class="pin group">${label}</div></div>`, iconSize: [44, 44], iconAnchor: [22, 22] }), keyboard: true, title: `Stops ${label}`, zIndexOffset: 500 })
      .on('click', () => {
        const b = L.latLngBounds(items.map((p) => p.ll)), cur = map.getZoom();
        let z = Math.min(map.getBoundsZoom(b, false, L.point(80, 130)), map.getMaxZoom());
        if (!(z > cur)) z = Math.min(cur + 2, map.getMaxZoom());
        map.setView(b.getCenter(), z, { animate: !reduced() });
      }).addTo(grpLayer);
  }
  for (const p of pinSet) {
    if (hidden.has(p)) pinLayer.removeLayer(p.m);
    else if (!pinLayer.hasLayer(p.m)) pinLayer.addLayer(p.m);
  }
}
// a block ("Explore Shibuya") is not a stop of its own: its sub-stops are. Same order as tools/routes.mjs.
function dayStops(date) {
  const stops = [];
  for (const e of trip.events.filter((x) => x.date === date && x.place && !x.group && trip.places[x.place])) {
    const last = stops[stops.length - 1];
    if (last && last.place.id === e.place) last.events.push(e);
    else stops.push({ place: trip.places[e.place], events: [e] });
  }
  return stops;
}

// ---------- hops: how you get from one stop to the next ----------
// A walk follows the street path saved by tools/routes.mjs. A train, bus, taxi or flight has no saved path,
// so it is an arc with its line name: clearly a hop, never a street route. One leg can be in focus; the rest fade.
let hops = [], hopFocus = null, hopLayer;
const onFoot = (e) => /^(walk|on foot)\b/i.test(e.story || '') || /^walk\b/i.test(e.title || '');
const isRide = (e) => (e.type === 'transit' || e.type === 'flight') && !onFoot(e);
function decodeLine(s) { // Google encoded polyline, 5 decimals
  const out = [];
  for (let i = 0, lat = 0, lng = 0; i < s.length;) {
    for (const k of [0, 1]) {
      let r = 0, sh = 0, b;
      do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
      const d = r & 1 ? ~(r >> 1) : r >> 1;
      if (k) lng += d; else lat += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
function arcLine(a, b) {
  const squash = Math.cos(a[0] * Math.PI / 180) || 1, dy = b[0] - a[0], dx = (b[1] - a[1]) * squash; // bend evenly on screen, not in degrees
  const c = [(a[0] + b[0]) / 2 + dx * 0.3, (a[1] + b[1]) / 2 - dy * 0.3 / squash];
  return Array.from({ length: 25 }, (_, i) => { const t = i / 24, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]; });
}
function rideLabel(e) {
  const cut = (s) => (s || '').split(/ · | to |->|→|[,;:(]/)[0].trim();
  const a = cut(e.story), b = cut(e.title);
  return e.type !== 'flight' && a && a.length <= 28 ? a : b.length <= 28 ? b : '';
}
// when you get there: the first thing that is not the journey itself
const arriveAt = (stop) => { const e = stop.events.find((x) => x.type !== 'transit' && x.type !== 'flight'); return e ? e.start : stop.events[0].end || stop.events[0].start; };
function dayHops(stops) {
  return stops.slice(1).map((to, i) => {
    const from = stops[i], first = to.events[0], ride = isRide(first);
    const saved = !ride && (trip.routes || {})[`${from.place.id}>${to.place.id}`];
    const a = [from.place.lat, from.place.lng], b = [to.place.lat, to.place.lng];
    return { from, to, ride, saved: !!saved, label: ride ? rideLabel(first) : '', pts: saved ? [a, ...decodeLine(saved.line), b] : ride ? arcLine(a, b) : [a, b] };
  });
}
// today the leg you are on, or about to start; on any other day no leg stands out
function autoHop(date) {
  if (date !== todayKey()) return null;
  const i = hops.findIndex((g) => new Date(arriveAt(g.to)) > now());
  return i < 0 ? null : i;
}
const hopFor = (placeId) => { let i = hops.findIndex((g) => g.to.place.id === placeId); if (i < 0) i = hops.findIndex((g) => g.from.place.id === placeId); return i < 0 ? null : i; };
const pinIcon = (p, tag) => L.divIcon({ className: '', html: `<div class="hit"><div class="pin ${p.stay ? 'stay' : ''}">${p.stay ? ico('bed') : p.n}</div>${tag ? `<span class="pintag">${esc(tag)}</span>` : ''}</div>`, iconSize: [44, 44], iconAnchor: [22, 22], popupAnchor: [0, -14] });
function drawHops() {
  hopLayer.clearLayers();
  hops.forEach((g, i) => {
    const on = i === hopFocus, dim = hopFocus !== null && !on, opacity = dim ? 0.3 : 1;
    // every line is solid on a white casing, so it reads over the map's own detail; colour says what it is:
    // orange a walk on its saved path, green a ride, thin grey a walk with no saved path (a straight hint)
    const color = g.ride ? '#157a52' : g.saved ? '#f2622e' : '#6b717d', w = g.ride || g.saved ? (on ? 5 : 3.5) : 2.5;
    const line = { lineCap: 'round', lineJoin: 'round', interactive: false };
    L.polyline(g.pts, { ...line, color: '#fff', weight: w + 3, opacity: dim ? 0.3 : 0.9 }).addTo(hopLayer);
    L.polyline(g.pts, { ...line, color, weight: w, opacity }).addTo(hopLayer);
    if (g.ride && g.label && on) L.marker(g.pts[g.pts.length >> 1], { icon: L.divIcon({ className: '', html: `<span class="hoplab">${esc(g.label)}</span>`, iconSize: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: -200 }).addTo(hopLayer);
  });
}
// frame the hop in focus, clear of the day strip, the name tags at its ends and the buttons at the bottom
function fitHop(top, animate) {
  if (hopFocus !== null) map.fitBounds(L.latLngBounds(hops[hopFocus].pts), { maxZoom: 17, paddingTopLeft: [100, top], paddingBottomRight: [100, 200], animate });
}
// focus one hop: it stays bold, its two ends say what and when, the rest of the day fades
function setHopFocus(i) {
  hopFocus = i == null || !hops[i] ? null : i;
  const g = hopFocus === null ? null : hops[hopFocus];
  for (const p of pinSet) {
    const tag = !g ? '' : g.to.place.id === p.id ? `${fmtTime(arriveAt(g.to), g.to.events[0].tz)} · ${p.name}` : g.from.place.id === p.id ? p.name : '';
    p.solo = !!tag;
    p.m.setIcon(pinIcon(p, tag));
    p.m.setZIndexOffset(tag ? 400 : 0);
  }
  drawHops();
  regroupPins();
}
function showMap(date, focus) {
  date = trip.days.some((d) => d.date === date) ? date : defaultDay(legDays().find((d) => d.stay)); // first day with a base, not a flight day
  mapDate = date;
  const wrap = $('#mapwrap');
  wrap.hidden = false;
  if (!map) {
    wrap.insertAdjacentHTML('afterbegin', '<div class="mapbar"></div>');
    wrap.insertAdjacentHTML('beforeend', `<div class="nearby"><div class="chips">${[['Konbini', 'convenience store'], ['ATM', '7-Eleven ATM'], ['Toilets', 'public toilet'], ['Station', 'train station'], ['Pharmacy', 'drugstore'], ['Cafe', 'cafe']].map(([l, q]) => `<a class="chip pill" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}">${ico('search')}${l}</a>`).join('')}</div></div><button class="fab" id="locate" aria-label="Show my location">${ico('locate')}</button>`);
    map = L.map('map', { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    hopLayer = L.layerGroup().addTo(map);
    pinLayer = L.layerGroup().addTo(map);
    grpLayer = L.layerGroup().addTo(map);
    map.on('zoomend', regroupPins);
    map.on('click', () => setHopFocus(autoHop(mapDate))); // a tap on the map itself lets go of a picked leg
    $('#locate').onclick = locate;
  }
  $('.mapbar').innerHTML = dayChips(date, (d) => '#/map/' + d) + `<p class="mapoff">${ico('offline')}No signal: the map background needs it. Pins and paths still show.</p>`;
  $('.mapbar').append(map.attributionControl.getContainer()); // the credit sits under the day strip, clear of the tab bar
  centerChip($('.mapbar'));
  hopLayer.clearLayers(); pinLayer.clearLayers(); grpLayer.clearLayers(); pinSet = [];
  const stops = dayStops(date);
  hops = dayHops(stops); hopFocus = null;
  const pts = [];
  const seen = new Map();
  stops.forEach((s, i) => {
    const p = s.place, ll = [p.lat, p.lng];
    pts.push(ll);
    const list = s.events.filter((e) => !e.group).slice(0, 4).map((e) => `${fmtTime(e.start, e.tz)} · ${esc(e.title)}`).join('<br>');
    const l = mapLinks(p);
    const pop = `<b>${esc(p.name)}</b><br>${list}<br><a class="btn ink" href="${l.google}" target="_blank" rel="noopener">Directions</a> <a class="btn" href="#/event/${s.events[0].id}">Details</a>`;
    if (seen.has(p.id)) { seen.get(p.id).pop += `<hr>${list}`; seen.get(p.id).m.setPopupContent(seen.get(p.id).pop); return; }
    const pin = { id: p.id, ll, n: i + 1, stay: p.kind === 'stay', name: p.name };
    // a tap picks the hop that arrives here and frames it, with room above the pin for its card
    const m = pin.m = L.marker(ll, { icon: pinIcon(pin) }).bindPopup(pop, { autoPan: false }).on('click', () => { setHopFocus(hopFor(p.id)); fitHop(260, !reduced()); }).addTo(pinLayer);
    seen.set(p.id, { m, pop });
    pinSet.push(pin);
  });
  setTimeout(() => {
    map.invalidateSize();
    const fp = focus && pinSet.find((p) => p.id === focus);
    const pick = fp ? hopFor(fp.id) : autoHop(date);
    if (fp) fp.solo = true; // it will stand alone once its leg is in focus
    if (!fp && pick !== null) {
      // today: frame the leg you are on, not the whole day
      hopFocus = pick; fitHop(140, false);
      setHopFocus(pick);
    } else if (fp) {
      map.setView(fp.ll, 16, { animate: false });
      setHopFocus(pick);
      fp.solo = true; regroupPins(); // also when the place has no leg (a one-stop day)
      fp.m.openPopup();
    } else if (pts.length) {
      // ignore far-away outliers (e.g. a flight's origin) when framing the day
      const lat = pts.map((p) => p[0]).sort((a, b) => a - b)[pts.length >> 1], lng = pts.map((p) => p[1]).sort((a, b) => a - b)[pts.length >> 1];
      const near = pts.filter((p) => Math.abs(p[0] - lat) < 1 && Math.abs(p[1] - lng) < 1.5);
      map.fitBounds(L.latLngBounds(near.length ? near : pts), { maxZoom: 16, paddingTopLeft: [24, 110], paddingBottomRight: [24, 150], animate: false });
      setHopFocus(null);
    }
  }, 80);
}
function locate() {
  if (!navigator.geolocation) return toast('Location not available');
  navigator.geolocation.getCurrentPosition((pos) => {
    const ll = [pos.coords.latitude, pos.coords.longitude];
    if (meMarker) meMarker.remove();
    meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="pin me"></div>', iconSize: [20, 20], iconAnchor: [10, 10] }), zIndexOffset: 1000 }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 15));
  }, () => toast('Could not get your location'), { enableHighAccuracy: true, timeout: 10000 });
}

// ---------- shell ----------
// scroll the day strip sideways so the selected day sits in the middle, without moving the page
function centerChip(root) {
  const on = root && $('.chips .chip.on', root);
  if (on) { const c = on.parentElement; c.scrollLeft = on.offsetLeft - (c.clientWidth - on.offsetWidth) / 2; }
}
let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 1800);
}
function header() {
  const many = (trip.legs || []).length > 1;
  document.title = head().title;
  $('#top').innerHTML = `<div class="bar">${many ? `<button class="trip" data-legmenu aria-haspopup="dialog">${esc(head().title)}${ico('chev')}</button>` : `<span class="trip">${esc(trip.title)}</span>`}${navigator.onLine ? '' : `<span class="offchip">${ico('offline')}Offline · saved copy</span>`}</div>
    ${simNow ? `<div class="sim"><span>Preview · ${fmtDate(now(), zone())}, ${fmtTime(now(), zone())}</span><span><button data-shift="-60" aria-label="One hour earlier">−1 h</button><button data-shift="60" aria-label="One hour later">+1 h</button><button data-sim="">Exit</button></span></div>` : ''}`;
  document.documentElement.style.setProperty('--top-real', $('#top').offsetHeight + 'px');
}
let lastTab = 'today', routes = 0, lastKey = null;
const setTabOn = (name) => document.querySelectorAll('#tabs a').forEach((el) => { const on = el.dataset.tab === name; el.classList.toggle('on', on); on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'); });
// the page scrolls inside #page (see app.css), so nothing here may use window scroll
// A phone refreshes its saved files one by one, so this script can briefly run on the older page without #page: fall back to the document.
const pageEl = () => $('#page') || document.scrollingElement;
const scrollTop = () => pageEl().scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
// a tap on a tab: the highlight moves now; the active tab scrolls to its top, or from a deeper screen goes to its root
function tabTap(ev, a) {
  const name = a.dataset.tab, root = '#/' + name;
  if (endClose) endClose(); // tapped while a booking flies home: end it now, no animation
  if (name === lastTab && $('#pass').hidden && $('#sheet').hidden) {
    ev.preventDefault();
    if (location.hash === root || (!location.hash && name === 'today')) return scrollTop();
    return void (location.hash = root);
  }
  setTabOn(name);
}
function route() {
  if (!trip) return; // still locked or loading
  const hash = location.hash || '#/today';
  const [, tab = 'today', a, b] = hash.split('/');
  routes++;
  closeLightbox(); closeDoc();
  if (!$('#pass').hidden) {
    const home = passCtx && passCtx.back === hash;
    closePass(home);
    if (home) return; // back to the stack it came from: the cards fly home, no re-render
  }
  closeSheet();
  if (tab === 'event' && byId[a]) return openSheet(eventSheet(byId[a]));
  if (tab === 'booking' && bookingById[a]) return openPass(a);
  lastTab = views[tab] || tab === 'map' ? tab : 'today';
  setTabOn(lastTab);
  const key = lastTab + '/' + (a || ''), fresh = key !== lastKey; // same screen re-rendered (refresh, plan, day view, sheet closed): keep the scroll
  lastKey = key;
  const isMap = lastTab === 'map';
  // the leg follows what is on screen: an opened day, or today while the trip is on
  if ((isMap || lastTab === 'days') && a) setLeg(legOf(a), true);
  else if (lastTab === 'today' && todayKey()) setLeg(legOf(todayKey()));
  $('#mapwrap').hidden = !isMap;
  $('#top').hidden = isMap;
  $('#view').hidden = isMap;
  if (isMap) return showMap(a, b);
  header();
  $('#view').innerHTML = views[lastTab](a);
  if (lastTab === 'more') offlineStatus();
  if (lastTab === 'days') fitStory();
  centerChip($('#view'));
  refocusSheetOrigin();
  if (fresh) pageEl().scrollTop = 0;
}
function setSim(v) {
  simNow = v || null;
  store.set('simNow', simNow);
  if (new URLSearchParams(location.search).has('now')) history.replaceState(null, '', location.pathname + location.hash);
  setLeg(pickLeg());
  route();
}
document.addEventListener('click', (ev) => {
  const t = ev.target;
  const tabA = t.closest('#tabs a');
  if (tabA) return tabTap(ev, tabA);
  if (t.closest('[data-gt]')) { // the link opens Google Translate by itself; the typed text is also copied in case it arrives empty
    const q = $('#pq').value.trim();
    if (q) navigator.clipboard?.writeText(q).then(() => toast('Text copied'), () => {});
    return;
  }
  if (t.closest('a[href], label, summary, input')) return; // native controls
  if (t.closest('[data-lbclose]')) return history.state?.lb ? history.back() : closeLightbox();
  const slide = t.closest('.lb-frame') && t.closest('.lb-slide');
  if (slide) return toggleCode(slide, ev);
  const step = t.closest('[data-lbstep]');
  if (step) { const tr = $('#lightbox .lb-track'); return tr.scrollBy({ left: step.dataset.lbstep * tr.clientWidth, behavior: reduced() ? 'auto' : 'smooth' }); }
  const lbo = t.closest('[data-lb]');
  if (lbo) { const [bid, i] = lbo.dataset.lb.split(':'); return openLightbox(bid, +i); }
  if (t.closest('[data-close]') || t.id === 'sheet') {
    if ((routes > 1 || passCtx?.pushed) && /^#\/(event|booking)\//.test(location.hash)) return history.back();
    if (!$('#pass').hidden) return location.replace('#/bookings'); // opened from a link, nothing to go back to
    return closeSheet();
  }
  if (t.closest('[data-docclose]')) return history.state?.doc ? history.back() : closeDoc();
  const doc = t.closest('[data-doc]');
  if (doc) { const [bid, i] = doc.dataset.doc.split(':'); return openDoc(bid, +i); }
  if (t.closest('[data-legmenu]')) return openSheet(legSheet());
  const lg = t.closest('[data-leg]');
  if (lg) {
    setLeg(trip.legs.find((l) => l.id === lg.dataset.leg), true);
    closeSheet();
    const h = '#/' + lastTab; // a day or map link names a date, which belongs to the other leg
    return lastTab !== 'today' && location.hash !== h ? (location.hash = h) : route();
  }
  if (t.closest('[data-offsave]')) return saveOffline();
  if (t.closest('[data-earlier]')) { earlierOpen = !earlierOpen; return route(); }
  const sim = t.closest('[data-sim]');
  if (sim) return setSim(sim.dataset.sim);
  const shift = t.closest('[data-shift]');
  if (shift) return setSim(new Date(now().getTime() + shift.dataset.shift * 60000).toISOString());
  const plan = t.closest('[data-plan]');
  if (plan) { const [id, opt] = plan.dataset.plan.split(':'); store.set('plans', { ...store.get('plans', {}), [id]: opt }); applyPlans(); return route(); }
  const dv = t.closest('[data-dayview]');
  if (dv) { store.set('dayView', dv.dataset.dayview); route(); return $('[data-dayview].on')?.focus({ preventScroll: true }); }
  const fxb = t.closest('[data-fx]');
  if (fxb) { $('#fx-local').value = fxb.dataset.fx; return convert('local'); }
  const sp = t.closest('[data-speak]');
  if (sp) return speak(sp.dataset.speak);
  const card = t.closest('[data-card]');
  if (card) return openSheet(cardSheet(card.dataset.card));
  const copy = t.closest('[data-copy]');
  if (copy) return navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Copied'), () => toast('Copy failed'));
  const ev1 = t.closest('[data-ev]');
  if (ev1) { if ($('#sheet').hidden && ev1.closest('#view')) sheetFrom = ev1; return (location.hash = '#/event/' + ev1.dataset.ev); }
  const bk = t.closest('[data-bk]');
  if (bk) return openBooking(bk.dataset.bk, bk);
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (!$('#doc').hidden) return $('[data-docclose]').click();
    if (!$('#lightbox').hidden) return $('[data-lbclose]').click();
    if (!$('#pass').hidden) return $('#pass [data-close]').click();
    if (!$('#sheet').hidden) return $('#sheet [data-close]')?.click();
  }
  if (!$('#lightbox').hidden && /^Arrow(Left|Right)$/.test(ev.key)) return $(`[data-lbstep="${ev.key === 'ArrowLeft' ? -1 : 1}"]`)?.click();
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('[role="button"][tabindex]')) { ev.preventDefault(); ev.target.click(); }
});
document.addEventListener('input', (ev) => {
  const t = ev.target;
  if (t.id === 'q') $('#results').innerHTML = search(t.value);
  else if (t.id === 'pq') filterPhrases(t.value);
  else if (t.id === 'fx-local') convert('local');
  else if (t.id === 'fx-home') convert('home');
});
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (!t.dataset.chk) return;
  const chk = store.get('chk', {}); chk[t.dataset.chk] = t.checked; store.set('chk', chk);
  const [list] = t.dataset.chk.split(':'), l = trip.checklists.find((x) => x.id === list);
  $('[data-count="' + list + '"]').textContent = l.items.filter((i) => chk[list + ':' + i.id]).length + ' / ' + l.items.length;
});
window.addEventListener('hashchange', route);
let fitT;
window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitStory, 150); });
document.fonts?.ready.then(fitStory);
// keep "now / next" fresh while the app is open
setInterval(() => { if (lastTab === 'today' && $('#sheet').hidden && $('#pass').hidden &&!/^#\/(event|booking)/.test(location.hash)) route(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wake === null && !$('#lightbox').hidden) keepAwake();
  if (!document.hidden && lastTab === 'today' && $('#sheet').hidden && $('#pass').hidden) route();
});

(async function boot() {
  try {
    trip = await loadTrip();
    savedPaths = trip.bookings.flatMap((b) => b.files.flatMap((f) => [f.path, ...(f.pages || [])])).map((p) => (trip.enc && trip.enc[p]) || p);
    // codes must show at once: unlock ticket pictures now, other documents when opened
    if (vault) await Promise.all(trip.bookings.flatMap((b) => b.files.filter((f) => f.image).map(async (f) => { try { f.path = await urlOf(f.path); } catch { /* shown as missing */ } })));
  } catch (err) {
    $('#view').innerHTML = `<div class="stock empty">Could not load the trip data. Check your connection and reopen the app.<br><span class="small muted">${esc(err.message)}</span></div>`;
    return;
  }
  trip.allEvents = trip.events;
  for (const e of trip.allEvents) byId[e.id] = e;
  applyPlans();
  leg = pickLeg();
  loadWeather();
  loadRate();
  for (const b of trip.bookings) bookingById[b.id] = b;
  document.documentElement.classList.toggle('offline', !navigator.onLine);
  route();
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // first install finishes saving in the background; refresh the status card when it takes control
    navigator.serviceWorker.addEventListener('controllerchange', () => offlineStatus());
  }
})();
