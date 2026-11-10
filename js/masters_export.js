// masters_export.js — export all master catalogs to a client-friendly Excel file.
//
// Uses ExcelJS (loaded on demand from js/vendor/exceljs.min.js the first time the
// user exports — keeps it off the normal dashboard page load). ExcelJS is used
// instead of SheetJS because the client file needs frozen header rows and
// gridlines turned off, which the xlsx-js-style build cannot write.
//
// Layout of every sheet:
//   row 1  — a merged banner explaining how that sheet works (how to edit it),
//   row 2  — the column header (navy, frozen together with the banner),
//   row 3+ — data (active records only), zebra-striped with an autofilter.

const MastersExport = (() => {

  // ── ExcelJS, lazy-loaded ────────────────────────────────────
  let _exceljsPromise;
  function loadExcelJS() {
    if (typeof ExcelJS !== 'undefined') return Promise.resolve(ExcelJS);
    if (_exceljsPromise) return _exceljsPromise;
    _exceljsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/exceljs.min.js';
      s.onload  = () => resolve(window.ExcelJS);
      s.onerror = () => reject(new Error('No se pudo cargar ExcelJS (js/vendor/exceljs.min.js)'));
      document.head.appendChild(s);
    });
    return _exceljsPromise;
  }

  // ── Palette ─────────────────────────────────────────────────
  const NAVY = 'FF1E3A5F', AMBER = 'FFD97706', ZEBRA = 'FFF4F7FB',
        BORDER = 'FFE2E8F0', BANNER = 'FFEAF1FB', BANNER_P = 'FFFDF3E6',
        INK = 'FF31507D', INK_P = 'FF7C4700';

  // Per-sheet explanation shown in the banner (row 1). Keyed by sheet name;
  // pending sheets fall back to EXPLAIN_PENDING.
  const EXPLAIN = {
    'Channels':
      "Booking channels as received from your PMS. 'Raw value (PMS)' is exactly what the PMS sends — do not change it. 'Display Name (PowerBI)' is the label shown in your reports and is safe to edit, as are the rate type and average commission. Type/subtype group the channel in reports. Only active channels are shown.",
    'Channel Types':
      "Catalogue of channel types and subtypes used to group channels in the reports. Reference list — only active items are shown.",
    'OTAs':
      "Travel-agency (OTA) name mapping. 'Raw value (PMS)' must match what the PMS sends; edit only 'Display Name (PowerBI)', the label shown in reports. Only active items are shown.",
    'Segments':
      "Market-segment mapping. 'Raw value (PMS)' must match the PMS; edit only 'Display Name (PowerBI)'. Only active items are shown.",
    'Booking Purposes':
      "Booking-purpose mapping. 'Raw value (PMS)' must match the PMS; edit only 'Display Name (PowerBI)'. Only active items are shown.",
    'Corporations':
      "Corporate-account mapping. 'Raw value (PMS)' must match the PMS; edit only 'Display Name (PowerBI)'. Only active items are shown.",
    'Room Categories':
      "Room-category mapping. 'Raw value (PMS)' must match the PMS; edit only 'Display Name (PowerBI)'. Only active items are shown.",
    'Rooms':
      "One row per room. 'Room code' must match the PMS and should not be changed; the room name, category and bed count are editable. Only active rooms are shown.",
    'Room Attributes':
      "Catalogue of room attributes (features used to describe rooms). Reference list — only active items are shown.",
    'Extras Categories':
      "Categories and subcategories for extras. Subcategories are listed directly under their parent category. Only active items are shown.",
    'Extras':
      "Extras catalogue with pricing. 'Raw value (PMS)' must match the PMS; the display name, prices and timing are editable. Prices shown gross and net with the VAT rate applied. Only active items are shown.",
    'Market Groups':
      "Master list of market groups (nationality groupings) used in the reports. See the 'Countries' sheet for which country belongs to each group.",
    'Countries':
      "Each country's market group and whether it is a targeted market. 'Targeted' = Yes means the country counts towards your targeted-markets figures in the reports.",
  };
  const EXPLAIN_PENDING =
    "Values found in your data that are not yet mapped to a display name. Fill in the display name for each and send the file back — we will add them to the masters.";

  function explainFor(name) {
    if (name && name.startsWith('PENDING')) return EXPLAIN_PENDING;
    return EXPLAIN[name] || 'Only active records are shown.';
  }

  // ── Column widths (autofit) ─────────────────────────────────
  function colWidths(columns, rows) {
    return columns.map(c => {
      let max = c.length;
      for (const r of rows) {
        const v = String(r[c] ?? '').length;
        if (v > max) max = v;
      }
      return Math.min(60, max + 2);
    });
  }

  const thin = () => ({ style: 'thin', color: { argb: BORDER } });

  // ── One worksheet ───────────────────────────────────────────
  function buildSheet(wb, name, columns, rows, pending) {
    const safe = name.substring(0, 31);
    const ws = wb.addWorksheet(safe, {
      views: [{ state: 'frozen', ySplit: 2, showGridLines: false }],
      properties: { showGridLines: false },
    });
    const n = Math.max(1, columns.length);

    // Row 1 — explanation banner (merged across all columns)
    ws.mergeCells(1, 1, 1, n);
    const banner = ws.getCell(1, 1);
    banner.value = explainFor(name);
    banner.alignment = { wrapText: true, vertical: 'middle', horizontal: 'left' };
    banner.font = { italic: true, size: 10, color: { argb: pending ? INK_P : INK } };
    banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pending ? BANNER_P : BANNER } };
    ws.getRow(1).height = 42;

    // Row 2 — header
    const hdr = ws.getRow(2);
    columns.forEach((c, i) => {
      const cell = hdr.getCell(i + 1);
      cell.value = c;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pending ? AMBER : NAVY } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FF0F1F33' } } };
    });
    hdr.height = 22;

    // Row 3+ — data
    rows.forEach((r, ri) => {
      const row = ws.getRow(ri + 3);
      columns.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        cell.value = r[c] ?? '';
        cell.border = { top: thin(), bottom: thin(), left: thin(), right: thin() };
        cell.alignment = { vertical: 'middle' };
        if (ri % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } };
      });
    });

    // Column widths + autofilter on the header row
    const w = colWidths(columns, rows);
    columns.forEach((c, i) => { ws.getColumn(i + 1).width = w[i]; });
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2, column: n } };
  }

  async function exportAll(companyId, companyName) {
    const ExcelJSlib = await loadExcelJS();
    const wb = new ExcelJSlib.Workbook();
    wb.creator = 'BeyonData';
    wb.created = new Date();

    const used = new Set();
    // mapRow is passed (not an already-mapped array) so an empty master still
    // produces its real headers: calling mapRow({}) yields the column list.
    function addSheet(name, rows, mapRow) {
      const columns = mapRow
        ? Object.keys(mapRow({}))
        : (rows.length ? Object.keys(rows[0]) : ['Raw value (PMS)', 'Display Name (PowerBI)']);
      const mapped = mapRow ? rows.map(mapRow) : rows;
      let sheetName = name.substring(0, 31);
      let k = 2;
      while (used.has(sheetName)) sheetName = (name.substring(0, 28) + ' ' + k++).substring(0, 31);
      used.add(sheetName);
      buildSheet(wb, sheetName, columns, mapped, name.startsWith('PENDING'));
    }

    // A failed read is recorded and aborts the whole export before writing,
    // rather than silently shipping an empty sheet inside a complete-looking file.
    const failures = [];
    async function q(sheetName, query) {
      const { data, error } = await query;
      if (error) { failures.push(sheetName + ': ' + error.message); return []; }
      return data || [];
    }

    // ── Channels (type/subtype first, then the channel identity) ──
    {
      const data = await q('Channels', sb.from('channels')
        .select('raw_value, display_name, channel_type, channel_subtype, rate_type, avg_cost_pct, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('channel_type').order('display_name'));
      addSheet('Channels', data, r => ({
        'Type':                   r.channel_type || '',
        'Subtype':                r.channel_subtype || '',
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
        'Rate type':              r.rate_type || 'gross',
        'Avg commission %':       r.avg_cost_pct != null ? (r.avg_cost_pct * 100).toFixed(1) + '%' : '',
      }));
    }

    // ── Channel Types & Subtypes ──────────────────────────────
    {
      const data = await q('Channel Types', sb.from('channel_subtypes')
        .select('type_name, subtype_name, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('type_name').order('subtype_name'));
      addSheet('Channel Types', data, r => ({
        'Type':    r.type_name || '',
        'Subtype': r.subtype_name || '',
      }));
    }

    // ── OTAs ──────────────────────────────────────────────────
    {
      const data = await q('OTAs', sb.from('otas')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('display_name'));
      addSheet('OTAs', data, r => ({
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
      }));
    }

    // ── Segments ──────────────────────────────────────────────
    {
      const data = await q('Segments', sb.from('segments')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('display_name'));
      addSheet('Segments', data, r => ({
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
      }));
    }

    // ── Booking Purposes ──────────────────────────────────────
    {
      const data = await q('Booking Purposes', sb.from('booking_purposes')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('display_name'));
      addSheet('Booking Purposes', data, r => ({
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
      }));
    }

    // ── Corporations ──────────────────────────────────────────
    {
      const data = await q('Corporations', sb.from('corporations')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('display_name'));
      addSheet('Corporations', data, r => ({
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
      }));
    }

    // ── Room Categories ───────────────────────────────────────
    {
      const data = await q('Room Categories', sb.from('room_categories')
        .select('raw_value, display_name, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('display_name'));
      addSheet('Room Categories', data, r => ({
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
      }));
    }

    // ── Rooms ─────────────────────────────────────────────────
    {
      const data = await q('Rooms', sb.from('rooms')
        .select('property_id, raw_value, display_name, beds_per_room, status, category_id, room_categories(display_name, raw_value)')
        .eq('company_id', companyId).eq('status', 'active')
        .order('property_id').order('raw_value'));
      addSheet('Rooms', data, r => ({
        'Property':  r.property_id || '',
        'Room code': r.raw_value || '',
        'Room name': r.display_name || '',
        'Category':  r.room_categories?.display_name || r.room_categories?.raw_value || '',
        'Beds':      r.beds_per_room ?? '',
      }));
    }

    // ── Room Attributes ───────────────────────────────────────
    {
      const data = await q('Room Attributes', sb.from('room_attribute_types')
        .select('attribute_code, attribute_name, description, attribute_type, is_variable, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('attribute_name'));
      addSheet('Room Attributes', data, r => ({
        'Attribute code': r.attribute_code || '',
        'Attribute name': r.attribute_name || '',
        'Description':     r.description || '',
        'Type':           r.attribute_type || '',
        'Variable':       r.is_variable ? 'Yes' : 'No',
      }));
    }

    // ── Extras Categories ─────────────────────────────────────
    {
      const data = await q('Extras Categories', sb.from('extras_categories')
        .select('id, category_name, parent_id, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('category_name'));
      const nameById = new Map(data.map(r => [r.id, r.category_name]));
      const roots    = data.filter(r => !r.parent_id);
      const ordered  = [];
      roots.forEach(root => {
        ordered.push(root);
        data.filter(r => r.parent_id === root.id).forEach(sub => ordered.push(sub));
      });
      addSheet('Extras Categories', ordered, r => ({
        'Category name':   r.category_name || '',
        'Parent category': r.parent_id ? (nameById.get(r.parent_id) || '') : '',
      }));
    }

    // ── Extras ────────────────────────────────────────────────
    {
      const data = await q('Extras', sb.from('v_extras_catalog')
        .select('raw_value, display_name, category_name, subcategory_name, unit_price_gross, vat_rate, unit_price_net, revenue_timing, purchase_timing, is_passthrough, status')
        .eq('company_id', companyId).eq('status', 'active')
        .order('category_name').order('display_name'));
      addSheet('Extras', data, r => ({
        'Raw value (PMS)':        r.raw_value || '',
        'Display Name (PowerBI)': r.display_name || '',
        'Category':               r.category_name || '',
        'Subcategory':            r.subcategory_name || '',
        'Unit price (gross)':     r.unit_price_gross ?? '',
        'VAT %':                  r.vat_rate != null ? (r.vat_rate * 100).toFixed(0) + '%' : '',
        'Unit price (net)':       r.unit_price_net != null ? parseFloat(r.unit_price_net).toFixed(4) : '',
        'Revenue timing':         r.revenue_timing || '',
        'Purchase timing':        r.purchase_timing || 'unknown',
        'Pass-through':           r.is_passthrough ? 'yes' : 'no',
      }));
    }

    // ── Market Groups (master list of groups) ─────────────────
    const groups = await q('Market Groups', sb.from('market_groups')
      .select('id, group_code, group_name, status')
      .eq('company_id', companyId).eq('status', 'active')
      .order('group_code'));
    addSheet('Market Groups', groups, r => ({
      'Group code': r.group_code ?? '',
      'Group name': r.group_name || '',
    }));

    // ── Countries (which group each country is in + targeted) ──
    {
      const cmap = await q('Countries', sb.from('country_mapping')
        .select('country_code, targeted, market_group_id')
        .eq('company_id', companyId)
        .order('country_code'));
      const gname = new Map(groups.map(g => [g.id, g.group_name]));
      addSheet('Countries', cmap, r => ({
        'Country code': (r.country_code || '').trim(),
        'Market group': gname.get(r.market_group_id) || '',
        'Targeted':     r.targeted ? 'Yes' : 'No',
      }));
    }

    // ── Pending values from ALL files loaded in Masters Setup ──
    try {
      if (typeof MastersSetup !== 'undefined' && MastersSetup.getAllPendingSheets) {
        const pending = await MastersSetup.getAllPendingSheets();
        pending.forEach(p => addSheet(p.name, p.rows));
      }
    } catch (e) { /* pending is best-effort */ }

    // ── Abort on any failed sheet ─────────────────────────────
    if (failures.length) {
      throw new Error('no se pudieron leer ' + failures.length +
        (failures.length === 1 ? ' maestro' : ' maestros') + ' — ' + failures.join(' · '));
    }

    // ── Write + download ──────────────────────────────────────
    const today    = new Date().toISOString().slice(0, 10);
    const safeName = (companyName || 'company').replace(/[^a-zA-Z0-9]+/g, '_');
    const buf  = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `BeyonData_Masters_${safeName}_${today}.xlsx`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  return { exportAll };
})();
