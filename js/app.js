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
  return zonedToDate(simNow, trip.tz);
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
function rowsHtml(items, evs, n) {
  return items.map((e) => {
    if (!e.group) return evRow(e, stateOf(e, n));
    const kids = evs.filter((k) => k.parent === e.id);
    return `<li class="grp">${evRow(e, stateOf(e, n) === 'past' ? 'past' : '', { tag: 'div' })}<ul class="tl">${kids.map((k) => evRow(k, stateOf(k, n))).join('')}</ul></li>`;
  }).join('');
}
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
    if (done.length) html += `<details class="earlier"><summary><span>Earlier today · ${stops(done, evs)} done</span>${ico('chev')}</summary><div class="stock"><ul class="tl">${rowsHtml(done, evs, n)}</ul></div></details>`;
    if (!top.length) return html + `<div class="stock empty">Nothing else planned today.</div>`;
  }
  for (const [name, a, b] of PARTS) {
    const items = top.filter((e) => { const h = hourOf(e.start, e.tz); return h >= a && h < b; });
    if (!items.length) continue;
    const c = stops(items, evs);
    html += `<section><h2 class="guide">${name}<span>${c} ${c === 1 ? 'stop' : 'stops'}</span></h2><div class="stock"><ul class="tl">${rowsHtml(items, evs, n)}</ul></div></section>`;
  }
  return html;
}
function dayChips(sel, hrefFor) {
  const tk = todayKey();
  return `<div class="chips" role="list">${trip.days.map((d) => `<a role="listitem" class="chip ${d.date === sel ? 'on' : ''} ${d.date === tk ? 'today' : ''}" href="${hrefFor(d.date)}" data-date="${d.date}" ${d.date === sel ? 'aria-current="date"' : ''}>
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
function dayHead(date) {
  const day = trip.days.find((d) => d.date === date);
  return `<header class="dh"><div><h1>${dayLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}</h1><div class="dt">${esc(day.title)}</div><p>Day ${trip.days.indexOf(day) + 1} of ${trip.days.length} · ${esc(day.base)}</p></div>${wxBadge(date)}</header>`;
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
  return `<div class="wp-band">${ico(BK_ICON[b.type] || 'doc')}<div class="bt"><b>${esc(b.title)}</b><span>${esc(BK_LABEL[b.type] || b.type)}${b.provider ? ' · ' + esc(b.provider) : ''}</span></div>
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
    const first = new Date(trip.events[0].start), last = new Date(trip.events[trip.events.length - 1].end);
    if (!tk || n < first - 864e5 || n > last) {
      const before = n < first;
      const e0 = trip.events[0];
      return `<header class="dh"><p>${esc(trip.subtitle || '')}</p></header>
        ${before ? `<article class="tag next" data-ev="${e0.id}" role="button" tabindex="0"><span class="eyelet"></span>
          <div class="count">${countParts(first - n)}</div>
          <h2 class="tag-t">${esc(e0.title)}</h2>
          <p class="tag-m">Trip starts ${fmtDate(e0.start, e0.tz, { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtTime(e0.start, e0.tz)}</p>
          <div class="perf"></div>
          <div class="acts"><a class="btn ink" href="#/days/${e0.date}">See day 1</a><a class="btn ghost" href="#/bookings">${ico('ticket')}Bookings</a></div></article>`
        : `<article class="tag next"><span class="eyelet"></span><h2 class="tag-t" style="font-size:30px">Welcome home.</h2><p class="tag-m">${esc(trip.title)} is over. Everything stays here to look back on.</p></article>`}
        <h2 class="sec">Rehearse a day</h2>
        <div class="stock pad"><p class="small muted">See what Today will show at 10 AM on any trip day.</p>
        <div class="btns">${trip.days.map((d) => `<button class="btn sm" data-sim="${d.date}T10:00">${dayLabel(d.date, { day: 'numeric', month: 'short' })}</button>`).join('')}</div></div>
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
      if (musts.length) h += `<div class="stock"><ul class="tl">${musts.map((e) => evRow(e, stateOf(e, n))).join('')}</ul></div>`;
      h += alerts.map(({ e, a }) => alertBox(e, a)).join('');
    }
    h += timeline(tk, { foldPast: true });
    h += stayCard(day);
    return h;
  },

  days(date) {
    date = trip.days.some((d) => d.date === date) ? date : (todayKey() || store.get('day') || trip.days.find((d) => d.date >= trip.startDate).date);
    store.set('day', date);
    const day = trip.days.find((d) => d.date === date);
    const i = trip.days.indexOf(day);
    const evs = trip.events.filter((e) => e.date === date);
    const warn = evs.flatMap((e) => e.alerts.filter((a) => a.level === 'critical').map((a) => ({ e, a })));
    return `${dayChips(date, (d) => '#/days/' + d)}
      ${dayHead(date)}
      ${planSwitch(date)}
      <div class="btns" style="margin:0 0 6px"><a class="btn" href="#/map/${date}">${ico('map')}Map of this day</a></div>
      ${warn.map(({ e, a }) => alertBox(e, a)).join('')}
      ${timeline(date) || '<div class="stock empty">Nothing planned this day.</div>'}
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
    return `<header class="dh"><div><h1>Bookings</h1><p>${trip.bookings.length} reservations · tap one to show its code</p></div></header>
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
    if (lastTab === 'more') { const el = $('#wxstrip'); if (el) el.innerHTML = wxStrip(); } else if (lastTab !== 'map' && $('#sheet').hidden) route();
  } catch { /* offline: keep cached or typical values */ }
}
const wxStrip = () => trip.days.map((d) => {
  const i = wxInfo(d.date);
  if (!i) return '';
  return `<div class="wxrow ${i.live ? '' : 'typ'}"><b>${dayLabel(d.date, { weekday: 'short', day: 'numeric' })}</b>${ico('w-' + i.icon)}<span class="w">${esc(i.loc.label)} · ${i.live ? esc(i.word) + (i.extra ? ', ' + esc(i.extra) : '') : 'typical'}</span><span class="t">${temp(i.hi)} / ${temp(i.lo)}</span></div>`;
}).join('');

