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

  function addSheet(wb, name, rows, emptyMessage) {
    const data = rows.length ? rows : [{ '': emptyMessage || 'No records yet' }];
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = autoWidth(data);
    XLSX.utils.book_append_sheet(wb, ws, name.substring(0, 31)); // Excel sheet name limit
  }

  async function exportAll(companyId, companyName) {
    const wb = XLSX.utils.book_new();

    // ── Channels ──────────────────────────────────────────────
    {
      const { data } = await sb.from('channels')
        .select('raw_value, display_name, channel_type, channel_subtype, rate_type, avg_cost_pct, status')
        .eq('company_id', companyId)
        .order('channel_type').order('display_name');
      addSheet(wb, 'Channels', (data || []).map(r => ({
        'Raw value (PMS)':   r.raw_value || '',
        'Display name':      r.display_name || '',
        'Type':              r.channel_type || '',
        'Subtype':           r.channel_subtype || '',
        'Rate type':         r.rate_type || 'gross',
        'Avg commission %':  r.avg_cost_pct != null ? (r.avg_cost_pct * 100).toFixed(1) + '%' : '',
        'Status':            r.status || '',
      })));
    }

    // ── Channel Types & Subtypes ──────────────────────────────
    {
      const { data } = await sb.from('channel_subtypes')
        .select('type_name, subtype_name, status')
        .eq('company_id', companyId)
        .order('type_name').order('subtype_name');
      addSheet(wb, 'Channel Types', (data || []).map(r => ({
        'Type':    r.type_name,
        'Subtype': r.subtype_name,
        'Status':  r.status,
      })));
    }

    // ── OTAs ──────────────────────────────────────────────────
    {
      const { data } = await sb.from('otas')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name');
      addSheet(wb, 'OTAs', (data || []).map(r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || 'active',
      })));
    }

    // ── Segments ──────────────────────────────────────────────
    {
      const { data } = await sb.from('segments')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name');
      addSheet(wb, 'Segments', (data || []).map(r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || '',
      })));
    }

    // ── Booking Purposes ──────────────────────────────────────
    {
      const { data } = await sb.from('booking_purposes')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name');
      addSheet(wb, 'Booking Purposes', (data || []).map(r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || '',
      })));
    }

    // ── Room Categories ───────────────────────────────────────
    {
      const { data } = await sb.from('room_categories')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId)
        .order('display_name');
      addSheet(wb, 'Room Categories', (data || []).map(r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Status':          r.status || '',
      })));
    }

    // ── Rooms ─────────────────────────────────────────────────
    {
      const { data } = await sb.from('rooms')
        .select('property_id, raw_value, display_name, beds_per_room, status, category_id, room_categories(display_name, raw_value)')
        .eq('company_id', companyId)
        .order('property_id').order('raw_value');
      addSheet(wb, 'Rooms', (data || []).map(r => ({
        'Property':      r.property_id || '',
        'Room code':     r.raw_value || '',
        'Room name':     r.display_name || '',
        'Category':      r.room_categories?.display_name || r.room_categories?.raw_value || '',
        'Beds':          r.beds_per_room ?? '',
        'Status':        r.status || '',
      })));
    }

    // ── Extras Categories ─────────────────────────────────────
    {
      const { data } = await sb.from('extras_categories')
        .select('category_name, status')
        .eq('company_id', companyId)
        .order('category_name');
      addSheet(wb, 'Extras Categories', (data || []).map(r => ({
        'Category name': r.category_name,
        'Status':        r.status,
      })));
    }

    // ── Extras ────────────────────────────────────────────────
    {
      const { data } = await sb.from('extras_catalog')
        .select('raw_value, display_name, category, subcategory, default_amount, charge_timing, status')
        .eq('company_id', companyId)
        .order('category').order('display_name');
      addSheet(wb, 'Extras', (data || []).map(r => ({
        'Raw value (PMS)': r.raw_value || '',
        'Display name':    r.display_name || '',
        'Category':        r.category || '',
        'Subcategory':     r.subcategory || '',
        'Default €':       r.default_amount ?? '',
        'Charge timing':   r.charge_timing || '',
        'Status':          r.status || '',
      })));
    }

    // ── Market Groups ─────────────────────────────────────────
    {
      const { data: groups } = await sb.from('market_groups')
        .select('id, group_code, group_name, status')
        .eq('company_id', companyId)
        .order('group_code');
      const { data: cmap } = await sb.from('country_mapping')
        .select('country_code, market_group_id')
        .eq('company_id', companyId);
      const byGroup = {};
      (cmap || []).forEach(c => {
        if (!byGroup[c.market_group_id]) byGroup[c.market_group_id] = [];
        byGroup[c.market_group_id].push(c.country_code);
      });
      addSheet(wb, 'Market Groups', (groups || []).map(r => ({
        'Group code': r.group_code || '',
        'Group name': r.group_name || '',
        'Countries':  (byGroup[r.id] || []).sort().join(', '),
        'Status':     r.status || '',
      })));
    }

    // ── Client Country Mapping ────────────────────────────────
    {
      const { data } = await sb.from('client_country_mapping')
        .select('raw_value, country_code, status')
        .eq('company_id', companyId)
        .order('raw_value');
      addSheet(wb, 'Country Mapping', (data || []).map(r => ({
        'Raw value (PMS)': r.raw_value || '',
        'ISO country':     r.country_code || '',
        'Status':          r.status || '',
      })));
    }

    // ── Pending values from the file currently loaded in Masters Setup ──
    try {
      if (typeof MastersSetup !== 'undefined' && MastersSetup.getPendingSheets) {
        const pending = await MastersSetup.getPendingSheets();
        pending.forEach(p => addSheet(wb, p.name, p.rows));
      }
    } catch (e) { /* pending is best-effort */ }

    // ── Write file ────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const safeName = (companyName || 'company').replace(/[^a-zA-Z0-9]+/g, '_');
    XLSX.writeFile(wb, `BeyonData_Masters_${safeName}_${today}.xlsx`);
  }

  return { exportAll };
})();
