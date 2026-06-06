// room_calendar.js — Gantt-style room capacity calendar

const RoomCalendar = (() => {
  let year    = new Date().getFullYear();
  let month   = new Date().getMonth() + 1;
  let rooms   = [];
  let capData = {};      // key: roomId_date → { beds_available, status, attributes }
  let pending = {};      // same key format, unsaved changes
  let attrTypes = [];    // active attribute types
  let availMax  = {};    // key: date → max beds from availability_calendar

  const MONTHS = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];

  function key(roomId, date) { return `${roomId}__${date}`; }

  function getDay(roomId, date) {
    const k = key(roomId, date);
    return pending[k] ?? capData[k] ?? { beds_available: 0, status: 'closed', attributes: [] };
  }

  function setDay(roomId, date, fields) {
    const k = key(roomId, date);
    const current = getDay(roomId, date);
    pending[k] = { ...current, ...fields };
    markChanged();
  }

  function markChanged() {
    const hasPending = Object.keys(pending).length > 0;
    document.getElementById('rcal-save-bar').style.display = hasPending ? 'block' : 'none';
  }

  async function init() {
    const companyId  = currentCompany.id;
    const propertyId = document.getElementById('rcal-property-filter').value;
    if (!propertyId) return;

    pending = {};
    markChanged();

    // Load in parallel
    console.log('RoomCalendar.init - companyId:', companyId, 'propertyId:', propertyId);
    const [roomsRes, attrRes, capRes, availRes] = await Promise.all([
      Rooms.getByProperty(companyId, propertyId),
      Rooms.getAttributeTypes(companyId),
      Rooms.getCapacityMonth(companyId, propertyId, year, month),
      sb.from('availability_calendar')
        .select('date, number_of_beds')
        .eq('company_id', companyId)
        .eq('property_id', propertyId)
        .gte('date', `${year}-${String(month).padStart(2,'0')}-01`)
        .lte('date', `${year}-${String(month).padStart(2,'0')}-${String(new Date(year,month,0).getDate()).padStart(2,'0')}`)
    ]);

    console.log('roomsRes:', roomsRes.error || roomsRes.data?.length + ' rooms');
    console.log('attrRes:', attrRes.error || attrRes.data?.length + ' attrs');
    console.log('capRes:', capRes.error || capRes.data?.length + ' cap rows');
    rooms     = (roomsRes.data || []).filter(r => r.status === 'active');
    attrTypes = (attrRes.data  || []).filter(a => a.status === 'active');

    capData = {};
    (capRes.data || []).forEach(r => {
      capData[key(r.room_id, r.date)] = {
        beds_available: r.beds_available,
        status:         r.status,
        attributes:     r.attributes || []
      };
    });

    availMax = {};
    (availRes.data || []).forEach(r => { availMax[r.date] = r.number_of_beds; });

    render();
  }

  function render() {
    const totalDays = new Date(year, month, 0).getDate();
    const today = new Date().toISOString().slice(0,10);

    // Month label + year select
    document.getElementById('rcal-month-label').textContent = `${MONTHS[month-1]} ${year}`;
    const yrSel = document.getElementById('rcal-year-select');
    const curYr = new Date().getFullYear();
    if (!yrSel.options.length) {
      for (let y = curYr - 2; y <= curYr + 5; y++) {
        const o = document.createElement('option');
        o.value = y; o.textContent = y;
        if (y === year) o.selected = true;
        yrSel.appendChild(o);
      }
    }
    yrSel.value = year;

    // Build dates array
    const dates = [];
    for (let d = 1; d <= totalDays; d++) {
      dates.push(`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }

    // Compute daily totals
    const dailyTotals = {};
    dates.forEach(date => {
      let total = 0;
      rooms.forEach(r => {
        const day = getDay(r.id, date);
        if (day.status === 'open') total += day.beds_available;
      });
      dailyTotals[date] = total;
    });

    // Update today summary
    const todayStr = dates.includes(today) ? today : dates[0];
    const todayTotal = dailyTotals[todayStr] || 0;
    const todayMax   = availMax[todayStr] || 0;
    document.getElementById('rcal-today-beds').textContent = `${todayTotal} beds configured`;
    document.getElementById('rcal-today-max').textContent  = `${todayMax}`;

    // Build grid HTML
    const CELL_W = 38;
    const ROW_H  = 40;
    const COL_0  = 160; // room name column width

    let html = `<table style="border-collapse:collapse;font-size:0.75rem;min-width:${COL_0 + CELL_W*totalDays}px">`;

    // Header row — day numbers
    html += '<thead><tr>';
    html += `<th style="width:${COL_0}px;min-width:${COL_0}px;padding:4px 8px;text-align:left;background:var(--bg);border:1px solid var(--border);font-family:'DM Mono',monospace;font-size:0.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;position:sticky;left:0;z-index:2">Room</th>`;
    dates.forEach(date => {
      const d   = parseInt(date.slice(8));
      const dow = new Date(date).getDay(); // 0=Sun
      const isWeekend = dow === 0 || dow === 6;
      const isToday   = date === today;
      const total     = dailyTotals[date] || 0;
      const max       = availMax[date] || 0;
      const over      = max > 0 && total > max;
      const bg        = over ? '#fff0f0' : isToday ? 'var(--brand-light)' : isWeekend ? '#f9fafb' : 'var(--bg)';
      const color     = over ? 'var(--error)' : isToday ? 'var(--brand)' : 'var(--text-muted)';
      html += `<th style="width:${CELL_W}px;min-width:${CELL_W}px;padding:3px 2px;text-align:center;background:${bg};border:1px solid var(--border);color:${color};font-weight:${isToday?700:500}">${d}<br><span style="font-size:0.6rem;font-weight:400">${total}/${max||'?'}</span></th>`;
    });
    html += '</tr></thead><tbody>';

    // Room rows
    rooms.forEach(room => {
      html += '<tr>';
      // Room name cell — click to edit whole row
      html += `<td onclick="openRoomRow('${room.id}','${room.room_name}')"
        style="padding:4px 8px;background:var(--white);border:1px solid var(--border);
               font-weight:500;cursor:pointer;position:sticky;left:0;z-index:1;
               white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:${COL_0}px"
        title="Click to edit entire row — ${room.room_name}">
        ${room.room_name}
      </td>`;

      dates.forEach(date => {
        const day     = getDay(room.id, date);
        const isPending = !!pending[key(room.id, date)];
        const isClosed  = day.status === 'closed';
        const beds      = day.beds_available;
        const attrs     = day.attributes || [];

        let bg = 'var(--white)';
        if (isPending)  bg = '#fffbeb';
        if (isClosed)   bg = '#fff5f5';

        const attrDots = attrs.slice(0,3).map(a => {
          const at = attrTypes.find(t => t.attribute_code === a);
          return `<span title="${at?.attribute_name||a}" style="display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--brand);margin:0 1px;opacity:0.6"></span>`;
        }).join('');

        html += `<td onclick="openRoomCell('${room.id}','${date}','${room.room_name}')"
          style="width:${CELL_W}px;min-width:${CELL_W}px;max-width:${CELL_W}px;
                 padding:3px 2px;text-align:center;background:${bg};
                 border:1px solid var(--border);cursor:pointer;vertical-align:middle"
          title="${date} — ${isClosed ? 'Closed' : beds + ' beds'} ${attrs.length ? '| '+attrs.join(', ') : ''}">
          ${isClosed
            ? '<span style="color:#fca5a5;font-size:0.7rem">✕</span>'
            : `<span style="font-weight:500;color:var(--text)">${beds||'—'}</span>`}
          <div style="line-height:1">${attrDots}</div>
        </td>`;
      });
      html += '</tr>';
    });

    // Totals row
    html += '<tr>';
    html += `<td style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);font-weight:600;position:sticky;left:0;z-index:1;font-size:0.75rem;color:var(--text-muted)">TOTAL BEDS</td>`;
    dates.forEach(date => {
      const total = dailyTotals[date] || 0;
      const max   = availMax[date] || 0;
      const over  = max > 0 && total > max;
      const equal = max > 0 && total === max;
      const bg    = over ? '#fff0f0' : equal ? '#f0fdf4' : 'var(--bg)';
      const color = over ? 'var(--error)' : equal ? 'var(--success)' : 'var(--text-muted)';
      html += `<td style="padding:3px 2px;text-align:center;background:${bg};border:1px solid var(--border);font-weight:600;color:${color};font-size:0.75rem">${total}</td>`;
    });
    html += '</tr>';

    // Max row (from availability_calendar)
    html += '<tr>';
    html += `<td style="padding:4px 8px;background:var(--bg);border:1px solid var(--border);font-size:0.7rem;color:var(--text-muted);position:sticky;left:0;z-index:1">MAX (avail.cal)</td>`;
    dates.forEach(date => {
      const max = availMax[date] || '?';
      html += `<td style="padding:3px 2px;text-align:center;background:var(--bg);border:1px solid var(--border);font-size:0.7rem;color:var(--text-muted)">${max}</td>`;
    });
    html += '</tr>';

    html += '</tbody></table>';
    document.getElementById('rcal-grid-wrap').innerHTML = html;
  }

  // ── Cell modal ──────────────────────────────────────────────────
  function openCell(roomId, date, roomName) {
    const day = getDay(roomId, date);
    document.getElementById('rcal-cell-room-id').value = roomId;
    document.getElementById('rcal-cell-date').value    = date;
    document.getElementById('rcal-cell-title').textContent = `${roomName} — ${date}`;
    document.getElementById('rcal-cell-beds').value    = day.beds_available || 0;

    setRcalStatus(day.status);

    // Render attribute checkboxes
    const container = document.getElementById('rcal-attr-checkboxes');
    container.innerHTML = attrTypes.map(a => `
      <label style="display:flex;align-items:center;gap:5px;font-size:0.82rem;cursor:pointer;
                    background:var(--bg);padding:3px 8px;border-radius:var(--radius);border:1px solid var(--border)">
        <input type="checkbox" value="${a.attribute_code}"
          ${(day.attributes||[]).includes(a.attribute_code) ? 'checked' : ''}>
        ${a.attribute_name}
      </label>`).join('');

    UI.hideAlert('rcal-cell-error');
    UI.openModal('modal-rcal-cell');
    wireRoomCalendarButtons();
  }

  function setRcalStatus(status) {
    document.getElementById('rcal-status-open').classList.toggle('active', status === 'open');
    document.getElementById('rcal-status-closed').classList.toggle('active', status === 'closed');
    document.getElementById('rcal-beds-field').style.opacity = status === 'closed' ? '0.4' : '1';
  }

  function saveCell() {
    const roomId = document.getElementById('rcal-cell-room-id').value;
    const date   = document.getElementById('rcal-cell-date').value;
    const beds   = parseInt(document.getElementById('rcal-cell-beds').value) || 0;
    const status = document.getElementById('rcal-status-open').classList.contains('active') ? 'open' : 'closed';
    const attrs  = [...document.querySelectorAll('#rcal-attr-checkboxes input:checked')].map(i => i.value);

    setDay(roomId, date, { beds_available: beds, status, attributes: attrs });
    UI.closeModal('modal-rcal-cell');
    render();
  }

  // ── Row modal ───────────────────────────────────────────────────
  function openRow(roomId, roomName) {
    document.getElementById('rcal-row-room-id').value = roomId;
    document.getElementById('rcal-row-title').textContent = `Edit month — ${roomName}`;
    document.getElementById('rcal-row-beds').value = '';
    document.getElementById('rcal-row-status').value = '';

    const container = document.getElementById('rcal-row-attr-checkboxes');
    container.innerHTML = attrTypes.map(a => `
      <label style="display:flex;align-items:center;gap:5px;font-size:0.82rem;cursor:pointer;
                    background:var(--bg);padding:3px 8px;border-radius:var(--radius);border:1px solid var(--border)">
        <input type="checkbox" value="${a.attribute_code}"> ${a.attribute_name}
      </label>`).join('');

    UI.hideAlert('rcal-row-error');
    UI.openModal('modal-rcal-row');
    wireRoomCalendarButtons();
  }

  function saveRow() {
    const roomId = document.getElementById('rcal-row-room-id').value;
    const status = document.getElementById('rcal-row-status').value || null;
    const bedsRaw = document.getElementById('rcal-row-beds').value;
    const beds   = bedsRaw !== '' ? parseInt(bedsRaw) : null;
    const checkedAttrs = [...document.querySelectorAll('#rcal-row-attr-checkboxes input:checked')].map(i => i.value);

    const totalDays = new Date(year, month, 0).getDate();
    for (let d = 1; d <= totalDays; d++) {
      const date    = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const current = getDay(roomId, date);
      const update  = {};
      if (status !== null) update.status = status;
      if (beds !== null)   update.beds_available = beds;
      if (checkedAttrs.length > 0) update.attributes = checkedAttrs;
      setDay(roomId, date, update);
    }

    UI.closeModal('modal-rcal-row');
    render();
  }

  // ── Save all pending ─────────────────────────────────────────────
  async function saveAll() {
    const companyId  = currentCompany.id;
    const propertyId = document.getElementById('rcal-property-filter').value;
    const btn        = document.querySelector('#rcal-save-bar button');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

    const rows = Object.entries(pending).map(([k, fields]) => {
      const [roomId, date] = k.split('__');
      return { company_id: companyId, property_id: propertyId, room_id: roomId, date, ...fields,
               updated_at: new Date().toISOString() };
    });

    const { error } = await Rooms.upsertCapacityMany(rows);
    if (btn) { btn.disabled = false; btn.textContent = 'Guardar cambios'; }

    if (error) { alert('Error saving: ' + error.message); return; }

    // Reload
    pending = {};
    await init();
  }

  async function populatePropertyFilter() {
    const { data } = await Properties.getByCompany(currentCompany.id);
    const sel = document.getElementById('rcal-property-filter');
    if (!sel.options.length) {
      (data || []).forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.property_id;
        opt.textContent = `${p.property_name} (${p.property_id})`;
        sel.appendChild(opt);
      });
    }
  }

  return {
    init: async () => { await populatePropertyFilter(); await init(); },
    changeMonth: (delta) => {
      month += delta;
      if (month > 12) { month = 1; year++; }
      if (month < 1)  { month = 12; year--; }
      pending = {};
      init();
    },
    changeYear: (y) => { year = parseInt(y); pending = {}; init(); },
    openCell,
    openRow,
    saveCell,
    saveRow,
    saveAll
  };
})();