// ---------- currency converter ----------
let fx = null;
const rate = () => (fx && fx.rate) || trip.currency.rate;
async function loadRate() {
  fx = store.get('fx');
  if (fx && Date.now() - fx.at < 12 * 3600e3) return;
  try {
    const j = await (await fetch(`https://api.frankfurter.dev/v1/latest?base=${trip.currency.home}&symbols=${trip.currency.local}`)).json();
    const r = j.rates && j.rates[trip.currency.local];
    if (r) { fx = { rate: r, at: Date.now(), date: j.date }; store.set('fx', fx); if (lastTab === 'more') { const n = $('#fxnote'); if (n) n.textContent = fxNote(); convert('local'); } }
  } catch { /* offline: planning rate */ }
}
const fxNote = () => `${trip.currency.homeSymbol}1 = ${trip.currency.localSymbol}${rate().toFixed(1)} · ${fx && fx.date ? 'market rate from ' + fx.date : 'planning rate (offline)'}`;
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
  const bk = trip.bookings.filter((b) => JSON.stringify([b.title, b.provider, b.confirmation, b.notes, b.location]).toLowerCase().includes(q));
  if (!ev.length && !bk.length) return `<div class="stock empty">Nothing matches “${esc(q)}”. Try a place, a day or a booking code.</div>`;
  return (bk.length ? `<div class="wallet" style="margin-top:12px">${bk.map(walletPass).join('')}</div>` : '')
    + (ev.length ? `<div class="stock"><ul class="tl">${ev.map((e) => evRow(e, '', { date: true })).join('')}</ul></div>` : '');
}

