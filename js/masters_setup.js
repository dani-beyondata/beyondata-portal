// masters_setup.js — upload a reservations export, find values missing
// from this company's master catalogs, add them with one click.
//
// BASIC VERSION SCOPE (intentional, to be extended later):
//   - CSV only (the gold ETL output is already CSV, no Excel parsing needed)
//   - one master only: booking_purposes
//   - the uploaded file is parsed in-browser and never sent anywhere except
//     the eventual Supabase insert for values you explicitly approve --
//     nothing is stored, no upload endpoint, the file is forgotten on
//     navigating away or re-uploading
//   - column to read is chosen by you from a dropdown, with a best-guess
//     preselection based on column name matching

const MastersSetup = (() => {

  // Maps a master table's key (as used in the <select>) to a best-guess
  // column name to preselect when that master is chosen. This is just a
  // convenience guess, not a contract -- the user can always pick a
  // different column.
  const COLUMN_GUESS = {
    booking_purposes: ['booking_purpose_id', 'booking_purpose', 'purpose'],
    segments: ['segment_id', 'segment'],
    client_country_mapping: ['client_country', 'country', 'nationality'],
    room_categories: ['room_category_raw', 'space_category', 'category', 'room_category'],
    rooms: ['room_code_raw', 'room_code', 'room_number'],
    extras_catalog: ['raw_value', 'product', 'extra', 'product_name'],
    channels: ['reservation_source', 'channel', 'source'],
    corporations: ['corporation', 'company', 'corporate', 'business'],
    otas: ['ota', 'travel_agency', 'travel agency'],
  };

  // Maps a master table's key to the matching logic needed to compare
  // distinct file values against existing master rows for this company.
  // Matching always happens against raw_value -- the literal text the
  // source file contains -- never against display_name, since display_name
  // is the cleaned-up label we choose to show in reports and may not match
  // the file's wording at all.
  //
  // actionType controls how "Add to master" is presented:
  //   'text'           -- free-text display name input (booking_purposes, segments)
  //   'country_select' -- a dropdown of real ISO countries (client_country_mapping),
  //                        since the target value must be a valid FK, not arbitrary text
  const MASTER_CONFIG = {
    booking_purposes: {
      table: 'booking_purposes',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('booking_purposes')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await BookingPurposes.create(companyId, {
          raw_value: rawValue,
          display_name: displayName,
        });
        if (error) throw error;
      },
    },
    segments: {
      table: 'segments',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('segments')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await Segments.create(companyId, {
          raw_value: rawValue,
          display_name: displayName,
        });
        if (error) throw error;
      },
    },
    client_country_mapping: {
      table: 'client_country_mapping',
      matchColumn: 'raw_value',
      actionType: 'country_select',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('client_country_mapping')
          .select('id, raw_value, country_code, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      // displayValue here is the chosen country_code, not free text
      async addValue(companyId, rawValue, countryCode) {
        const { error } = await ClientCountryMapping.create(companyId, {
          raw_value: rawValue,
          country_code: countryCode,
        });
        if (error) throw error;
      },
    },
    // room_categories: matches against space_category from the nights gold file.
    // NOTE: this uses the current DB schema (category_name as the match field,
    // no raw_value column yet). When room_categories is migrated to the
    // raw_value/display_name pattern (same as booking_purposes/segments),
    // switch matchColumn to 'raw_value' and update fetchExisting + addValue.
    room_categories: {
      table: 'room_categories',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('room_categories')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await sb.from('room_categories').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
          status: 'active',
        });
        if (error) throw error;
      },
    },
    // rooms: matches room_code_raw against rooms.raw_value. When adding,
    // looks up room_category_raw from the same file row and pre-assigns
    // category_id by matching against the registered room_categories.
    // The property_uuid is derived from the file's property_id column
    // matched against the company's registered properties.
    rooms: {
      table: 'rooms',
      matchColumn: 'raw_value',
      actionType: 'room',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('rooms')
          .select('id, raw_value, display_name, status, category_id')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName, extraFields) {
        // extraFields: { category_id, beds_per_room, property_uuid }
        // ALIAS RULE: if the display name matches an already-ACTIVE room of
        // the same property, this raw value is the SAME physical room sold
        // under another name -> create as an INACTIVE alias inheriting the
        // physical room's category (mapping only: adds no capacity, and the
        // Rooms list renders it locked under its physical room).
        const finalDisplay = displayName || rawValue;
        const { data: twins } = await sb.from('rooms')
          .select('id, display_name, category_id, status')
          .eq('company_id', companyId)
          .eq('property_uuid', extraFields?.property_uuid || null)
          .eq('status', 'active');
        const physical = (twins || []).find(t =>
          (t.display_name || '').trim().toLowerCase() === finalDisplay.trim().toLowerCase());
        if (physical) {
          const ok = confirm(
            `⚠ "${finalDisplay}" already exists as an ACTIVE physical room.\n\n` +
            `Adding "${rawValue}" under that name registers it as an ALIAS of the SAME room: ` +
            `it will map this raw value's sales onto "${finalDisplay}" and will NOT count as a ` +
            `different physical room (no own beds, no capacity).\n\n` +
            `Confirm it is the same room?`);
          if (!ok) throw new Error('Cancelled — nothing was added.');
        }
        const roomRow = {
          company_id: companyId,
          raw_value: rawValue,
          display_name: finalDisplay,
          category_id: physical ? physical.category_id : (extraFields?.category_id || null),
          beds_per_room: physical ? 0 : (extraFields?.beds_per_room || 1),
          property_uuid: extraFields?.property_uuid || null,
          property_id: extraFields?.property_id || null,
          status: physical ? 'alias' : 'active',
        };
        if (physical && window._roomsHasAliasCol !== false) roomRow.alias_of = physical.id;
        let { error } = await sb.from('rooms').insert(roomRow);
        if (error && physical && roomRow.alias_of) {
          // graceful pre-migration: retry without the column
          delete roomRow.alias_of;
          ({ error } = await sb.from('rooms').insert(roomRow));
        }
        if (error) throw error;
        if (physical && typeof Toast !== 'undefined') {
          Toast.success(`"${rawValue}" registered as an alias of "${finalDisplay}" (same physical room — maps sales, adds no capacity).`);
        }
      },
    },
    // extras_catalog: matches raw product names from extras_master.csv against
    // extras_catalog.raw_value. actionType 'extras' shows display name + category
    // inputs inline. Subcategory, timing, and amount are set in the Extras tab after.
    extras_catalog: {
      table: 'extras_catalog',
      matchColumn: 'raw_value',
      actionType: 'extras',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('extras_catalog')
          .select('id, raw_value, display_name, category, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName, extraFields) {
        const { error } = await sb.from('extras_catalog').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
          category: extraFields?.category,  // required — validated in the UI before calling
          charge_timing: 'during_stay',
          status: 'active',
        });
        if (error) throw error;
      },
    },
    // channels: matches reservation_source from reservations_clean.csv.
    // actionType 'channel' shows display name + channel_type + channel_subtype dropdowns.
    channels: {
      table: 'channels',
      matchColumn: 'raw_value',
      actionType: 'channel',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('channels')
          .select('id, raw_value, display_name, channel_type, channel_subtype, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName, extraFields) {
        const { error } = await sb.from('channels').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
          channel_type:    extraFields?.channel_type    || 'indirect',
          channel_subtype: extraFields?.channel_subtype || 'ota',
          rate_type:       extraFields?.rate_type       || 'gross',
          avg_cost_pct: 0,
          status: 'active',
        });
        if (error) throw error;
      },
    },
    // corporations: matches the corporation column (Mews "Company") from
    // reservations_clean.csv. Simple raw -> display mapping like otas.
    corporations: {
      table: 'corporations',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('corporations')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await sb.from('corporations').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
        });
        if (error) throw error;
      },
    },
    // otas: matches the ota column (Travel agency) from reservations_clean.csv.
    // Simple text add — just a display name mapping the legal entity name.
    otas: {
      table: 'otas',
      matchColumn: 'raw_value',
      actionType: 'text',
      async fetchExisting(companyId) {
        const { data, error } = await sb
          .from('otas')
          .select('id, raw_value, display_name, status')
          .eq('company_id', companyId);
        if (error) throw error;
        return data || [];
      },
      async addValue(companyId, rawValue, displayName) {
        const { error } = await sb.from('otas').insert({
          company_id: companyId,
          raw_value: rawValue,
          display_name: displayName || rawValue,
        });
        if (error) throw error;
      },
    },
  };

  let parsedRows = null;   // array of objects, one per CSV row
  let parsedHeaders = null;
  // Per-file-type memory: {rows, headers, filename, columnMap: {masterKey: column}}
  const parsedByType = {};

  // --- minimal CSV parser -------------------------------------------------
  // Handles the common cases pandas.to_csv() produces: comma-separated,
  // double-quote-wrapped fields containing commas, and "" as an escaped
  // quote inside a quoted field. Not a general-purpose RFC4180 parser, but
  // sufficient for our own ETL output.
  // Auto-load the gold ETL outputs from the Supabase `gold` bucket for the
  // current company, populating parsedByType exactly as a manual upload would.
  // Gold file → file-type mapping (entity name = our internal file type key).
  const GOLD_BUCKET = 'gold';
  const GOLD_FILES = {
    reservations: 'reservations_clean.csv',
    nights:       'nights_clean.csv',
    extras:       'extras_master.csv',
  };

  async function firstPropertyId() {
    // gold path is client/property/<file>; we need the property code.
    const { data } = await sb.from('properties')
      .select('property_id').eq('company_id', currentCompany.id)
      .order('property_id').limit(1);
    return data?.[0]?.property_id || null;
  }

  function clientCode() {
    return (currentCompany.slug || currentCompany.name || 'client')
      .toString().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  async function loadFromGold() {
    const pcode = await firstPropertyId();
    if (!pcode) { UI.showAlert('ms-file-error', 'No property found for this company.'); return; }
    const code = clientCode();
    let loadedAny = false;
    const diag = [];

    for (const [fileType, fname] of Object.entries(GOLD_FILES)) {
      const path = `${code}/${pcode}/${fname}`;
      try {
        const { data, error } = await sb.storage.from(GOLD_BUCKET).download(path);
        if (error) { diag.push(`${fname}: ${error.message}`); continue; }
        if (!data) { diag.push(`${fname}: no data`); continue; }
        const text = await data.text();
        const { headers, records } = parseCSV(text);
        if (!headers.length) { diag.push(`${fname}: empty/no columns`); continue; }
        const columnMap = {};
        (MASTERS_BY_FILE_TYPE[fileType] || []).forEach(m => {
          columnMap[m.value] = guessColumn(m.value, headers) || '';
        });
        parsedByType[fileType] = { rows: records, headers, filename: fname, columnMap, fromGold: true };
        loadedAny = true;
      } catch (e) {
        diag.push(`${fname}: ${e.message || e}`);
      }
    }

    renderMemoryBar();
    if (!loadedAny) {
      UI.showAlert('ms-file-error',
        `Could not load gold files from path "${code}/${pcode}/". Details: ${diag.join(' · ') || 'none found'}`);
    } else {
      UI.hideAlert('ms-file-error');
    }
    return loadedAny;
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; }
        } else {
          field += c;
        }
      } else {
        if (c === '"') { inQuotes = true; }
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') {
          if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
          row = []; field = '';
        } else if (c === '\r') { /* skip, \n handles the newline */ }
        else { field += c; }
      }
    }
    if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

    if (rows.length === 0) return { headers: [], records: [] };
    const headers = rows[0];
    const records = rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] !== undefined ? r[idx] : ''; });
      return obj;
    });
    return { headers, records };
  }

  function guessColumn(masterKey, headers) {
    const guesses = COLUMN_GUESS[masterKey] || [];
    for (const g of guesses) {
      const hit = headers.find(h => h.toLowerCase() === g.toLowerCase());
      if (hit) return hit;
    }
    return headers[0] || null;
  }

  function computeDistinctValues(records, column) {
    const counts = new Map();
    for (const r of records) {
      let v = r[column];
      if (v === undefined || v === null) v = '';
      v = String(v).trim();
      if (v === '' || v.toLowerCase() === 'nan') continue; // skip blank/NaN
      // Pre-aggregated files (extras_master.csv) carry an occurrences column:
      // weight by it so the count shown is real usage, not "1" per row.
      const weight = ('occurrences' in r && !isNaN(Number(r['occurrences']))) ? Number(r['occurrences']) : 1;
      counts.set(v, (counts.get(v) || 0) + weight);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]); // most frequent first
  }

  // First-pass country guess: exact name match first, then "one name
  // contains the other" as a looser fallback (catches cases like
  // "United States of America" containing "united states"). This is
  // intentionally simple -- it only pre-selects a suggestion in the
  // dropdown, never auto-saves, so a wrong guess costs nothing beyond
  // picking a different option before clicking Add.
  function guessCountryCode(rawValue, countryOptions) {
    const needle = rawValue.toLowerCase().trim();
    const exact = countryOptions.find(c => c.country_name.toLowerCase().trim() === needle);
    if (exact) return exact.country_code;

    const contains = countryOptions.find(c => {
      const name = c.country_name.toLowerCase().trim();
      return needle.includes(name) || name.includes(needle);
    });
    if (contains) return contains.country_code;

    return null;
  }

  // Embedded categories grid: when curating channels or extras, the
  // relevant categories master (channel_subtypes / extras_categories) is
  // shown right here -- view, add (full fields), activate/deactivate --
  // so the review flow never has to leave the page. Mirrors the dedicated
  // sections' capabilities using their same CRUD helpers.
  async function renderCategoriesPanel(masterKey, column, actionType) {
    const panel = document.getElementById('ms-categories-panel');
    if (!panel) return;
    if (actionType !== 'extras' && actionType !== 'channel') {
      panel.style.display = 'none'; panel.innerHTML = ''; return;
    }
    panel.style.display = 'block';

    const rerender = () => renderResults(masterKey, column);

    if (actionType === 'extras') {
      const { data } = await ExtrasCategories.getByCompany(currentCompany.id);
      const cats = data || [];
      panel.innerHTML = `
        <div class="ms-cat-head"><strong>Extras categories master</strong>
          <span style="color:var(--text-muted);font-size:0.8rem">${cats.length} categor${cats.length === 1 ? 'y' : 'ies'} — required before adding extras</span></div>
        <table class="ms-cat-table">
          <thead><tr><th>Category</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${cats.map(c => `<tr>
              <td>${escapeHtml(c.category_name)}</td>
              <td><span class="badge" style="background:${c.status === 'active' ? '#d1fae5;color:#065f46' : '#f1f5f9;color:#64748b'}">${c.status}</span></td>
              <td><button class="btn btn-secondary btn-sm" data-cat-toggle="${escapeAttr(c.id)}" data-cat-status="${escapeAttr(c.status)}">${c.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
            </tr>`).join('') || '<tr><td colspan="3" style="color:var(--text-muted)">No categories yet — add the first one below.</td></tr>'}
          </tbody>
        </table>
        <div class="ms-cat-addrow">
          <input type="text" id="ms-newcat-name" placeholder="New category name (e.g. BREAKFAST, TAXES)"
                 style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:260px">
          <button class="btn btn-primary btn-sm" id="ms-newcat-add">+ Add category</button>
        </div>`;

      panel.querySelector('#ms-newcat-add').addEventListener('click', async () => {
        const nameEl = panel.querySelector('#ms-newcat-name');
        const name = nameEl.value.trim().toUpperCase();
        if (!name) { nameEl.style.borderColor = '#dc2626'; return; }
        const { error } = await ExtrasCategories.create(currentCompany.id, name);
        if (error) { UI.showAlert('ms-file-error', `Could not create category: ${error.message}`); return; }
        rerender();
      });
      panel.querySelectorAll('button[data-cat-toggle]').forEach(b => b.addEventListener('click', async () => {
        await ExtrasCategories.toggle(b.dataset.catToggle, b.dataset.catStatus);
        rerender();
      }));
      return;
    }

    // channels: channel_subtypes master (type + subtype pairs)
    const { data } = await ChannelSubtypes.getByCompany(currentCompany.id);
    const subs = data || [];
    const types = [...new Set(subs.map(x => x.type_name))].sort();
    panel.innerHTML = `
      <div class="ms-cat-head"><strong>Channel types &amp; subtypes master</strong>
        <span style="color:var(--text-muted);font-size:0.8rem">${subs.length} subtype${subs.length === 1 ? '' : 's'} — each channel needs a type + subtype</span></div>
      <table class="ms-cat-table">
        <thead><tr><th>Type</th><th>Subtype</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${subs.map(x => `<tr>
            <td>${escapeHtml(x.type_name)}</td>
            <td>${escapeHtml(x.subtype_name)}</td>
            <td><span class="badge" style="background:${x.status === 'active' ? '#d1fae5;color:#065f46' : '#f1f5f9;color:#64748b'}">${x.status}</span></td>
            <td><button class="btn btn-secondary btn-sm" data-cat-toggle="${escapeAttr(x.id)}" data-cat-status="${escapeAttr(x.status)}">${x.status === 'active' ? 'Deactivate' : 'Activate'}</button></td>
          </tr>`).join('') || '<tr><td colspan="4" style="color:var(--text-muted)">No types/subtypes yet — add the first one below.</td></tr>'}
        </tbody>
      </table>
      <div class="ms-cat-addrow">
        <select id="ms-newsub-type" style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px">
          <option value="">— Existing type —</option>
          ${types.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('')}
        </select>
        <span style="color:var(--text-muted);font-size:0.8rem">or new type</span>
        <input type="text" id="ms-newsub-typenew" placeholder="e.g. direct, indirect"
               style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:140px">
        <input type="text" id="ms-newsub-name" placeholder="Subtype name (e.g. ota, gds, walk-in)"
               style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:200px">
        <button class="btn btn-primary btn-sm" id="ms-newsub-add">+ Add subtype</button>
      </div>`;

    panel.querySelector('#ms-newsub-add').addEventListener('click', async () => {
      const typeName = panel.querySelector('#ms-newsub-typenew').value.trim()
        || panel.querySelector('#ms-newsub-type').value;
      const subName = panel.querySelector('#ms-newsub-name').value.trim();
      if (!typeName || !subName) {
        if (!typeName) panel.querySelector('#ms-newsub-typenew').style.borderColor = '#dc2626';
        if (!subName) panel.querySelector('#ms-newsub-name').style.borderColor = '#dc2626';
        return;
      }
      const { error } = await ChannelSubtypes.create(currentCompany.id, typeName, subName);
      if (error) { UI.showAlert('ms-file-error', `Could not create subtype: ${error.message}`); return; }
      rerender();
    });
    panel.querySelectorAll('button[data-cat-toggle]').forEach(b => b.addEventListener('click', async () => {
      await ChannelSubtypes.toggle(b.dataset.catToggle, b.dataset.catStatus);
      rerender();
    }));
  }

  async function renderResults(masterKey, column) {
    const tbody = document.getElementById('ms-results-tbody');
    UI.tableLoading('ms-results-tbody', 4);

    const config = MASTER_CONFIG[masterKey];
    await renderCategoriesPanel(masterKey, column, config.actionType);
    const distinct = computeDistinctValues(parsedRows, column);

    let existing;
    try {
      existing = await config.fetchExisting(currentCompany.id);
    } catch (e) {
      UI.tableEmpty('ms-results-tbody', 4, `Error loading existing master data: ${e.message}`);
      return;
    }

    // Only fetch the countries list when actually needed (country_select type)
    let countryOptions = [];
    if (config.actionType === 'country_select') {
      const { data, error } = await Countries.getAll();
      if (error) {
        UI.tableEmpty('ms-results-tbody', 4, `Error loading countries list: ${error.message}`);
        return;
      }
      // getAll() orders by continent (for the Countries page); for a flat
      // dropdown alphabetical by name is what the eye expects.
      countryOptions = (data || []).slice().sort((a, b) =>
        String(a.country_name).localeCompare(String(b.country_name)));
    }

    // For extras: fetch registered categories for the dropdown
    let extrasCategories = [];
    if (config.actionType === 'extras') {
      const { data: cats } = await sb.from('extras_categories')
        .select('id, category_name')
        .eq('company_id', currentCompany.id)
        .eq('status', 'active')
        .order('category_name');
      extrasCategories = cats || [];
    }

    // For channels: fetch registered subtypes grouped by type
    let channelSubtypes = [];
    if (config.actionType === 'channel') {
      const { data: subs } = await sb.from('channel_subtypes')
        .select('type_name, subtype_name')
        .eq('company_id', currentCompany.id)
        .eq('status', 'active')
        .order('type_name').order('subtype_name');
      channelSubtypes = subs || [];
    }
    // beds_per_room_derived, property_id} from the parsed file rows, so we
    // can show a pre-assigned category suggestion for each room.
    let roomInfoMap = new Map();
    let registeredCategories = [];
    let propertyUuidMap = new Map(); // property_id string -> property UUID
    if (config.actionType === 'room') {
      parsedRows.forEach(r => {
        const name = String(r['room_code_raw'] || '').trim();
        if (name && !roomInfoMap.has(name)) {
          roomInfoMap.set(name, {
            room_category_raw: String(r['room_category_raw'] || '').trim(),
            beds_per_room: parseInt(r['beds_per_room_derived']) || 1,
            property_id: String(r['property_id'] || '').trim(),
          });
        }
      });
      // Fetch registered room_categories to resolve category_id
      const { data: cats } = await sb.from('room_categories')
        .select('id, raw_value, display_name').eq('company_id', currentCompany.id);
      registeredCategories = cats || [];
      // Fetch registered properties to resolve property_uuid
      const { data: props } = await sb.from('properties')
        .select('id, property_id').eq('company_id', currentCompany.id);
      (props || []).forEach(p => propertyUuidMap.set(p.property_id, p.id));
    }

    const existingByValue = new Map(
      existing.map(r => [String(r[config.matchColumn]).toLowerCase().trim(), r])
    );

    // A value is "resolved" if it has a match that's both active and
    // actually complete (a country mapping with no country_code yet is
    // not resolved, even though a row technically exists for it).
    function isResolved(value) {
      const match = existingByValue.get(value.toLowerCase().trim());
      if (!match) return false;
      if (config.actionType === 'country_select') {
        return !!match.country_code && match.status === 'active';
      }
      return match.status === 'active';
    }

    const showUnresolvedOnly = document.getElementById('ms-unresolved-only')?.checked;
    const visibleDistinct = showUnresolvedOnly
      ? distinct.filter(([value]) => !isResolved(value))
      : distinct;

    document.getElementById('ms-results-count').textContent = showUnresolvedOnly
      ? `3. Review distinct values (${visibleDistinct.length} unresolved of ${distinct.length} found in file)`
      : `3. Review distinct values (${distinct.length} found in file)`;

    if (distinct.length === 0) {
      UI.tableEmpty('ms-results-tbody', 4, 'No non-blank values found in that column.');
      return;
    }
    if (visibleDistinct.length === 0) {
      UI.tableEmpty('ms-results-tbody', 4, 'Nothing unresolved -- every value in this file is already mapped.');
      return;
    }

    function buildCountryOptionsHtml(guessedCode) {
      return countryOptions.map(c =>
        `<option value="${escapeAttr(c.country_code)}" ${c.country_code === guessedCode ? 'selected' : ''}>${escapeHtml(c.country_name)} (${c.country_code})</option>`
      ).join('');
    }

    tbody.innerHTML = visibleDistinct.map(([value, count]) => {
      const match = existingByValue.get(value.toLowerCase().trim());
      let statusHtml, actionHtml;

      if (!match) {
        statusHtml = `<span class="badge" style="background:#fef3c7;color:#92400e">Not in master</span>`;

        if (config.actionType === 'country_select') {
          // The matched value must be a real ISO code (FK constraint), so
          // this is a dropdown of actual countries, never free text. We
          // pre-select a best-guess match by name so the common case
          // (raw value already looks like a country name) just needs a
          // confirming click, but the guess is never auto-saved.
          const guessedCode = guessCountryCode(value, countryOptions);
          const guessedCountry = countryOptions.find(c => c.country_code === guessedCode);
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center">
              <select data-role="country-select" data-value="${escapeAttr(value)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:200px">
                <option value="" ${guessedCode ? '' : 'selected'}>Select country...</option>
                ${buildCountryOptionsHtml(guessedCode)}
              </select>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
              ${guessedCountry ? `<span style="color:var(--text-muted);font-size:0.8rem">suggested</span>` : ''}
            </div>`;
        } else if (config.actionType === 'room') {
          // Pre-assign category from the file's room_category_raw column,
          // matched against registered room_categories. Show the suggested
          // category and beds count derived from the file, plus a display
          // name input. User just confirms and clicks Add.
          const info = roomInfoMap.get(value) || {};
          const suggestedCat = registeredCategories.find(
            c => c.raw_value === info.room_category_raw
          );
          const catLabel = suggestedCat
            ? `<span style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(suggestedCat.display_name || suggestedCat.raw_value)}</span>`
            : `<span style="font-size:0.8rem;color:#dc2626">Category not registered yet</span>`;
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
              <input type="text" placeholder="Display name"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     data-category-id="${escapeAttr(suggestedCat?.id || '')}"
                     data-beds="${info.beds_per_room || 1}"
                     data-property-id="${escapeAttr(info.property_id || '')}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:150px"
                     value="${escapeAttr(value)}">
              ${catLabel}
              <span style="font-size:0.8rem;color:var(--text-muted)">${info.beds_per_room || 1} bed(s)</span>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        } else if (config.actionType === 'extras') {
          // A real category is REQUIRED: no UNCATEGORISED fallback. If none
          // exist yet, the select shows a disabled hint and the "+ New"
          // button creates one inline (extras_categories insert) and
          // re-renders with it available everywhere.
          const catOptions = extrasCategories.length
            ? '<option value="">Category...</option>' + extrasCategories.map(c => `<option value="${escapeAttr(c.category_name)}">${escapeHtml(c.category_name)}</option>`).join('')
            : '<option value="" selected>No categories yet — create one above ↑</option>';
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
              <input type="text" placeholder="Display name"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:150px"
                     value="${escapeAttr(value)}">
              <select data-role="extra-category" data-value="${escapeAttr(value)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px">
                ${catOptions}
              </select>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        } else if (config.actionType === 'channel') {
          const types = [...new Set(channelSubtypes.map(s => s.type_name))].sort();
          const typeOptions = types.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join('');
          // Build subtype options as data attribute for dynamic filtering
          const subtypesJson = escapeAttr(JSON.stringify(channelSubtypes));
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap">
              <input type="text" placeholder="Display name"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:130px"
                     value="${escapeAttr(value)}">
              <select data-role="channel-type" data-value="${escapeAttr(value)}" data-subtypes="${subtypesJson}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px"
                      onchange="msFillSubtypes(this)">
                <option value="">Type...</option>
                ${typeOptions}
              </select>
              <select data-role="channel-subtype" data-value="${escapeAttr(value)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px">
                <option value="">Subtype...</option>
              </select>
              <select data-role="channel-rate-type" data-value="${escapeAttr(value)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px">
                <option value="gross">Gross</option>
                <option value="net">Net</option>
              </select>
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        } else {
          // Smart prefill: drop a trailing parenthesized token (CIF, codes)
          // — "Travelsens, S.L (B57727901)" -> "Travelsens, S.L". Editable.
          const prefill = String(value).replace(/\s*\([^()]*\)\s*$/, '').trim();
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center">
              <input type="text" placeholder="Display name"
                     data-role="display-name-input" data-value="${escapeAttr(value)}"
                     value="${escapeAttr(prefill)}"
                     style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;flex:1;min-width:220px;max-width:340px">
              <button class="btn btn-primary btn-sm" data-action="add" data-value="${escapeAttr(value)}">+ Add</button>
            </div>`;
        }
      } else if (config.actionType === 'country_select') {
        // A row needs attention if it has no country_code yet, OR it was
        // previously deactivated (e.g. fixed in the Markets tab after a
        // mismapping) -- both cases route back into the resolve flow.
        if (!match.country_code || match.status !== 'active') {
          statusHtml = match.status !== 'active'
            ? `<span class="badge" style="background:#fee2e2;color:#991b1b">Inactive -- needs review</span>`
            : `<span class="badge" style="background:#fef3c7;color:#92400e">Seen, not resolved</span>`;
          const guessedCode = guessCountryCode(value, countryOptions);
          actionHtml = `
            <div style="display:flex;gap:0.4rem;align-items:center">
              <select data-role="country-select" data-value="${escapeAttr(value)}" data-existing-id="${escapeAttr(match.id)}"
                      style="font-size:0.85rem;padding:0.3rem 0.5rem;border:1px solid var(--border,#ccc);border-radius:4px;width:200px">
                <option value="" ${guessedCode ? '' : 'selected'}>Select country...</option>
                ${buildCountryOptionsHtml(guessedCode)}
              </select>
              <button class="btn btn-primary btn-sm" data-action="resolve" data-value="${escapeAttr(value)}" data-existing-id="${escapeAttr(match.id)}">+ Save</button>
            </div>`;
        } else {
          const countryLabel = countryOptions.find(c => c.country_code === match.country_code);
          statusHtml = `<span class="badge" style="background:#d1fae5;color:#065f46">Mapped</span>`;
          actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">${countryLabel ? escapeHtml(countryLabel.country_name) : match.country_code}</span>`;
        }
      } else if (match.status !== 'active') {
        // Rooms: an inactive row whose display matches an ACTIVE room is an
        // ALIAS of the same physical room — correct state, nothing to do.
        const aliasOf = masterKey === 'rooms' && match.display_name
          ? existing.find(e => e.id !== match.id && e.status === 'active' &&
              (e.display_name || '').trim().toLowerCase() === (match.display_name || '').trim().toLowerCase())
          : null;
        if (aliasOf) {
          statusHtml = `<span class="badge" style="background:#e0e7ff;color:#4338ca">Alias ✓</span>`;
          actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">Same physical room as <b>${escapeHtml(aliasOf.display_name)}</b> — maps its sales. Nothing to do.</span>`;
        } else {
          statusHtml = `<span class="badge" style="background:#fee2e2;color:#991b1b">Exists, inactive</span>`;
          actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">Reactivate from the ${masterKey.replace('_',' ')} section</span>`;
        }
      } else {
        statusHtml = `<span class="badge" style="background:#d1fae5;color:#065f46">Active in master</span>`;
        const extraInfo = config.actionType === 'extras' && match.category
          ? ` · ${escapeHtml(match.category)}`
          : '';
        actionHtml = `<span style="color:var(--text-muted);font-size:0.85rem">Shown as "${escapeHtml(match.display_name)}"${extraInfo}</span>`;
      }

      return `
        <tr>
          <td style="max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeAttr(value)}">${escapeHtml(value)}</td>
          <td style="white-space:nowrap">${count}</td>
          <td style="white-space:nowrap">${statusHtml}</td>
          <td style="min-width:320px">${actionHtml}</td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-action="add"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const value = btn.getAttribute('data-value');
        const row = btn.closest('tr');

        let secondValue;
        let inputEl;
        let extraFields = null;
        if (config.actionType === 'country_select') {
          inputEl = row.querySelector('select[data-role="country-select"]');
          secondValue = inputEl.value;
          if (!secondValue) {
            inputEl.style.borderColor = '#dc2626';
            return;
          }
        } else {
          inputEl = row.querySelector('input[data-role="display-name-input"]');
          secondValue = inputEl.value.trim();
          if (!secondValue) {
            inputEl.style.borderColor = '#dc2626';
            inputEl.placeholder = 'Required before adding';
            return;
          }
          // For rooms, pass the pre-assigned category, beds, and property
          if (config.actionType === 'room') {
            extraFields = {
              category_id: inputEl.dataset.categoryId || null,
              beds_per_room: parseInt(inputEl.dataset.beds) || 1,
              property_id: inputEl.dataset.propertyId || null,
              property_uuid: propertyUuidMap.get(inputEl.dataset.propertyId) || null,
            };
          } else if (config.actionType === 'extras') {
            const catEl = row.querySelector('select[data-role="extra-category"]');
            if (!catEl?.value) {
              catEl.style.borderColor = '#dc2626';
              return; // a real category is required — no UNCATEGORISED shortcut
            }
            extraFields = { category: catEl.value };
          } else if (config.actionType === 'channel') {
            const typeEl      = row.querySelector('select[data-role="channel-type"]');
            const subtypeEl   = row.querySelector('select[data-role="channel-subtype"]');
            const rateTypeEl  = row.querySelector('select[data-role="channel-rate-type"]');
            extraFields = {
              channel_type:    typeEl?.value    || '',
              channel_subtype: subtypeEl?.value || '',
              rate_type:       rateTypeEl?.value || 'gross',
            };
            if (!extraFields.channel_type || !extraFields.channel_subtype) {
              typeEl.style.borderColor    = extraFields.channel_type    ? '' : '#dc2626';
              subtypeEl.style.borderColor = extraFields.channel_subtype ? '' : '#dc2626';
              return;
            }
          }
        }

        btn.disabled = true;
        inputEl.disabled = true;
        btn.textContent = 'Adding...';
        try {
          await config.addValue(currentCompany.id, value, secondValue, extraFields);
          await renderResults(masterKey, column); // refresh full table to reflect new state
          updateMemoryCounts(); // refresh card badges & traffic lights
        } catch (e) {
          UI.showAlert('ms-file-error', `Could not add "${value}": ${e.message}`);
          btn.disabled = false;
          inputEl.disabled = false;
          btn.textContent = '+ Add';
        }
      });
    });

    // Bulk add: process every visible row whose inputs are already complete
    // (suggested country selected, display name + category/type filled...).
    // Incomplete rows are skipped and reported, never guessed.
    const bulkBtn = document.getElementById('ms-bulk-add');
    if (bulkBtn) {
      const bulkClone = bulkBtn.cloneNode(true); // drop stale listeners from previous renders
      bulkBtn.replaceWith(bulkClone);
      bulkClone.style.display = '';
      bulkClone.disabled = false;
      bulkClone.textContent = '＋ Add all ready';
      bulkClone.addEventListener('click', async () => {
        const rows = [...tbody.querySelectorAll('tr')];
        const ready = [];
        const aliasSkipped = [];
        for (const row of rows) {
          const addBtn = row.querySelector('button[data-action="add"], button[data-action="resolve"]');
          if (!addBtn || addBtn.disabled) continue;
          const value = addBtn.getAttribute('data-value');
          const action = addBtn.getAttribute('data-action');

          if (config.actionType === 'country_select') {
            const sel = row.querySelector('select[data-role="country-select"]');
            if (sel?.value) ready.push({ action, value, second: sel.value,
              existingId: addBtn.getAttribute('data-existing-id') });
            continue;
          }
          const nameEl = row.querySelector('input[data-role="display-name-input"]');
          const name = nameEl?.value.trim();
          if (!name) continue;
          if (config.actionType === 'extras') {
            const cat = row.querySelector('select[data-role="extra-category"]')?.value;
            if (cat) ready.push({ action, value, second: name, extraFields: { category: cat } });
          } else if (config.actionType === 'channel') {
            const t = row.querySelector('select[data-role="channel-type"]')?.value;
            const st = row.querySelector('select[data-role="channel-subtype"]')?.value;
            const rt = row.querySelector('select[data-role="channel-rate-type"]')?.value || 'gross';
            if (t && st) ready.push({ action, value, second: name,
              extraFields: { channel_type: t, channel_subtype: st, rate_type: rt } });
          } else if (config.actionType === 'room') {
            // Alias candidates are EXCLUDED from bulk: creating an alias is a
            // conscious decision (same physical room) -> individual + Add only.
            const isAliasCandidate = existing.some(e => e.status === 'active' &&
              (e.display_name || '').trim().toLowerCase() === name.trim().toLowerCase());
            if (isAliasCandidate) { aliasSkipped.push(value); continue; }
            ready.push({ action, value, second: name, extraFields: {
              category_id: nameEl.dataset.categoryId || null,
              beds_per_room: parseInt(nameEl.dataset.beds) || 1,
              property_id: nameEl.dataset.propertyId || null,
              property_uuid: propertyUuidMap.get(nameEl.dataset.propertyId) || null,
            }});
          } else {
            ready.push({ action, value, second: name });
          }
        }

        if (!ready.length) {
          UI.showAlert('ms-file-error', aliasSkipped.length
            ? `Nothing bulk-addable: ${aliasSkipped.length} row(s) look like ALIASES of existing rooms (${aliasSkipped.join(', ')}) — add those individually with + Add to confirm each one.`
            : 'No rows are ready — fill in the missing selections first.');
          return;
        }
        if (!confirm(`Add ${ready.length} value(s) to the master in one go?`)) return;

        bulkClone.disabled = true;
        let done = 0, failed = 0;
        for (const item of ready) {
          bulkClone.textContent = `Adding ${done + failed + 1}/${ready.length}…`;
          try {
            if (item.action === 'resolve') {
              const { error } = await ClientCountryMapping.update(item.existingId,
                { country_code: item.second, status: 'active' });
              if (error) throw error;
            } else {
              await config.addValue(currentCompany.id, item.value, item.second, item.extraFields || null);
            }
            done++;
          } catch (e) { failed++; if (!window._msFirstBulkError) window._msFirstBulkError = e.message || String(e); }
        }
        const skipped = rows.length - ready.length - aliasSkipped.length;
        const firstErr = window._msFirstBulkError; window._msFirstBulkError = null;
        UI.showAlert('ms-file-error',
          `Bulk add finished: ${done} added${failed ? `, ${failed} failed — first error: "${firstErr}"` : ''}${skipped > 0 ? `, ${skipped} skipped (incomplete)` : ''}` +
          (aliasSkipped.length ? `, ${aliasSkipped.length} excluded as possible ALIASES (${aliasSkipped.join(', ')}) — add those individually with + Add.` : '') + '.');
        await renderResults(masterKey, column);
        updateMemoryCounts();
      });
    }

    // "resolve" handles the case where a raw_value row already exists
    // (seen before, e.g. inserted with no country_code) and just needs its
    // country_code filled in via update rather than a fresh insert.
    tbody.querySelectorAll('button[data-action="resolve"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const existingId = btn.getAttribute('data-existing-id');
        const row = btn.closest('tr');
        const select = row.querySelector('select[data-role="country-select"]');
        const countryCode = select.value;
        if (!countryCode) {
          select.style.borderColor = '#dc2626';
          return;
        }
        btn.disabled = true;
        select.disabled = true;
        btn.textContent = 'Saving...';
        try {
          const { error } = await ClientCountryMapping.update(existingId, { country_code: countryCode, status: 'active' });
          if (error) throw error;
          await renderResults(masterKey, column);
        } catch (e) {
          UI.showAlert('ms-file-error', `Could not save: ${e.message}`);
          btn.disabled = false;
          select.disabled = false;
          btn.textContent = '+ Save';
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  // --- property pre-check --------------------------------------------------
  // The gold ETL output always stamps a property_id column on every row
  // (from the filename, not from anything the user picks). If that code
  // isn't already a registered property for this company, the rest of
  // Masters Setup doesn't make sense to run yet -- block and offer to add
  // the property first, reusing the existing Properties tab's add-property
  // modal rather than building a second one.
  async function checkProperties(records) {
    const banner = document.getElementById('ms-property-banner');
    banner.style.display = 'none';
    banner.innerHTML = '';

    if (!records.some(r => 'property_id' in r)) return true; // no such column, nothing to check

    const fileCodes = new Set(
      records.map(r => String(r['property_id'] || '').trim()).filter(Boolean)
    );
    if (fileCodes.size === 0) return true;

    const { data, error } = await Properties.getByCompany(currentCompany.id);
    if (error) {
      UI.showAlert('ms-file-error', `Could not check properties: ${error.message}`);
      return false;
    }
    const existingCodes = new Set((data || []).map(p => p.property_id));
    const missing = [...fileCodes].filter(code => !existingCodes.has(code));

    if (missing.length === 0) return true;

    banner.style.display = 'block';
    banner.innerHTML = `
      <div class="alert error show" style="margin-bottom:1rem">
        This file references ${missing.length} property code(s) not yet registered for this company:
        ${missing.map(escapeHtml).join(', ')}.
        Add the missing property before reviewing master values below.
      </div>
      <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem">
        ${missing.map(code => `
          <button class="btn btn-primary btn-sm" data-action="add-property" data-code="${escapeAttr(code)}">
            + Add property "${escapeHtml(code)}"
          </button>
        `).join('')}
      </div>`;

    banner.querySelectorAll('button[data-action="add-property"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.getAttribute('data-code');
        document.getElementById('prop-id').value = code;
        document.getElementById('prop-name').value = '';
        document.getElementById('prop-city').value = '';
        document.getElementById('prop-country').value = '';
        document.getElementById('prop-rooms').value = '';
        document.getElementById('prop-beds').value = '';
        UI.hideAlert('prop-error');
        UI.openModal('modal-property');
      });
    });

    return false;
  }

  // Re-run the property check after the Add Property modal saves, since the
  // existing handler in dashboard.html doesn't know Masters Setup exists.
  // We don't touch that handler -- instead, watch for the modal closing and
  // re-check from here, which keeps the two features decoupled.
  function watchPropertyModalClose() {
    const modal = document.getElementById('modal-property');
    if (!modal || modal._msWatched) return;
    modal._msWatched = true;
    const observer = new MutationObserver(() => {
      const isOpen = modal.classList.contains('show');
      if (!isOpen && parsedRows) {
        checkProperties(parsedRows).then(ok => {
          if (ok) {
            document.getElementById('ms-after-upload').style.display = 'block';
            const masterSelect = document.getElementById('ms-master-select');
            const columnSelect = document.getElementById('ms-column-select');
            renderResults(masterSelect.value, columnSelect.value);
          }
        });
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }

  function handleFileSelected(file) {
    UI.hideAlert('ms-file-error');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      UI.showAlert('ms-file-error', 'Please upload a .csv file (this first version does not read .xlsx directly).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const { headers, records } = parseCSV(e.target.result);
      if (headers.length === 0) {
        UI.showAlert('ms-file-error', 'Could not find any columns in this file.');
        return;
      }
      parsedHeaders = headers;
      parsedRows = records;

      // Remember this file for its file type, with auto-guessed column mapping
      const columnMap = {};
      (MASTERS_BY_FILE_TYPE[currentFileType] || []).forEach(m => {
        columnMap[m.value] = guessColumn(m.value, headers) || '';
      });
      parsedByType[currentFileType] = { rows: records, headers, filename: file.name, columnMap };
      renderMemoryBar();

      watchPropertyModalClose();
      const propertiesOk = await checkProperties(records);
      if (!propertiesOk) {
        document.getElementById('ms-after-upload').style.display = 'none';
        return; // block here until the missing property is added
      }

      const masterSelect = document.getElementById('ms-master-select');
      const columnSelect = document.getElementById('ms-column-select');
      columnSelect.innerHTML = headers.map(h => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');

      const guessed = guessColumn(masterSelect.value, headers);
      if (guessed) columnSelect.value = guessed;
      document.getElementById('ms-column-hint').textContent =
        guessed ? `Preselected "${guessed}" as the likely match for this master.` : '';

      document.getElementById('ms-after-upload').style.display = 'block';
      renderResults(masterSelect.value, columnSelect.value);
    };
    reader.onerror = () => UI.showAlert('ms-file-error', 'Could not read the file.');
    reader.readAsText(file);
  }

  // Masters available per file type.
  // 'reservations' file: booking_purposes, segments, client_country_mapping
  // 'nights' file: room_categories (space_category column)
  const MASTERS_BY_FILE_TYPE = {
    reservations: [
      { value: 'booking_purposes',       label: 'Booking Purposes' },
      { value: 'segments',               label: 'Segments' },
      { value: 'client_country_mapping', label: 'Client Country Mapping' },
      { value: 'channels',               label: 'Channels' },
      { value: 'otas',                   label: 'OTAs' },
      { value: 'corporations',           label: 'Corporations' },
    ],
    nights: [
      { value: 'room_categories', label: 'Room Categories' },
      { value: 'rooms',           label: 'Rooms' },
    ],
    extras: [
      { value: 'extras_catalog', label: 'Extras' },
    ],
  };

  let currentFileType = 'reservations';

  function init() {
    const fileInput = document.getElementById('ms-file-input');
    const masterSelect = document.getElementById('ms-master-select');
    const columnSelect = document.getElementById('ms-column-select');

    // Reset visible state every time the section loads, since we never
    // persist the uploaded file -- re-entering this tab should feel like
    // starting fresh, not silently keeping stale data around.
    parsedRows = null;
    parsedHeaders = null;
    fileInput.value = '';
    currentFileType = 'reservations';
    document.getElementById('ms-after-upload').style.display = 'none';
    document.getElementById('ms-property-banner').style.display = 'none';
    document.getElementById('ms-unresolved-only').checked = false;
    document.getElementById('ms-upload-label').textContent = '1. Upload reservations file';
    document.getElementById('ms-tab-reservations').classList.add('active');
    document.getElementById('ms-tab-nights').classList.remove('active');
    document.getElementById('ms-tab-extras')?.classList.remove('active');
    UI.hideAlert('ms-file-error');
    updateMasterOptions();

    fileInput.onchange = (e) => handleFileSelected(e.target.files[0]);

    document.getElementById('ms-unresolved-only').onchange = () => {
      if (!parsedRows) return;
      renderResults(masterSelect.value, columnSelect.value);
    };

    masterSelect.onchange = () => {
      if (!parsedHeaders) return;
      const guessed = guessColumn(masterSelect.value, parsedHeaders);
      if (guessed) columnSelect.value = guessed;
      document.getElementById('ms-column-hint').textContent =
        guessed ? `Preselected "${guessed}" as the likely match for this master.` : '';
      renderResults(masterSelect.value, columnSelect.value);
    };

    columnSelect.onchange = () => {
      if (!parsedRows) return;
      renderResults(masterSelect.value, columnSelect.value);
    };

    // Restore reservations file from session memory if present
    const saved = parsedByType['reservations'];
    if (saved) {
      parsedRows = saved.rows;
      parsedHeaders = saved.headers;
      columnSelect.innerHTML = saved.headers.map(h => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');
      const guessed = saved.columnMap[masterSelect.value] || guessColumn(masterSelect.value, saved.headers);
      if (guessed) columnSelect.value = guessed;
      document.getElementById('ms-after-upload').style.display = 'block';
      renderResults(masterSelect.value, columnSelect.value);
      renderMemoryBar();
    } else {
      // Nothing in memory — try auto-loading the gold ETL outputs.
      renderMemoryBar();
      loadFromGold();
    }
  }

  function updateMasterOptions() {
    const masterSelect = document.getElementById('ms-master-select');
    const options = MASTERS_BY_FILE_TYPE[currentFileType] || [];
    masterSelect.innerHTML = options.map(o =>
      `<option value="${o.value}">${o.label}</option>`
    ).join('');
  }

  // Compute pending (not-in-master) values per master for the currently
  // uploaded file. Used by the Excel export to include "PENDING" sheets.
  async function getPendingSheets() {
    if (!parsedRows || !parsedRows.length) return [];
    const sheets = [];
    for (const m of (MASTERS_BY_FILE_TYPE[currentFileType] || [])) {
      const config = MASTER_CONFIG[m.value];
      if (!config) continue;
      const col = guessColumn(m.value, parsedHeaders);
      if (!col) continue;
      let existing;
      try { existing = await config.fetchExisting(currentCompany.id); } catch (e) { continue; }
      const existingSet = new Set(existing.map(r => String(r[config.matchColumn] ?? '').toLowerCase().trim()));
      const counts = {};
      parsedRows.forEach(r => {
        const v = String(r[col] ?? '').trim();
        if (!v) return;
        counts[v] = (counts[v] || 0) + 1;
      });
      const pending = Object.entries(counts)
        .filter(([v]) => !existingSet.has(v.toLowerCase()))
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ 'Raw value (PMS)': v, 'Rows in file': n, 'Display name (fill in)': '' }));
      if (pending.length) sheets.push({ name: `PENDING ${m.label}`, rows: pending });
    }
    return sheets;
  }

  // Pending across ALL files currently in memory (all three tabs).
  async function getAllPendingSheets() {
    const sheets = [];
    for (const [fileType, parsed] of Object.entries(parsedByType)) {
      if (!parsed?.rows?.length) continue;
      for (const m of (MASTERS_BY_FILE_TYPE[fileType] || [])) {
        const config = MASTER_CONFIG[m.value];
        if (!config) continue;
        const col = parsed.columnMap?.[m.value];
        if (!col) continue;
        let existing;
        try { existing = await config.fetchExisting(currentCompany.id); } catch (e) { continue; }
        const existingSet = new Set(existing.map(r => String(r[config.matchColumn] ?? '').toLowerCase().trim()));
        const counts = {};
        parsed.rows.forEach(r => {
          const v = String(r[col] ?? '').trim();
          if (!v) return;
          counts[v] = (counts[v] || 0) + 1;
        });
        const pending = Object.entries(counts)
          .filter(([v]) => !existingSet.has(v.toLowerCase()))
          .sort((a, b) => b[1] - a[1])
          .map(([v, n]) => ({ 'Raw value (PMS)': v, 'Rows in file': n, 'Display name (fill in)': '' }));
        if (pending.length) sheets.push({ name: `PENDING ${m.label}`, rows: pending });
      }
    }
    return sheets;
  }

  // Shared summary: for every loaded file & master → column, count in-master vs pending.
  async function computeSummary() {
    const out = [];
    for (const [fileType, parsed] of Object.entries(parsedByType)) {
      if (!parsed?.rows?.length) continue;
      const masters = [];
      for (const m of (MASTERS_BY_FILE_TYPE[fileType] || [])) {
        const config = MASTER_CONFIG[m.value];
        const col = parsed.columnMap?.[m.value];
        if (!config || !col) { masters.push({ label: m.label, column: col || '(not used)', inDb: '-', pending: '-' }); continue; }
        let existing = [];
        try { existing = await config.fetchExisting(currentCompany.id); } catch (e) {}
        const existingSet = new Set(existing.map(r => String(r[config.matchColumn] ?? '').toLowerCase().trim()));
        const distinct = new Set();
        parsed.rows.forEach(r => {
          const v = String(r[col] ?? '').trim();
          if (v) distinct.add(v);
        });
        let pending = 0;
        distinct.forEach(v => { if (!existingSet.has(v.toLowerCase())) pending++; });
        masters.push({ label: m.label, column: col, inDb: existing.length, pending });
      }
      out.push({ fileType, filename: parsed.filename, rows: parsed.rows.length, masters });
    }
    return out;
  }

  // Upload a file directly into a slot (from the memory bar), regardless of active tab.
  function uploadFor(fileType, file) {
    // switch the working area to that tab, then process
    MastersSetup.switchFileType(fileType);
    handleFileSelected(file);
  }

  // Status bar: upload slots + clickable masters + counts with traffic-light colors.
  function renderMemoryBar() {
    const bar = document.getElementById('ms-memory-bar');
    if (!bar) return;
    const labels = { reservations: 'Reservations', nights: 'Nights', extras: 'Extras' };
    bar.innerHTML = ['reservations','nights','extras'].map(t => {
      const p = parsedByType[t];
      const uploadBtn = `
        <input type="file" id="ms-slot-file-${t}" accept=".csv" style="display:none"
               onchange="msUploadFor('${t}', this.files[0])">
        <button class="btn btn-secondary btn-sm" onclick="document.getElementById('ms-slot-file-${t}').click()">
          ${p ? 'Replace file' : 'Upload file'}</button>`;
      if (!p) {
        return `<div id="ms-slot-card-${t}" style="flex:1;min-width:240px;padding:0.6rem 0.8rem;border:1px dashed var(--border,#ccc);border-radius:8px;color:var(--text-muted);font-size:0.82rem">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong>${labels[t]}</strong>${uploadBtn}
          </div>
          <div style="margin-top:0.3rem">no file loaded</div></div>`;
      }
      const mappers = (MASTERS_BY_FILE_TYPE[t] || []).map(m => {
        const opts = ['<option value="">— not used —</option>']
          .concat(p.headers.map(h =>
            `<option value="${escapeAttr(h)}" ${p.columnMap[m.value] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`))
          .join('');
        return `<div id="ms-mrow-${t}-${m.value}"
                     style="display:flex;align-items:center;gap:0.4rem;margin-top:0.3rem;flex-wrap:wrap;padding:0.25rem 0.4rem;border-radius:6px;cursor:pointer"
                     onmouseover="this.style.background='rgba(0,0,0,0.05)'" onmouseout="this.style.background=''"
                     onclick="msSelectMaster('${t}','${m.value}')">
          <span style="min-width:110px;font-size:0.78rem;font-weight:600">${escapeHtml(m.label)} ›</span>
          <select onclick="event.stopPropagation()" onchange="msSetColumnMap('${t}','${m.value}',this.value)"
                  style="font-size:0.75rem;padding:0.15rem 0.3rem;border:1px solid var(--border,#ccc);border-radius:4px">${opts}</select>
          <span id="ms-count-${t}-${m.value}" style="font-size:0.72rem;color:var(--text-muted)">…</span>
        </div>`;
      }).join('');
      return `<div id="ms-slot-card-${t}" style="flex:1;min-width:240px;padding:0.6rem 0.8rem;border:1px solid #16a34a;border-radius:8px;font-size:0.82rem;background:#f0fdf4">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem">
          <strong>${labels[t]}</strong>${uploadBtn}
        </div>
        <div style="margin-top:0.25rem">✓ ${escapeHtml(p.filename)} (${p.rows.length.toLocaleString()} rows)</div>
        <div style="margin-top:0.35rem;font-size:0.72rem;color:var(--text-muted)">Click a master to review & add:</div>
        ${mappers}</div>`;
    }).join('');
    updateMemoryCounts();
  }

  async function updateMemoryCounts() {
    const summary = await computeSummary();
    const masterKeyByLabel = {};
    Object.entries(MASTERS_BY_FILE_TYPE).forEach(([t, ms]) =>
      ms.forEach(m => masterKeyByLabel[`${t}|${m.label}`] = m.value));
    summary.forEach(f => {
      let totalPending = 0;
      f.masters.forEach(m => {
        const key = masterKeyByLabel[`${f.fileType}|${m.label}`];
        const el = document.getElementById(`ms-count-${f.fileType}-${key}`);
        if (!el) return;
        if (m.inDb === '-') { el.textContent = ''; return; }
        const pend = m.pending;
        totalPending += pend;
        if (pend === 0) {
          el.innerHTML = `<span style="color:#16a34a">✓ ${m.inDb} in master</span>`;
        } else {
          const color = pend > 10 ? '#dc2626' : '#d97706';
          el.innerHTML = `${m.inDb} in master · <strong style="color:${color}">${pend} pending</strong>`;
        }
      });
      // Traffic light on the card
      const card = document.getElementById(`ms-slot-card-${f.fileType}`);
      if (card) {
        if (totalPending === 0)      { card.style.border = '1px solid #16a34a'; card.style.background = '#f0fdf4'; }
        else if (totalPending <= 10) { card.style.border = '1px solid #d97706'; card.style.background = '#fffbeb'; }
        else                         { card.style.border = '1px solid #dc2626'; card.style.background = '#fef2f2'; }
      }
    });
  }

  // Click a master in a card → load its review table below.
  function selectMaster(fileType, masterKey) {
    const p = parsedByType[fileType];
    if (!p) return;
    currentFileType = fileType;
    parsedRows = p.rows;
    parsedHeaders = p.headers;
    updateMasterOptions();
    const masterSelect = document.getElementById('ms-master-select');
    const columnSelect = document.getElementById('ms-column-select');
    masterSelect.value = masterKey;
    columnSelect.innerHTML = p.headers.map(h => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');
    const col = p.columnMap[masterKey] || guessColumn(masterKey, p.headers);
    if (!col) { UI.showAlert('ms-file-error', 'Pick a column for this master first (dropdown in the card).'); return; }
    columnSelect.value = col;
    document.getElementById('ms-after-upload').style.display = 'block';
    renderResults(masterKey, col);
    document.getElementById('ms-after-upload').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setColumnMap(fileType, masterKey, column) {
    if (parsedByType[fileType]) {
      parsedByType[fileType].columnMap[masterKey] = column;
      updateMemoryCounts();
    }
  }

  return { init, loadFromGold, getPendingSheets, getAllPendingSheets, renderMemoryBar, setColumnMap, computeSummary, uploadFor, selectMaster, switchFileType(type) {
    currentFileType = type;
    const fileInput = document.getElementById('ms-file-input');
    fileInput.value = '';
    document.getElementById('ms-property-banner').style.display = 'none';
    document.getElementById('ms-unresolved-only').checked = false;
    UI.hideAlert('ms-file-error');
    const labels = { reservations: '1. Upload reservations file', nights: '1. Upload nights file', extras: '1. Upload extras master file' };
    document.getElementById('ms-upload-label').textContent = labels[type] || '1. Upload file';
    ['reservations','nights','extras'].forEach(t => {
      document.getElementById(`ms-tab-${t}`)?.classList.toggle('active', t === type);
    });
    updateMasterOptions();
    // Restore this tab's file from memory if present
    const saved = parsedByType[type];
    if (saved) {
      parsedRows = saved.rows;
      parsedHeaders = saved.headers;
      const masterSelect = document.getElementById('ms-master-select');
      const columnSelect = document.getElementById('ms-column-select');
      columnSelect.innerHTML = saved.headers.map(h => `<option value="${escapeAttr(h)}">${escapeHtml(h)}</option>`).join('');
      const guessed = saved.columnMap[masterSelect.value] || guessColumn(masterSelect.value, saved.headers);
      if (guessed) columnSelect.value = guessed;
      document.getElementById('ms-after-upload').style.display = 'block';
      renderResults(masterSelect.value, columnSelect.value);
    } else {
      parsedRows = null;
      parsedHeaders = null;
      document.getElementById('ms-after-upload').style.display = 'none';
    }
    renderMemoryBar();
  }};
})();

function initMastersSetup() { MastersSetup.init(); }
function msSwitchFileType(type) { MastersSetup.switchFileType(type); }
function msSetColumnMap(fileType, masterKey, column) { MastersSetup.setColumnMap(fileType, masterKey, column); }
function msUploadFor(fileType, file) { if (file) MastersSetup.uploadFor(fileType, file); }
function msSelectMaster(fileType, masterKey) { MastersSetup.selectMaster(fileType, masterKey); }
