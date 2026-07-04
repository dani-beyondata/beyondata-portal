// masters_import.js — import the masters Excel back and apply inserts/updates.
// Matches rows by their natural key (usually raw_value). Rows present in the DB
// but missing from the Excel are optionally deactivated (never hard-deleted).

const MastersImport = (() => {

  // Sheet definitions: how Excel columns map back to DB fields.
  // key: columns identifying the row; fields: updatable columns.
  const SHEETS = {
    'Channels': {
      table: 'channels',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name:    (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        channel_type:    (r['Type'] || '').trim() || 'indirect',
        channel_subtype: (r['Subtype'] || '').trim() || 'ota',
        rate_type:       ((r['Rate type'] || 'gross').trim().toLowerCase() === 'net') ? 'net' : 'gross',
        avg_cost_pct:    parseFloat(String(r['Avg commission %'] || '0').replace('%','')) / 100 || 0,
        status:          (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Channel Types': {
      table: 'channel_subtypes',
      key: r => `${(r['Type']||'').trim()}|${(r['Subtype']||'').trim()}`,
      keyColumn: null, // composite — handled specially
      composite: ['type_name', 'subtype_name'],
      fromRow: r => ({ type_name: (r['Type']||'').trim(), subtype_name: (r['Subtype']||'').trim() }),
      toFields: r => ({
        status: (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'OTAs': {
      table: 'otas',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Segments': {
      table: 'segments',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Booking Purposes': {
      table: 'booking_purposes',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Room Categories': {
      table: 'room_categories',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name: (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Rooms': {
      table: 'rooms',
      key: r => `${(r['Property']||'').trim()}|${(r['Room code']||'').trim()}`,
      keyColumn: null,
      composite: ['property_id', 'raw_value'],
      fromRow: r => ({ property_id: (r['Property']||'').trim(), raw_value: (r['Room code']||'').trim() }),
      toFields: r => ({
        display_name:  (r['Room name'] || '').trim() || (r['Room code'] || '').trim(),
        beds_per_room: parseInt(r['Beds']) || 1,
        status:        (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
      // category by name resolved at apply time
      categoryColumn: 'Category',
      noInsert: true, // rooms need property_uuid — only update existing
    },
    'Extras Categories': {
      table: 'extras_categories',
      key: r => (r['Category name'] || '').trim(),
      keyColumn: 'category_name',
      toFields: r => ({
        status: (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Extras': {
      table: 'extras_catalog',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        display_name:   (r['Display name'] || '').trim() || (r['Raw value (PMS)'] || '').trim(),
        category:       (r['Category'] || 'UNCATEGORISED').trim(),
        subcategory:    (r['Subcategory'] || '').trim() || null,
        default_amount: parseFloat(r['Default €']) || 0,
        charge_timing:  (r['Charge timing'] || 'during_stay').trim(),
        status:         (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    'Country Mapping': {
      table: 'client_country_mapping',
      key: r => (r['Raw value (PMS)'] || '').trim(),
      keyColumn: 'raw_value',
      toFields: r => ({
        country_code: (r['ISO country'] || '').trim().toUpperCase() || null,
        status:       (r['Status'] || 'active').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active',
      }),
    },
    // 'Market Groups' intentionally not importable (countries list is managed in the Markets tab)
  };

  function shallowDiff(existing, fields) {
    return Object.keys(fields).some(k => {
      const a = existing[k], b = fields[k];
      if (typeof b === 'number') return Math.abs((parseFloat(a) || 0) - b) > 1e-9;
      return String(a ?? '') !== String(b ?? '');
    });
  }

  // Parse workbook → plan of changes. Returns {sheets: [{name, inserts, updates, unchanged, skipped}]}
  async function buildPlan(workbook, companyId) {
    const plan = [];
    for (const [sheetName, cfg] of Object.entries(SHEETS)) {
      if (!workbook.SheetNames.includes(sheetName)) continue;
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
      const validRows = rows.filter(r => cfg.key(r));
      if (!validRows.length) continue;

      const { data: existing, error } = await sb.from(cfg.table).select('*').eq('company_id', companyId);
      if (error) { plan.push({ name: sheetName, error: error.message }); continue; }

      const byKey = new Map();
      (existing || []).forEach(e => {
        const k = cfg.composite
          ? cfg.composite.map(c => String(e[c] ?? '').trim()).join('|')
          : String(e[cfg.keyColumn] ?? '').trim();
        byKey.set(k.toLowerCase(), e);
      });

      const inserts = [], updates = [];
      let unchanged = 0;
      for (const r of validRows) {
        const k = cfg.key(r).toLowerCase();
        const match = byKey.get(k);
        const fields = cfg.toFields(r);
        if (!match) {
          if (cfg.noInsert) continue;
          inserts.push({ row: r, fields });
        } else if (shallowDiff(match, fields)) {
          updates.push({ id: match.id, row: r, fields, existing: match });
        } else {
          unchanged++;
        }
      }
      plan.push({ name: sheetName, cfg, inserts, updates, unchanged });
    }
    return plan;
  }

  async function applyPlan(plan, companyId) {
    const results = [];
    for (const sheet of plan) {
      if (sheet.error || (!sheet.inserts?.length && !sheet.updates?.length)) continue;
      const cfg = sheet.cfg;
      let ok = 0, failed = 0, firstError = null;

      // Resolve room categories by name once, if needed
      let catByName = null;
      if (cfg.categoryColumn) {
        const { data: cats } = await sb.from('room_categories')
          .select('id, raw_value, display_name').eq('company_id', companyId);
        catByName = new Map();
        (cats || []).forEach(c => {
          if (c.display_name) catByName.set(c.display_name.toLowerCase(), c.id);
          if (c.raw_value)    catByName.set(c.raw_value.toLowerCase(), c.id);
        });
      }

      for (const u of sheet.updates) {
        const fields = { ...u.fields, updated_at: new Date().toISOString() };
        if (catByName) {
          const catName = String(u.row[cfg.categoryColumn] || '').trim().toLowerCase();
          if (catName && catByName.has(catName)) fields.category_id = catByName.get(catName);
        }
        const { error } = await sb.from(cfg.table).update(fields).eq('id', u.id);
        if (error) { failed++; firstError = firstError || error.message; } else ok++;
      }
      for (const i of sheet.inserts) {
        const base = cfg.composite ? cfg.fromRow(i.row) : { [cfg.keyColumn]: cfg.key(i.row) };
        const { error } = await sb.from(cfg.table).insert({ company_id: companyId, ...base, ...i.fields });
        if (error) { failed++; firstError = firstError || error.message; } else ok++;
      }
      results.push({ name: sheet.name, ok, failed, firstError });
    }
    return results;
  }

  return { buildPlan, applyPlan };
})();