views.more = function () {
  const chk = store.get('chk', {});
  const c = trip.currency;
  const stays = [...new Set(trip.days.map((d) => d.stay).filter(Boolean))].map((id) => trip.places[id]);
  return `<div class="searchbox">${ico('search')}<input id="q" class="field" type="search" placeholder="Search places, days, booking codes" autocomplete="off" aria-label="Search the whole trip"></div><div id="results"></div>
    ${(trip.plans || []).length ? '<h2 class="sec">Plan switches</h2>' + planSwitch() : ''}
    <h2 class="sec">Offline</h2>
    <div class="stock pad offcard" id="offline"><p class="small muted">Checking what is saved on this phone…</p></div>
    <h2 class="sec">Currency</h2>
    <div class="stock pad"><div class="fx"><label>${esc(c.localSymbol)} ${esc(c.local)}<input id="fx-local" class="field" inputmode="decimal" placeholder="0"></label><span>=</span><label>${esc(c.homeSymbol)} ${esc(c.home)}<input id="fx-home" class="field" inputmode="decimal" placeholder="0"></label></div>
      <div class="fxq">${[500, 1000, 3000, 5000, 10000].map((v) => `<button class="btn sm" data-fx="${v}">${esc(c.localSymbol)}${v.toLocaleString('en-US')}</button>`).join('')}</div>
      <p class="note" id="fxnote">${fxNote()}</p></div>
    ${trip.weather ? `<h2 class="sec">Weather</h2><div class="stock" id="wxstrip">${wxStrip()}</div>` : ''}
    <h2 class="sec">Checklists</h2>
    ${trip.checklists.map((l) => { const done = l.items.filter((i) => chk[l.id + ':' + i.id]).length; return `<details class="stock list"><summary><span>${esc(l.title)}</span><span class="cnt" data-count="${l.id}">${done} / ${l.items.length}</span></summary>
      ${l.items.map((i) => `<label class="chk"><input type="checkbox" data-chk="${l.id}:${i.id}" ${chk[l.id + ':' + i.id] ? 'checked' : ''}><span>${esc(i.text)}</span></label>`).join('')}</details>`; }).join('')}
    <h2 class="sec">Show to staff <span class="muted">tap for full screen</span></h2>
    ${stays.map((p) => `<div class="stock staff" data-card="stay:${p.id}" role="button" tabindex="0"><div class="small">Take me to ${esc(p.name)}</div><div class="jpline jp" lang="ja">${esc(p.local || p.address || p.name)}</div></div>`).join('')}
    ${trip.cards.map((k) => `<div class="stock staff" data-card="${k.id}" role="button" tabindex="0"><div class="small">${esc(k.en)}</div><div class="jpline jp" lang="ja">${esc(k.local)}</div></div>`).join('')}
    <h2 class="sec">Emergency</h2>
    <div class="stock">${trip.emergency.map((e) => `<div class="em"><div><div class="t">${esc(e.label)}</div><div class="small muted">${esc(e.note || '')}</div></div><a class="btn ink" href="tel:${esc(e.phone.replace(/[^+\d]/g, ''))}">${ico('phone')}${esc(e.phone)}</a></div>`).join('')}</div>
    <p class="note" style="margin:14px 4px">Checklists and plan switches are saved on this phone only.</p>`;
};

