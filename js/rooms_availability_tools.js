// rooms_availability_tools.js — fast-fill and coherence tools for the
// per-room capacity calendar (room_capacity_calendar), complementing the
// existing Room Calendar grid (cell/row editing).
//
// 1) FAST FILL: all rooms / by category × a date range (year in one click)
//    × status + beds (fixed number or each room's beds_per_room default).
// 2) COHERENCE: compares, day by day, the hotel-level availability_calendar
//    against the per-room calendar (sum of open rooms' beds, count of open
//    rooms) and reports grouped discrepancies.

const RcalTools = (() => {

  let injected = false;
  let roomsCache = [];

  function el(id) { return document.getElementById(id); }
  const esc = (s) => escapeHtml(String(s ?? ''));

  // ── UI injection ───────────────────────────────────────────────────────
  function ensure() {
    if (injected) { refreshRooms(); return; }
    const host = document.getElementById('subpage-rooms-calendar');
    if (!host) return;
    const anchor = host.firstElementChild; // controls row
    const panel = document.createElement('div');
    panel.id = 'rcal-tools';
    panel.innerHTML = `
      <style>
        #rcal-tools { border:1px solid var(--border,#e4e9f2); border-left:4px solid var(--brand,#3D65A8);
          border-radius:10px; padding:0.85rem 1rem; margin-bottom:0.9rem; background:#fafcff; }
        .rt-row { display:flex; gap:0.7rem; align-items:center; flex-wrap:wrap; margin-top:0.5rem; }
        .rt-label { font-size:0.78rem; color:var(--text-muted); font-weight:600; min-width:64px; }
        .rt-chip { display:inline-block; font-size:0.74rem; padding:0.18rem 0.6rem; border-radius:999px;
          border:1px solid var(--border,#e4e9f2); cursor:pointer; user-select:none; }
        .rt-chip.on { background:var(--brand,#3D65A8); color:#fff; border-color:var(--brand,#3D65A8); }
        .rt-input { font-size:0.82rem; padding:0.3rem 0.5rem; border:1px solid var(--border,#ccc); border-radius:5px; }
        #rt-coh-results { margin-top:0.6rem; font-size:0.8rem; }
        .rt-issue { padding:0.3rem 0.5rem; border-radius:6px; background:#fef3c7; color:#92400e; margin-top:0.3rem; }
        .rt-ok { padding:0.3rem 0.5rem; border-radius:6px; background:#d1fae5; color:#065f46; margin-top:0.3rem; }
      </style>
      <div style="display:flex;align-items:baseline;gap:0.6rem;flex-wrap:wrap">
        <strong style="font-size:0.9rem">Fast fill</strong>
        <span style="font-size:0.78rem;color:var(--text-muted)">apply status &amp; beds to many rooms over a long range in one go</span>
      </div>
      <div class="rt-row">
        <span class="rt-label">Rooms</span>
        <span class="rt-chip on" id="rt-scope-all" onclick="RcalTools.scopeAll()">All rooms</span>
        <span id="rt-cat-chips" style="display:flex;gap:0.3rem;flex-wrap:wrap"></span>
        <span id="rt-scope-count" style="font-size:0.75rem;color:var(--text-muted)"></span>
      </div>
      <div class="rt-row">
        <span class="rt-label">Range</span>
        <input type="date" class="rt-input" id="rt-from">
        <span style="color:var(--text-muted)">→</span>
        <input type="date" class="rt-input" id="rt-to">
        <button class="btn btn-secondary btn-sm" onclick="RcalTools.quickRange('year')">This year</button>
        <button class="btn btn-secondary btn-sm" onclick="RcalTools.quickRange('rest')">Rest of year</button>
        <button class="btn btn-secondary btn-sm" onclick="RcalTools.quickRange('next')">Next year</button>
      </div>
      <div class="rt-row">
        <span class="rt-label">Set</span>
        <div class="toggle-wrap">
          <button class="toggle-btn active" id="rt-status-open" onclick="RcalTools.setStatus('open')">Open</button>
          <button class="toggle-btn" id="rt-status-closed" onclick="RcalTools.setStatus('closed')">Closed</button>
        </div>
        <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.8rem">
          <input type="checkbox" id="rt-beds-default" checked onchange="RcalTools.toggleBedsInput()">
          each room's default beds
        </label>
        <input type="number" class="rt-input" id="rt-beds" min="0" max="999" style="width:80px;display:none" placeholder="beds">
        <button class="btn btn-primary btn-sm" id="rt-apply" onclick="RcalTools.apply()">Fill →</button>
        <span id="rt-progress" style="font-size:0.78rem;color:var(--text-muted)"></span>
      </div>
      <hr style="border:none;border-top:1px solid var(--border,#e4e9f2);margin:0.8rem 0 0.2rem">
      <div class="rt-row">
        <strong style="font-size:0.9rem">Coherence check</strong>
        <span style="font-size:0.78rem;color:var(--text-muted)">hotel calendar (Availability) vs sum of rooms, day by day, over the range above</span>
        <button class="btn btn-secondary btn-sm" onclick="RcalTools.checkCoherence()">Run check</button>
        <span style="font-size:0.75rem;color:var(--text-muted)">(to fill the hotel calendar from these rooms, use the Availability page)</span>
      </div>
      <div id="rt-coh-results"></div>`;
    host.insertBefore(panel, anchor);
    injected = true;
    quickRange('year');
    refreshRooms();
  }

  let scope = { mode: 'all', cats: new Set() };
  let fillStatus = 'open';

  async function refreshRooms() {
    const propertyId = el('rcal-property')?.value;
    if (!propertyId) return;
    const { data } = await Rooms.getByProperty(currentCompany.id, propertyId);
    roomsCache = (data || []).filter(r => r.status === 'active');
    // category chips
    const cats = new Map();
    roomsCache.forEach(r => {
      const c = r.room_categories;
      const label = c ? (c.display_name || c.raw_value) : '(no category)';
      const key = r.category_id || 'none';
      if (!cats.has(key)) cats.set(key, { label, n: 0 });
      cats.get(key).n++;
    });
    el('rt-cat-chips').innerHTML = [...cats.entries()].map(([key, c]) =>
      `<span class="rt-chip ${scope.mode === 'cats' && scope.cats.has(key) ? 'on' : ''}"
        onclick="RcalTools.toggleCat('${esc(key)}')">${esc(c.label)} (${c.n})</span>`).join('');
    updateScopeCount();
  }

  function selectedRooms() {
    if (scope.mode === 'all') return roomsCache;
    return roomsCache.filter(r => scope.cats.has(r.category_id || 'none'));
  }

  function updateScopeCount() {
    const n = selectedRooms().length;
    el('rt-scope-count').textContent = `→ ${n} room${n === 1 ? '' : 's'}`;
    el('rt-scope-all').classList.toggle('on', scope.mode === 'all');
  }

  function scopeAll() { scope = { mode: 'all', cats: new Set() }; refreshRooms(); }
  function toggleCat(key) {
    if (scope.mode !== 'cats') { scope = { mode: 'cats', cats: new Set() }; }
    scope.cats.has(key) ? scope.cats.delete(key) : scope.cats.add(key);
    if (!scope.cats.size) scope.mode = 'all';
    refreshRooms();
  }

  function setStatus(s) {
    fillStatus = s;
    el('rt-status-open').classList.toggle('active', s === 'open');
    el('rt-status-closed').classList.toggle('active', s === 'closed');
  }

  function toggleBedsInput() {
    el('rt-beds').style.display = el('rt-beds-default').checked ? 'none' : '';
  }

  function quickRange(kind) {
    const now = new Date();
    const y = now.getFullYear();
    const iso = (d) => d.toISOString().slice(0, 10);
    if (kind === 'year') { el('rt-from').value = `${y}-01-01`; el('rt-to').value = `${y}-12-31`; }
    if (kind === 'rest') { el('rt-from').value = iso(now); el('rt-to').value = `${y}-12-31`; }
    if (kind === 'next') { el('rt-from').value = `${y + 1}-01-01`; el('rt-to').value = `${y + 1}-12-31`; }
  }

  function datesBetween(fromStr, toStr) {
    const out = [];
    let d = new Date(fromStr + 'T00:00:00Z');
    const end = new Date(toStr + 'T00:00:00Z');
    while (d <= end) { out.push(d.toISOString().slice(0, 10)); d = new Date(d.getTime() + 86400000); }
    return out;
  }

  // ── fast fill ──────────────────────────────────────────────────────────
  async function apply() {
    const propertyId = el('rcal-property')?.value;
    const rooms = selectedRooms();
    const from = el('rt-from').value, to = el('rt-to').value;
    if (!propertyId || !rooms.length || !from || !to || from > to) {
      Toast.error('Pick rooms and a valid date range first.'); return;
    }
    const useDefault = el('rt-beds-default').checked;
    const fixedBeds = parseInt(el('rt-beds').value);
    if (!useDefault && (isNaN(fixedBeds) || fixedBeds < 0)) { Toast.error('Set the beds number.'); return; }

    const dates = datesBetween(from, to);
    const total = rooms.length * dates.length;
    if (!confirm(`Fill ${rooms.length} room(s) × ${dates.length} day(s) = ${total.toLocaleString()} rows\n` +
      `status=${fillStatus}, beds=${useDefault ? 'each room default' : fixedBeds}?\n\nExisting days in the range are overwritten.`)) return;

    const now = new Date().toISOString();
    const btn = el('rt-apply'); btn.disabled = true;
    const rows = [];
    for (const r of rooms) {
      const beds = fillStatus === 'closed' ? 0 : (useDefault ? (r.beds_per_room || 1) : fixedBeds);
      for (const d of dates) {
        rows.push({ company_id: currentCompany.id, property_uuid: propertyId, property_id: propertyId,
          room_id: r.id, date: d, beds_available: beds, status: fillStatus, updated_at: now });
      }
    }
    let done = 0, failed = null;
    for (let i = 0; i < rows.length; i += 500) {
      el('rt-progress').textContent = `writing ${Math.min(i + 500, rows.length).toLocaleString()}/${rows.length.toLocaleString()}…`;
      let { error } = await sb.from('room_capacity_calendar')
        .upsert(rows.slice(i, i + 500), { onConflict: 'company_id,property_uuid,room_id,date' });
      if (error) {
        // transient failures (pooler hiccups on long fills): wait and retry once
        await new Promise(r => setTimeout(r, 1200));
        ({ error } = await sb.from('room_capacity_calendar')
          .upsert(rows.slice(i, i + 500), { onConflict: 'company_id,property_uuid,room_id,date' }));
      }
      if (error) { failed = error; break; }
      done = Math.min(i + 500, rows.length);
    }
    btn.disabled = false;
    el('rt-progress').textContent = '';
    if (failed) { alert(`⚠ FILL INCOMPLETE — wrote ${done.toLocaleString()} of ${rows.length.toLocaleString()} rows, then failed: ${failed.message}\n\nRe-run the same Fill (it is idempotent) to complete the range.`); }
    else { Toast.success(`${rows.length.toLocaleString()} room-days filled.`); }
    if (typeof rcalLoad === 'function') rcalLoad();
  }

  // ── coherence check ────────────────────────────────────────────────────
  async function fetchAllRoomDays(propertyId, from, to) {
    const PAGE = 1000; let fromIdx = 0; let all = [];
    for (;;) {
      const { data, error } = await sb.from('room_capacity_calendar')
        .select('date,beds_available,status')
        .eq('company_id', currentCompany.id).eq('property_uuid', propertyId)
        .gte('date', from).lte('date', to)
        .range(fromIdx, fromIdx + PAGE - 1);
      if (error) throw error;
      all = all.concat(data || []);
      if (!data || data.length < PAGE) break;
      fromIdx += PAGE;
    }
    return all;
  }

  async function checkCoherence() {
    const propertyId = el('rcal-property')?.value;
    const from = el('rt-from').value, to = el('rt-to').value;
    const out = el('rt-coh-results');
    if (!propertyId || !from || !to) { Toast.error('Pick a range first.'); return; }
    out.innerHTML = '<span style="color:var(--text-muted)">Checking…</span>';
    try {
      const [hotelRes, roomDays] = await Promise.all([
        sb.from('availability_calendar')
          .select('date,status,number_of_rooms,number_of_beds')
          .eq('company_id', currentCompany.id).eq('property_uuid', propertyId)
          .gte('date', from).lte('date', to).order('date'),
        fetchAllRoomDays(propertyId, from, to),
      ]);
      if (hotelRes.error) throw hotelRes.error;
      const hotel = {};
      (hotelRes.data || []).forEach(h => { hotel[h.date] = h; });
      const agg = {};
      roomDays.forEach(r => {
        const a = (agg[r.date] = agg[r.date] || { rooms: 0, beds: 0 });
        if (r.status === 'open') { a.rooms += 1; a.beds += (r.beds_available || 0); }
      });

      // classify each date with an issue signature
      const issues = [];
      for (const d of datesBetween(from, to)) {
        const h = hotel[d]; const a = agg[d];
        let sig = null;
        if (h && h.status === 'open') {
          if (!a) sig = 'Hotel open but the rooms calendar has no rows';
          else {
            const parts = [];
            if (a.rooms !== (h.number_of_rooms || 0)) parts.push(`rooms ${a.rooms} vs hotel ${h.number_of_rooms || 0}`);
            if (a.beds !== (h.number_of_beds || 0)) parts.push(`beds ${a.beds} vs hotel ${h.number_of_beds || 0}`);
            if (parts.length) sig = 'Mismatch: ' + parts.join(' · ');
          }
        } else if (h && h.status === 'closed') {
          if (a && a.rooms > 0) sig = `Hotel CLOSED but ${a.rooms} room(s) open`;
        } else if (!h && a && a.rooms > 0) {
          sig = 'Rooms configured but the hotel calendar has no row';
        }
        if (sig) issues.push({ d, sig });
      }

      if (!issues.length) {
        out.innerHTML = `<div class="rt-ok">✓ Coherent: hotel calendar and rooms calendar agree on every day in the range.</div>`;
        return;
      }
      // group consecutive dates with same signature
      const groups = [];
      issues.forEach(({ d, sig }) => {
        const g = groups[groups.length - 1];
        if (g && g.sig === sig && new Date(d) - new Date(g.to) === 86400000) g.to = d;
        else groups.push({ from: d, to: d, sig });
      });
      out.innerHTML = `<div style="margin-top:0.4rem;font-weight:600">${issues.length} day(s) with discrepancies, in ${groups.length} range(s):</div>` +
        groups.slice(0, 40).map(g =>
          `<div class="rt-issue">${g.from}${g.to !== g.from ? ' → ' + g.to : ''}: ${esc(g.sig)}</div>`).join('') +
        (groups.length > 40 ? `<div style="color:var(--text-muted);margin-top:0.3rem">…and ${groups.length - 40} more ranges</div>` : '');
    } catch (e) {
      out.innerHTML = `<div class="rt-issue">Check failed: ${esc(e.message)}</div>`;
    }
  }

  // ── derive: hotel calendar FROM the rooms calendar ─────────────────────
  // Bottom-up is the healthy direction: the granular table is the truth,
  // the aggregate is computed. Days with room rows and 0 open rooms become
  // "closed"; days with NO room rows are skipped (we never invent data).
  async function fillHotelFromRooms(propertyId, from, to) {
    // Callable from the Availability page panel (explicit args) or legacy.
    propertyId = propertyId || el('rcal-property')?.value;
    from = from || el('rt-from')?.value; to = to || el('rt-to')?.value;
    if (!propertyId || !from || !to || from > to) { Toast.error('Pick a valid range first.'); return; }

    let roomDays;
    try { roomDays = await fetchAllRoomDays(propertyId, from, to); }
    catch (e) { Toast.error('Could not read the rooms calendar: ' + e.message); return; }

    const agg = {};
    roomDays.forEach(r => {
      const a = (agg[r.date] = agg[r.date] || { rooms: 0, beds: 0 });
      if (r.status === 'open') { a.rooms += 1; a.beds += (r.beds_available || 0); }
    });
    const days = Object.keys(agg).sort();
    if (!days.length) { Toast.error('The rooms calendar has no rows in this range — fill it first.'); return; }
    const skipped = datesBetween(from, to).length - days.length;
    const closedDays = days.filter(d => agg[d].rooms === 0).length;

    if (!confirm(`Overwrite the hotel Availability calendar for ${days.length} day(s) from the rooms data?\n` +
      `(${closedDays} day(s) become "closed" — 0 rooms open` +
      `${skipped > 0 ? `; ${skipped} day(s) without room rows are left untouched` : ''})`)) return;

    const now = new Date().toISOString();
    // availability_calendar row shape: property_uuid + property_slug (the
    // property CODE, e.g. TCH_001, NOT NULL) — mirrors the page's own saves.
    let propertySlug = window._availPropertySlugMap?.[propertyId];
    if (!propertySlug) {
      const { data: pr } = await sb.from('properties').select('property_id').eq('id', propertyId).single();
      propertySlug = pr?.property_id || '';
    }
    if (!propertySlug) { Toast.error('Could not resolve the property code.'); return; }
    const rows = days.map(d => ({
      company_id: currentCompany.id, property_uuid: propertyId, property_slug: propertySlug,
      date: d,
      status: agg[d].rooms > 0 ? 'open' : 'closed',
      number_of_rooms: agg[d].rooms,
      number_of_beds: agg[d].beds,
      updated_at: now,
    }));
    let failed = null;
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from('availability_calendar')
        .upsert(rows.slice(i, i + 500), { onConflict: 'company_id,property_uuid,date' });
      if (error) { failed = error; break; }
    }
    if (failed) { Toast.error('Failed: ' + failed.message); return; }
    Toast.success(`Hotel calendar filled for ${days.length} day(s) from the rooms data.`);
    return days.length;
  }

  // ── Availability-page panel: "Fill from rooms calendar" with own range ──
  let availPanelInjected = false;
  function ensureAvailPanel() {
    if (availPanelInjected) return;
    const section = document.getElementById('section-availability');
    const calWrap = section?.querySelector('.cal-wrap');
    if (!calWrap) return;
    const panel = document.createElement('div');
    panel.id = 'avail-fill-tools';
    panel.innerHTML = `
      <div style="border:1px solid var(--border,#e4e9f2);border-left:4px solid var(--brand,#3D65A8);
        border-radius:10px;padding:0.75rem 1rem;margin-bottom:0.9rem;background:#fafcff">
        <div style="display:flex;gap:0.7rem;align-items:center;flex-wrap:wrap">
          <strong style="font-size:0.9rem">Fill from rooms calendar</strong>
          <span style="font-size:0.78rem;color:var(--text-muted)">aggregates the per-room calendar (open rooms · sum of beds) into this hotel calendar</span>
        </div>
        <div style="display:flex;gap:0.6rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem">
          <input type="date" class="rt-input" id="af-from" style="font-size:0.82rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:5px">
          <span style="color:var(--text-muted)">→</span>
          <input type="date" class="rt-input" id="af-to" style="font-size:0.82rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:5px">
          <button class="btn btn-secondary btn-sm" onclick="RcalTools.afQuick('year')">This year</button>
          <button class="btn btn-secondary btn-sm" onclick="RcalTools.afQuick('rest')">Rest of year</button>
          <button class="btn btn-secondary btn-sm" onclick="RcalTools.afQuick('next')">Next year</button>
          <button class="btn btn-primary btn-sm" id="af-apply" onclick="RcalTools.afApply()">Fill from rooms →</button>
        </div>
        <div id="af-result" style="font-size:0.78rem;color:var(--text-muted);margin-top:0.35rem"></div>
      </div>`;
    calWrap.parentNode.insertBefore(panel, calWrap);
    availPanelInjected = true;
    afQuick('year');
  }

  function afQuick(kind) {
    const now = new Date(); const y = now.getFullYear();
    const iso = (d) => d.toISOString().slice(0, 10);
    const set = (a, b) => { el('af-from').value = a; el('af-to').value = b; };
    if (kind === 'year') set(`${y}-01-01`, `${y}-12-31`);
    if (kind === 'rest') set(iso(now), `${y}-12-31`);
    if (kind === 'next') set(`${y + 1}-01-01`, `${y + 1}-12-31`);
  }

  async function afApply() {
    const propertyId = el('avail-property-filter')?.value;
    const from = el('af-from').value, to = el('af-to').value;
    const btn = el('af-apply'); btn.disabled = true;
    try {
      const n = await fillHotelFromRooms(propertyId, from, to);
      if (n) {
        el('af-result').textContent = `${n} day(s) written. Reloading calendar…`;
        if (typeof loadAvailability === 'function') await loadAvailability();
        el('af-result').textContent = `${n} day(s) written from the rooms calendar.`;
      }
    } finally { btn.disabled = false; }
  }

  return { ensure, refreshRooms, scopeAll, toggleCat, setStatus, toggleBedsInput, quickRange, apply, checkCoherence, fillHotelFromRooms, ensureAvailPanel, afQuick, afApply };
})();
