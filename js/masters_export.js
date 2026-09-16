// masters_export.js — export all master catalogs to a client-friendly Excel file
// Uses SheetJS (xlsx) loaded from CDN. One sheet per master, business columns only.

const MastersExport = (() => {

  function autoWidth(rows) {
    // rows: array of objects. Returns [{wch}] per column based on longest value.
    if (!rows.length) return [];
    const keys = Object.keys(rows[0]);
    return keys.map(k => ({
      wch: Math.min(60, Math.max(k.length, ...rows.map(r => String(r[k] ?? '').length)) + 2)
    }));
  }

  // mapRow is passed instead of an already-mapped array so that an empty master
  // still produces its real headers: a client receiving the file has to see
  // which columns to fill in. Calling it with {} yields the column list.
  function addSheet(wb, name, rows, mapRow) {
    const mapped  = mapRow ? rows.map(mapRow) : rows;
    const columns = mapRow ? Object.keys(mapRow({})) : (rows.length ? Object.keys(rows[0]) : ['']);

    if (!mapped.length) {
      const empty = XLSX.utils.json_to_sheet([], { header: columns });
      empty['!cols'] = columns.map(k => ({ wch: Math.min(60, k.length + 2) }));
      styleSheet(empty, name);
      XLSX.utils.book_append_sheet(wb, empty, name.substring(0, 31));
      return;
    }
    const data = mapped;
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = autoWidth(data);
    styleSheet(ws, name);
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31)); // Excel sheet name limit
  }

  function styleSheet(ws, name) {
    const isPending = name.startsWith('PENDING');
    const headerFill = isPending ? 'D97706' : '1E3A5F';   // amber for pending, navy for masters
    const range = XLSX.utils.decode_range(ws['!ref']);

    // Header row style
    for (let c = 0; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c });
      if (!ws[addr]) continue;
      ws[addr].s = {
        font:      { bold: true, color: { rgb: 'FFFFFF' } },
        fill:      { fgColor: { rgb: headerFill } },
        alignment: { horizontal: 'center', vertical: 'center' },
        border:    { bottom: { style: 'medium', color: { rgb: '0F1F33' } } },
      };
    }

    // Body: light zebra striping + thin borders
    for (let r = 1; r <= range.e.r; r++) {
      for (let c = 0; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        if (!ws[addr]) continue;
        ws[addr].s = {
          fill:   r % 2 === 0 ? { fgColor: { rgb: 'F4F7FB' } } : undefined,
          border: {
            top:    { style: 'thin', color: { rgb: 'E2E8F0' } },
            bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
            left:   { style: 'thin', color: { rgb: 'E2E8F0' } },
            right:  { style: 'thin', color: { rgb: 'E2E8F0' } },
          },
        };
      }
    }

    // Autofilter on the header row
    ws['!autofilter'] = { ref: ws['!ref'] };
    // Taller header row
    ws['!rows'] = [{ hpt: 22 }];
  }

  async function exportAll(companyId, companyName) {
    const wb = XLSX.utils.book_new();

    // Every sheet reads through here. A failed read used to land as (data || [])
    // — an empty sheet inside a file that looked complete. Now it is recorded
    // and the whole export aborts before writing anything.
    const failures = [];
    async function q(sheetName, query) {
      const { data, error } = await query;
      if (error) { failures.push(sheetName + ': ' + error.message); return []; }
      return data || [];
    }

    // ── Channels ──────────────────────────────────────────────
    {
      const data = await q('Channels', sb.from('channels')
        .select('raw_value, display_name, channel_type, channel_subtype, rate_type, avg_cost_pct, status')
        .eq('company_id', companyId)
        .order('channel_type').order('display_name'));
      addSheet(wb, 'Channels', data, r => ({
        'Raw value (PMS)':   r.raw_value || '',
        'Display name':      r.display_name || '',
        'Type':              r.channel_type || '',
        'Subtype':           r.channel_subtype || '',
        'Rate type':         r.rate_type || 'gross',
        'Avg commission %':  r.avg_cost_pct != null ? (r.avg_cost_pct * 100).toFixed(1) + '%' : '',
        'Status':            r.status || '',
      }));
    }

    // ── Channel Types & Subtypes ──────────────────────────────
    {
      const data = await q('Channel Types', sb.from('channel_subtypes')
        .select('type_name, subtype_name, status')
        .eq('company_id', companyId)
        .order('type_name').order('subtype_name'));
      addSheet(wb, 'Channel Types', data, r => ({
        'Type':    r.type_name,
        'Subtype': r.subtype_name,
        'Status':  r.status,
      }));
    }

    // ── OTAs ──────────────────────────────────────────────────
    {
      const data = await q('OTAs', sb.from('otas')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name'));
      addSheet(wb, 'OTAs', data, r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || 'active',
      }));
    }

    // ── Segments ──────────────────────────────────────────────
    {
      const data = await q('Segments', sb.from('segments')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name'));
      addSheet(wb, 'Segments', data, r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || '',
      }));
    }

    // ── Booking Purposes ──────────────────────────────────────
    {
      const data = await q('Booking Purposes', sb.from('booking_purposes')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name'));
      addSheet(wb, 'Booking Purposes', data, r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || '',
      }));
    }

    // ── Room Categories ───────────────────────────────────────
    {
      const data = await q('Room Categories', sb.from('room_categories')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name'));
      addSheet(wb, 'Room Categories', data, r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || '',
      }));
    }

    // ── Rooms ─────────────────────────────────────────────────
    {
      const data = await q('Rooms', sb.from('rooms')
        .select('property_id, raw_value, display_name, beds_per_room, status, category_id, room_categories(display_name, raw_value)')
        .eq('company_id', companyId)
        .order('property_id').order('raw_value'));
      addSheet(wb, 'Rooms', data, r => ({
        'Property':      r.property_id || '',
        'Room code':     r.raw_value || '',
        'Room name':     r.display_name || '',
        'Category':      r.room_categories?.display_name || r.room_categories?.raw_value || '',
        'Beds':          r.beds_per_room ?? '',
        'Status':        r.status || '',
      }));
    }

    // ── Extras Categories ─────────────────────────────────────
    {
      const data = await q('Extras Categories', sb.from('extras_categories')
        .select('id, category_name, parent_id, status')
        .eq('company_id', companyId)
        .order('category_name'));
      // Subcategories are listed right under their parent, as in the portal.
      const nameById = new Map(data.map(r => [r.id, r.category_name]));
      const roots    = data.filter(r => !r.parent_id);
      const ordered  = [];
      roots.forEach(root => {
        ordered.push(root);
        data.filter(r => r.parent_id === root.id).forEach(sub => ordered.push(sub));
      });
      addSheet(wb, 'Extras Categories', ordered, r => ({
        'Category name':   r.category_name,
        'Parent category': r.parent_id ? (nameById.get(r.parent_id) || '') : '',
        'Status':          r.status,
      }));
    }

    // ── Extras ────────────────────────────────────────────────
    {
      const data = await q('Extras', sb.from('v_extras_catalog')
        .select('raw_value, display_name, category_name, subcategory_name, unit_price_gross, vat_rate, unit_price_net, revenue_timing, purchase_timing, is_passthrough, status')
        .eq('company_id', companyId)
        .order('category_name').order('display_name'));
      addSheet(wb, 'Extras', data, r => ({
        'Raw value (PMS)':    r.raw_value || '',
        'Display name':       r.display_name || '',
        'Category':           r.category_name || '',
        'Subcategory':        r.subcategory_name || '',
        'Unit price (gross)': r.unit_price_gross ?? '',
        'VAT %':              r.vat_rate != null ? (r.vat_rate * 100).toFixed(0) + '%' : '',
        'Unit price (net)':   r.unit_price_net != null ? parseFloat(r.unit_price_net).toFixed(4) : '',
        'Revenue timing':     r.revenue_timing || '',
        'Purchase timing':    r.purchase_timing || 'unknown',
        'Pass-through':       r.is_passthrough ? 'yes' : 'no',
        'Status':             r.status || '',
      }));
    }

    // ── Market Groups ─────────────────────────────────────────
    {
      const groups = await q('Market Groups', sb.from('market_groups')
        .select('id, group_code, group_name, status')
        .eq('company_id', companyId)
        .order('group_code'));
      const cmap = await q('Market Groups (countries)', sb.from('country_mapping')
        .select('country_code, market_group_id')
        .eq('company_id', companyId));
      const byGroup = {};
      cmap.forEach(c => {
        if (!byGroup[c.market_group_id]) byGroup[c.market_group_id] = [];
        byGroup[c.market_group_id].push(c.country_code);
      });
      addSheet(wb, 'Market Groups', groups, r => ({
        'Group code': r.group_code || '',
        'Group name': r.group_name || '',
        'Countries':  (byGroup[r.id] || []).sort().join(', '),
        'Status':     r.status || '',
      }));
    }

    // ── Client Country Mapping ────────────────────────────────
    {
      const data = await q('Country Mapping', sb.from('client_country_mapping')
        .select('raw_value, country_code, status')
        .eq('company_id', companyId)
        .order('raw_value'));
      addSheet(wb, 'Country Mapping', data, r => ({
        'Raw value (PMS)': r.raw_value || '',
        'ISO country':     r.country_code || '',
        'Status':          r.status || '',
      }));
    }

    // ── Pending values from ALL files loaded in Masters Setup ──
    try {
      if (typeof MastersSetup !== 'undefined' && MastersSetup.getAllPendingSheets) {
        const pending = await MastersSetup.getAllPendingSheets();
        pending.forEach(p => addSheet(wb, p.name, p.rows));
      }
    } catch (e) { /* pending is best-effort */ }

    // ── Abort on any failed sheet ─────────────────────────────
    // Handing over a file with a silently missing sheet is worse than handing
    // over nothing: nobody can tell what is absent.
    if (failures.length) {
      throw new Error('no se pudieron leer ' + failures.length +
        (failures.length === 1 ? ' maestro' : ' maestros') + ' — ' + failures.join(' · '));
    }

    // ── Write file ────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const safeName = (companyName || 'company').replace(/[^a-zA-Z0-9]+/g, '_');
    XLSX.writeFile(wb, `BeyonData_Masters_${safeName}_${today}.xlsx`);
  }

  return { exportAll };
})();