// ---------- offline: what is saved on this phone ----------
const DATA_CACHE = 'trip-data'; // must match sw.js
let savedPaths = []; // every document file as the service worker stores it (set at boot)
const tripFiles = () => ({
  docs: savedPaths,
  photos: Object.values(trip.places).map((p) => p.photo && p.photo.src).filter(Boolean),
});
let saving = false;
async function offlineStatus() {
  const el = $('#offline');
  if (!el) return;
  if (!('serviceWorker' in navigator) || !window.caches || !isSecureContext) {
    el.innerHTML = `<div class="offrow warn">${ico('alert')}<div><b>Can't save for offline here</b><span>Open the app from its https address (or add it to the home screen) to keep a copy on this phone.</span></div></div>`;
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
    ? `The plan, ${trip.bookings.length} bookings, ${docs.length} tickets and documents, and ${photos.length} photos are on this phone. Weather, exchange rate and map backgrounds need signal.`
    : `${haveDocs} of ${docs.length} tickets and documents · ${havePhotos} of ${photos.length} photos. ${navigator.onLine ? 'Tap Save now, then keep the app open for a moment.' : 'Connect to save the rest.'}`;
  el.innerHTML = `<div class="offrow ${ready ? 'ok' : 'warn'}">${ico(ready ? 'task' : 'alert')}<div><b>${head}</b><span>${sub}</span></div></div>
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
  let en, local;
  if (id.startsWith('stay:')) { const p = trip.places[id.slice(5)]; en = 'Please take me to this address · ' + p.name; local = 'ここへ行ってください。\n' + (p.local || p.address || p.name); }
  else { const k = trip.cards.find((c) => c.id === id); en = k.en; local = k.local; }
  return `<div class="bigcard"><div class="big jp" lang="ja">${esc(local).replace(/\n/g, '<br>')}</div><div class="en">${esc(en)}</div></div>`;
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
  const ph = p && p.photo && !/^(task|transit|flight)$/.test(e.type) ? p.photo : null; // a photo of where you'll be, not of where a task happens
  return `<article class="ps k-${evKind(e)}">
    <div class="ps-band">${ico(EV_ICON[e.type] || 'sight')}<span>${fmtDate(e.start, e.tz, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>
    ${ph ? `<figure class="hero"><img src="${esc(ph.src)}" alt="${esc(p.name)}" loading="lazy"><figcaption>${esc(ph.credit || '')}${ph.license ? ' · ' + esc(ph.license) : ''}</figcaption></figure>` : ''}
    <div class="ps-in">
      <h2>${esc(e.title)}</h2>
      ${e.critical || e.optional ? `<div class="chipline">${badges(e)}</div>` : ''}
      ${facts(e)}
      ${e.alerts.map((a) => `<div class="alert ${a.level}">${ico('alert')}<div>${a.html}</div></div>`).join('')}
      ${p || b ? `<div class="btns">${p ? `<a class="btn ink" href="${mapLinks(p).google}" target="_blank" rel="noopener">${ico('arrow')}Directions</a>` : ''}${b ? `<a class="btn ${p ? '' : 'ink'}" href="#/booking/${b.id}">${ico('ticket')}Booking</a>` : ''}</div>` : ''}
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
function closePass(animate = true) {
  const pass = $('#pass');
  if (pass.hidden) return;
  const ctx = passCtx; passCtx = null;
  const hide = () => { pass.hidden = true; pass.innerHTML = ''; pass.className = ''; };
  const refocus = () => { const f = (ctx?.sel && $('.wp', ctx.sel)) || ctx?.focus; if (f && f.isConnected && f.focus) f.focus({ preventScroll: true }); };
  const settle = () => { if (!ctx?.sel) return; ctx.anims.forEach((a) => a.cancel()); ctx.sel.style.visibility = ''; };
  const finish = () => { settle(); hide(); closing = false; shell(false); refocus(); };
  const later = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]); // never stuck if the page stops painting
  if (!animate || reduced() || !ctx?.lift || !ctx.sel.isConnected) {
    if (!animate || reduced() || !ctx?.lift) settle();
    if (!animate || reduced()) return finish();
    closing = true;
    later(pass.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(40px)' }], { duration: 200, easing: 'ease-in', fill: 'forwards' }).finished, 400).then(finish);
    return;
  }
  closing = true;
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
      body.innerHTML = urls.map((u, n) => `<img src="${u}" alt="${esc(f.label)}, page ${n + 1} of ${urls.length}">`).join('') + `<p class="note">${urls.length} page${urls.length === 1 ? '' : 's'} · pinch to zoom</p>`;
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
function closeDoc() {
  const el = $('#doc');
  if (el.hidden) return;
  el.hidden = true; el.innerHTML = '';
  $('#pass').inert = false;
  if ($('#pass').hidden) shell(false);
}
window.addEventListener('popstate', (ev) => { if (!ev.state?.doc) closeDoc(); });

// ---------- map ----------
let map, layer, meMarker, mapDate;
function dayStops(date) {
  const stops = [];
  for (const e of trip.events.filter((x) => x.date === date && x.place)) {
    const last = stops[stops.length - 1];
    if (last && last.place.id === e.place) last.events.push(e);
    else stops.push({ place: trip.places[e.place], events: [e] });
  }
  return stops;
}
function showMap(date, focus) {
  date = trip.days.some((d) => d.date === date) ? date : (todayKey() || store.get('day') || trip.days[2]?.date || trip.days[0].date);
  mapDate = date;
  const wrap = $('#mapwrap');
  wrap.hidden = false;
  if (!map) {
    wrap.insertAdjacentHTML('afterbegin', '<div class="mapbar"></div>');
    wrap.insertAdjacentHTML('beforeend', `<div class="nearby"><div class="chips">${[['Konbini', 'convenience store'], ['ATM', '7-Eleven ATM'], ['Toilets', 'public toilet'], ['Station', 'train station'], ['Pharmacy', 'drugstore'], ['Cafe', 'cafe']].map(([l, q]) => `<a class="chip pill" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}">${ico('search')}${l}</a>`).join('')}</div></div><button class="fab" id="locate" aria-label="Show my location">${ico('locate')}</button>`);
    map = L.map('map', { zoomControl: false, attributionControl: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    $('#locate').onclick = locate;
  }
  $('.mapbar').innerHTML = dayChips(date, (d) => '#/map/' + d) + `<p class="mapoff">${ico('offline')}No signal: the map background needs it, pins and stop list still work.</p>`;
  centerChip($('.mapbar'));
  layer.clearLayers();
  const stops = dayStops(date);
  const pts = [];
  const seen = new Map();
  stops.forEach((s, i) => {
    const p = s.place, ll = [p.lat, p.lng];
    pts.push(ll);
    const list = s.events.filter((e) => !e.group).slice(0, 4).map((e) => `${fmtTime(e.start, e.tz)} · ${esc(e.title)}`).join('<br>');
    const l = mapLinks(p);
    const pop = `<b>${esc(p.name)}</b><br>${list}<br><a class="btn ink" href="${l.google}" target="_blank" rel="noopener">Directions</a> <a class="btn" href="#/event/${s.events[0].id}">Details</a>`;
    if (seen.has(p.id)) { seen.get(p.id).pop += `<hr>${list}`; seen.get(p.id).m.setPopupContent(seen.get(p.id).pop); return; }
    const m = L.marker(ll, { icon: L.divIcon({ className: '', html: `<div class="pin ${p.kind === 'stay' ? 'stay' : ''}">${p.kind === 'stay' ? ico('bed') : i + 1}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindPopup(pop).addTo(layer);
    seen.set(p.id, { m, pop });
    if (focus === p.id) setTimeout(() => { map.setView(ll, 16); m.openPopup(); }, 50);
  });
  if (pts.length > 1) L.polyline(pts, { color: '#f2622e', weight: 4, opacity: 0.8, dashArray: '2 8', lineCap: 'round' }).addTo(layer);
  setTimeout(() => {
    map.invalidateSize();
    if (!focus && pts.length) {
      // ignore far-away outliers (e.g. a flight's origin) when framing the day
      const lat = pts.map((p) => p[0]).sort((a, b) => a - b)[pts.length >> 1], lng = pts.map((p) => p[1]).sort((a, b) => a - b)[pts.length >> 1];
      const near = pts.filter((p) => Math.abs(p[0] - lat) < 1 && Math.abs(p[1] - lng) < 1.5);
      map.fitBounds(L.latLngBounds(near.length ? near : pts), { maxZoom: 16, paddingTopLeft: [24, 110], paddingBottomRight: [24, 150], animate: false });
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
  $('#top').innerHTML = `<div class="bar"><span class="trip">${esc(trip.title)}</span>${navigator.onLine ? '' : `<span class="offchip">${ico('offline')}Offline · saved copy</span>`}</div>
    ${simNow ? `<div class="sim"><span>Preview · ${fmtDate(now(), trip.tz)}, ${fmtTime(now(), trip.tz)}</span><span><button data-shift="-60" aria-label="One hour earlier">−1 h</button><button data-shift="60" aria-label="One hour later">+1 h</button><button data-sim="">Exit</button></span></div>` : ''}`;
  document.documentElement.style.setProperty('--top-real', $('#top').offsetHeight + 'px');
}
let lastTab = 'today', routes = 0;
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
  document.querySelectorAll('#tabs a').forEach((el) => { const on = el.dataset.tab === lastTab; el.classList.toggle('on', on); on ? el.setAttribute('aria-current', 'page') : el.removeAttribute('aria-current'); });
  const isMap = lastTab === 'map';
  $('#mapwrap').hidden = !isMap;
  $('#top').hidden = isMap;
  $('#view').hidden = isMap;
  if (isMap) return showMap(a, b);
  header();
  $('#view').innerHTML = views[lastTab](a);
  if (lastTab === 'more') offlineStatus();
  centerChip($('#view'));
  refocusSheetOrigin();
  if (lastTab !== 'today') window.scrollTo(0, 0);
}
function setSim(v) {
  simNow = v || null;
  store.set('simNow', simNow);
  if (new URLSearchParams(location.search).has('now')) history.replaceState(null, '', location.pathname + location.hash);
  route();
}
document.addEventListener('click', (ev) => {
  const t = ev.target;
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
  if (t.closest('[data-offsave]')) return saveOffline();
  const sim = t.closest('[data-sim]');
  if (sim) return setSim(sim.dataset.sim);
  const shift = t.closest('[data-shift]');
  if (shift) return setSim(new Date(now().getTime() + shift.dataset.shift * 60000).toISOString());
  const plan = t.closest('[data-plan]');
  if (plan) { const [id, opt] = plan.dataset.plan.split(':'); store.set('plans', { ...store.get('plans', {}), [id]: opt }); applyPlans(); return route(); }
  const fxb = t.closest('[data-fx]');
  if (fxb) { $('#fx-local').value = fxb.dataset.fx; return convert('local'); }
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
  loadWeather();
  loadRate();
  for (const b of trip.bookings) bookingById[b.id] = b;
  document.title = trip.title;
  document.documentElement.classList.toggle('offline', !navigator.onLine);
  route();
  if ('serviceWorker' in navigator && isSecureContext) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // first install finishes saving in the background; refresh the status card when it takes control
    navigator.serviceWorker.addEventListener('controllerchange', () => offlineStatus());
  }
})();
