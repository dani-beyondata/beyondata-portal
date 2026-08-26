// table_enhance.js — adds sorting, per-column filtering, and global search
// to standard .table-wrap tables. Survives tbody re-renders via MutationObserver.
// Special grids (calendars, #rcal-grid) are plain divs, so they're never touched.

(function () {
  'use strict';

  // Columns we skip for sort/filter (action columns: empty header or known action headers)
  function isActionCol(headerText) {
    const t = (headerText || '').trim().toLowerCase();
    return t === '' || t === 'actions';
  }

  // Extract a comparable value from a cell (numeric if it looks numeric)
  function cellValue(td) {
    const raw = (td.textContent || '').trim();
    // strip thousands separators + currency/symbols for numeric compare
    const num = parseFloat(raw.replace(/[,\s€$%]/g, '').replace(/[^\d.\-]/g, ''));
    const looksNumeric = raw !== '' && !isNaN(num) && /[\d]/.test(raw) && !/[a-zA-Z]{2,}/.test(raw);
    return looksNumeric ? num : raw.toLowerCase();
  }

  function enhanceTable(table) {
    if (table.__enhanced) return;
    const thead = table.tHead;
    const tbody = table.tBodies[0];
    if (!thead || !tbody) return;
    const headRow = thead.rows[0];
    if (!headRow) return;

    table.__enhanced = true;
    const cols = Array.from(headRow.cells);

    // filter state per column index
    const filters = {};
    let sortCol = -1, sortDir = 1;

    // Build filter input row (hidden until a funnel is toggled)
    const filterRow = document.createElement('tr');
    filterRow.className = 'te-filter-row';
    filterRow.style.display = 'none';
    cols.forEach((th, i) => {
      const cell = document.createElement('th');
      cell.className = 'te-filter-cell';
      if (!isActionCol(th.textContent)) {
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.placeholder = 'Filter…';
        inp.className = 'te-filter-input';
        inp.addEventListener('input', () => {
          filters[i] = inp.value.trim().toLowerCase();
          applyFilters();
        });
        cell.appendChild(inp);
      }
      filterRow.appendChild(cell);
    });
    thead.appendChild(filterRow);

    // Make headers sortable + add funnel toggles
    cols.forEach((th, i) => {
      if (isActionCol(th.textContent)) return;
      th.classList.add('te-sortable');
      const label = th.innerHTML;
      th.innerHTML =
        '<span class="te-th-inner">' +
          '<span class="te-th-label">' + label + '</span>' +
          '<span class="te-sort-ind"></span>' +
          '<span class="te-funnel" title="Filter">' +
            '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>' +
          '</span>' +
        '</span>';

      const labelEl = th.querySelector('.te-th-label');
      const funnelEl = th.querySelector('.te-funnel');

      labelEl.addEventListener('click', () => {
        if (sortCol === i) sortDir = -sortDir; else { sortCol = i; sortDir = 1; }
        updateSortIndicators();
        applySort();
      });

      funnelEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const showing = filterRow.style.display !== 'none';
        // toggle: if any filter active keep open, else toggle visibility
        filterRow.style.display = showing ? 'none' : '';
        if (!showing) {
          const inp = filterRow.cells[i] && filterRow.cells[i].querySelector('input');
          if (inp) inp.focus();
        }
      });
    });

    function updateSortIndicators() {
      cols.forEach((th, i) => {
        const ind = th.querySelector('.te-sort-ind');
        if (!ind) return;
        ind.textContent = (i === sortCol) ? (sortDir === 1 ? '▲' : '▼') : '';
      });
    }

    function applySort() {
      if (sortCol < 0) return;
      const rows = Array.from(tbody.rows).filter(r => !r.__isEmptyRow);
      rows.sort((a, b) => {
        const av = cellValue(a.cells[sortCol]);
        const bv = cellValue(b.cells[sortCol]);
        if (av < bv) return -1 * sortDir;
        if (av > bv) return  1 * sortDir;
        return 0;
      });
      rows.forEach(r => tbody.appendChild(r));
    }

    function applyFilters() {
      const active = Object.entries(filters).filter(([, v]) => v);
      Array.from(tbody.rows).forEach(r => {
        if (r.__isEmptyRow) return;
        let show = true;
        for (const [idx, val] of active) {
          const cell = r.cells[idx];
          const txt = cell ? (cell.textContent || '').toLowerCase() : '';
          if (!txt.includes(val)) { show = false; break; }
        }
        r.style.display = show ? '' : 'none';
      });
      applyGlobalSearch();
    }

    // Global search (searches all cells)
    let globalTerm = '';
    function applyGlobalSearch() {
      if (!globalTerm) return;
      Array.from(tbody.rows).forEach(r => {
        if (r.__isEmptyRow || r.style.display === 'none') return;
        const txt = (r.textContent || '').toLowerCase();
        if (!txt.includes(globalTerm)) r.style.display = 'none';
      });
    }

    table.__setGlobalSearch = function (term) {
      globalTerm = (term || '').trim().toLowerCase();
      applyFilters(); // re-applies column filters then global
    };

    // Re-apply sort/filter after the section re-renders the tbody.
    // CRITICAL: applySort() re-appends rows, which IS a childList mutation —
    // observing our own reorder would retrigger the callback forever (page
    // freeze). Disconnect before touching the DOM, reconnect after.
    const obs = new MutationObserver(() => {
      obs.disconnect();
      Array.from(tbody.rows).forEach(r => {
        r.__isEmptyRow = !!r.querySelector('.empty-state') || r.cells.length < cols.length;
      });
      if (sortCol >= 0) applySort();
      applyFilters();
      obs.observe(tbody, { childList: true });
    });
    obs.observe(tbody, { childList: true });

    updateSortIndicators();
  }

  // Add a global search box above a table-wrap (once)
  function addGlobalSearch(wrap, table) {
    if (wrap.__hasSearch) return;
    // Only add if the table has a decent number of columns/rows worth searching
    wrap.__hasSearch = true;
    const bar = document.createElement('div');
    bar.className = 'te-search-bar';
    bar.innerHTML =
      '<span class="te-search-ico"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg></span>' +
      '<input type="text" class="te-search-input" placeholder="Search…">';
    const inp = bar.querySelector('input');
    inp.addEventListener('input', () => {
      if (table.__setGlobalSearch) table.__setGlobalSearch(inp.value);
    });
    wrap.insertBefore(bar, wrap.firstChild);
  }

  function enhanceAll() {
    document.querySelectorAll('.table-wrap > table, .table-wrap table').forEach(table => {
      // skip tiny/settings tables (like the single-row company-active table) — only enhance if it has a tbody with an id (data tables)
      const tbody = table.tBodies[0];
      if (!tbody) return;
      const wrap = table.closest('.table-wrap');
      if (!wrap) return;
      // skip if inside a calendar/special container
      if (table.closest('#rcal-grid') || table.closest('.cal-grid')) return;
      enhanceTable(table);
      addGlobalSearch(wrap, table);
    });
  }

  // Expose + auto-run on load and when sections change
  window.TableEnhance = { enhanceAll, enhanceTable };

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(enhanceAll, 300);
  });
  // Re-scan when navigating (sections show/hide); cheap because __enhanced guards dupes
  document.addEventListener('click', (e) => {
    if (e.target.closest('.nav-item')) setTimeout(enhanceAll, 350);
  });
})();