// Global wrappers for inline onclick handlers
function initRoomCalendar()           { RoomCalendar.init(); }
function changeRoomCalMonth(delta)    { RoomCalendar.changeMonth(delta); }
function changeRoomCalYear(y)         { RoomCalendar.changeYear(y); }
function openRoomCell(rid,date,name)  { RoomCalendar.openCell(rid,date,name); }
function openRoomRow(rid,name)        { RoomCalendar.openRow(rid,name); }
function saveRoomCalendar()           { RoomCalendar.saveAll(); }

function setRcalStatus(s) {
  document.getElementById('rcal-status-open').classList.toggle('active', s==='open');
  document.getElementById('rcal-status-closed').classList.toggle('active', s==='closed');
  document.getElementById('rcal-beds-field').style.opacity = s==='closed'?'0.4':'1';
}

// Wire modal save buttons after DOM is ready
function wireRoomCalendarButtons() {
  const saveCell = document.getElementById('btn-save-rcal-cell');
  if (saveCell && !saveCell._wired) {
    saveCell.addEventListener('click', () => RoomCalendar.saveCell());
    saveCell._wired = true;
  }
  const saveRow = document.getElementById('btn-save-rcal-row');
  if (saveRow && !saveRow._wired) {
    saveRow.addEventListener('click', () => RoomCalendar.saveRow());
    saveRow._wired = true;
  }
}

document.addEventListener('DOMContentLoaded', wireRoomCalendarButtons);
