// BeyonData · Controlling Excel builder
// Pure JS (ESM). Works in Deno (Edge Function) via `import ExcelJS from "npm:exceljs@4"`
// and in Node for local tests. No DAX here: it receives already-computed rows.

const C = {
  navy: "1E3A5F", navyDeep: "152B47", brand: "3D65A8", sky: "60A5FA", gold: "E0A64E",
  ink: "1A1D24", soft: "4A4F5A", muted: "8A8F98", line: "D7DBE0", bone: "F6F4F1", boneSoft: "F7F9FC",
  green: "2F7A34", amber: "B7860B", red: "A0453D", white: "FFFFFF",
};

const FMT = {
  pct: "0.0%", eur: "#,##0.0 €", keur: '#,##0.0,"K€"', int: "#,##0", dec: "0.00",
  deltaPct: '+0.0" p.p.";-0.0" p.p.";0.0" p.p."', deltaRel: "+0.0%;-0.0%;0.0%",
};

// Semaphore thresholds — identical to the KPI cards and the HTML controlling table
function deltaColor(kind, fmt, v) {
  if (v == null || Number.isNaN(v)) return C.muted;
  const r = fmt === "pct" ? Math.round(v * 10) / 10 : Math.round(v * 1000) / 1000;
  if (kind === "deltaTgt") {
    if (fmt === "pct") return r >= -1 ? C.green : r >= -3 ? C.amber : C.red;
    return r > -0.04 ? C.green : r >= -0.10 ? C.amber : C.red;
  }
  return r > 0 ? C.green : r < 0 ? C.red : C.muted;
}

/**
 * Pivot tidy DAX rows into blocks.
 * rows: [{section, morder, metric, lorder, line, fmt, col, value}] — col = column label (month/property) or null for totals
 * colOrder: ordered list of column labels
 * Returns: [{section, metric, fmt, lines:[{label, kind, values:{col:v}, total:v}]}]
 */
export function pivot(rows, colOrder) {
  const blocks = new Map();
  for (const r of rows) {
    const bk = `${r.morder}`;
    if (!blocks.has(bk)) blocks.set(bk, { section: r.section, morder: r.morder, metric: r.metric, fmt: r.fmt, lines: new Map() });
    const b = blocks.get(bk);
    const lk = `${r.lorder}`;
    if (!b.lines.has(lk)) {
      const kind = r.line === "Δ" ? "delta" : r.line === "Δ vs Target" ? "deltaTgt" : "value";
      b.lines.set(lk, { label: r.line, lorder: r.lorder, kind, values: {}, total: null });
    }
    const L = b.lines.get(lk);
    if (r.col == null) L.total = r.value; else L.values[r.col] = r.value;
  }
  return [...blocks.values()].sort((a, b) => a.morder - b.morder).map(b => ({
    ...b, lines: [...b.lines.values()].sort((a, c) => a.lorder - c.lorder),
  }));
}

function addCover(wb, meta) {
  const ws = wb.addWorksheet("Portada", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 4 }, { width: 46 }, { width: 40 }];
  ws.mergeCells("B2:C4");
  const brand = ws.getCell("B2");
  brand.value = { richText: [
    { text: "BEYON", font: { name: "Segoe UI", size: 26, bold: true, color: { argb: C.ink } } },
    { text: "D", font: { name: "Segoe UI", size: 26, bold: true, color: { argb: C.sky } } },
    { text: "ATA", font: { name: "Segoe UI", size: 26, bold: true, color: { argb: C.sky } } },
  ] };
  brand.alignment = { vertical: "middle" };
  ws.getCell("B6").value = "Informe de controlling";
  ws.getCell("B6").font = { name: "Segoe UI", size: 20, bold: true, color: { argb: C.navy } };
  ws.getCell("B7").value = meta.company;
  ws.getCell("B7").font = { name: "Segoe UI", size: 14, color: { argb: C.soft } };
  const rowsMeta = [
    ["Generado", meta.generatedAt],
    ["Periodo", meta.period],
    ["Property", meta.property || "Todas (grupo)"],
    ["Modo de ocupación", meta.mode || "Habitaciones"],
    ["Fuente", "Modelo Power BI de BeyonData (misma lógica que el panel)"],
  ];
  let r = 10;
  for (const [k, v] of rowsMeta) {
    ws.getCell(`B${r}`).value = k; ws.getCell(`B${r}`).font = { name: "Segoe UI", size: 10, color: { argb: C.muted } };
    ws.getCell(`C${r}`).value = v; ws.getCell(`C${r}`).font = { name: "Segoe UI", size: 10, color: { argb: C.ink } };
    r++;
  }
  ws.getCell(`B${r + 1}`).value = "Hojas: Meses · Properties · Property × Mes · Datos (formato largo para tablas dinámicas)";
  ws.getCell(`B${r + 1}`).font = { name: "Segoe UI", size: 9, italic: true, color: { argb: C.muted } };
  ws.getCell(`B${r + 3}`).value = "Confidencial · preparado para uso interno del cliente · beyondata.es";
  ws.getCell(`B${r + 3}`).font = { name: "Segoe UI", size: 9, color: { argb: C.muted } };
  // top band
  for (let c = 1; c <= 3; c++) ws.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
  ws.getRow(1).height = 8;
}

function styleHeader(ws, rowIdx, labels, firstColWidth) {
  const row = ws.getRow(rowIdx);
  row.height = 22;
  labels.forEach((lbl, i) => {
    const cell = row.getCell(i + 1);
    cell.value = lbl;
    cell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.navy } };
    cell.alignment = { horizontal: i === 0 ? "left" : "right", vertical: "middle" };
  });
  ws.getColumn(1).width = firstColWidth;
  for (let i = 2; i <= labels.length; i++) ws.getColumn(i).width = 12.5;
}

/** Writes one controlling sheet. blocks from pivot(); cols = column labels; totalLabel e.g. "Total"/"Grupo" */
function addBlocksSheet(wb, name, title, subtitle, cols, blocks, totalLabel) {
  const ws = wb.addWorksheet(name, { views: [{ showGridLines: false, state: "frozen", xSplit: 1, ySplit: 4 }] });
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { name: "Segoe UI", size: 14, bold: true, color: { argb: C.navy } };
  ws.getCell("A2").value = subtitle;
  ws.getCell("A2").font = { name: "Segoe UI", size: 9, color: { argb: C.muted } };
  ws.getRow(3).height = 6;
  styleHeader(ws, 4, ["", ...cols, totalLabel], 26);
  let r = 5;
  let lastSection = null;
  for (const b of blocks) {
    if (b.section !== lastSection) {
      const cell = ws.getCell(r, 1);
      cell.value = b.section.toUpperCase();
      cell.font = { name: "Segoe UI", size: 8, bold: true, color: { argb: C.brand } };
      ws.getRow(r).height = 16;
      r++;
      lastSection = b.section;
    }
    b.lines.forEach((L, li) => {
      const row = ws.getRow(r);
      const first = li === 0;
      const lbl = row.getCell(1);
      lbl.value = first ? b.metric : `   ${L.label}`;
      lbl.font = { name: "Segoe UI", size: 10, bold: first, color: { argb: first ? C.navy : C.muted } };
      const numFmt = L.kind === "value" ? FMT[b.fmt] : (b.fmt === "pct" ? FMT.deltaPct : FMT.deltaRel);
      const writeCell = (cell, v, isTotal) => {
        cell.value = v == null ? null : v;
        cell.numFmt = numFmt;
        cell.alignment = { horizontal: "right" };
        const color = L.kind === "value" ? (first ? C.ink : C.soft) : deltaColor(L.kind, b.fmt, v);
        cell.font = { name: "Segoe UI", size: 10, bold: (first || L.kind !== "value") && !(L.kind === "value" && !first), color: { argb: color } };
        if (isTotal) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.boneSoft } };
        cell.border = { bottom: { style: "hair", color: { argb: "F0F1F3" } } };
      };
      cols.forEach((c, ci) => writeCell(row.getCell(ci + 2), L.values[c] ?? null, false));
      writeCell(row.getCell(cols.length + 2), L.total, true);
      r++;
    });
    ws.getRow(r).height = 8; // spacer
    r++;
  }
  ws.getCell(r + 1, 1).value = "Δ = variación respecto al mismo periodo del año anterior (p.p. para porcentajes). Δ vs Target = desviación sobre presupuesto. Colores: verde dentro del plan, ámbar vigilar, rojo actuar.";
  ws.getCell(r + 1, 1).font = { name: "Segoe UI", size: 8, italic: true, color: { argb: C.muted } };
  return ws;
}

function addLongSheet(wb, longRows) {
  const ws = wb.addWorksheet("Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = ["Sección", "Métrica", "Línea", "Property", "Mes", "Valor"];
  styleHeader(ws, 1, headers, 18);
  ws.getColumn(2).width = 22; ws.getColumn(4).width = 22;
  longRows.forEach((x, i) => {
    const row = ws.getRow(i + 2);
    row.values = [x.section, x.metric, x.line, x.property ?? "Grupo", x.month ?? "Total", x.value];
    row.font = { name: "Segoe UI", size: 9 };
    row.getCell(6).numFmt = "0.0000";
  });
  ws.autoFilter = { from: "A1", to: `F${longRows.length + 1}` };
}

/**
 * data = {
 *   meta: {company, generatedAt, period, property, mode},
 *   months: {cols:[...labels], blocks:[...]},        // pestaña 1
 *   props:  {cols:[...property names], blocks:[...]}, // pestaña 2
 *   propMonth: {cols:[...months], blocks:[{section, metric, fmt, lines:[{label: 'Grupo'|property, kind:'value', values, total}]}]}, // pestaña 3
 *   long: [{section, metric, line, property, month, value}]
 * }
 */
export async function buildControllingWorkbook(ExcelJS, data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BeyonData"; wb.created = new Date();
  addCover(wb, data.meta);
  addBlocksSheet(wb, "Meses", "Controlling · evolución mensual", `${data.meta.company} · ${data.meta.period} · YTD, año anterior, desviaciones y presupuesto`, data.months.cols, data.months.blocks, "Total");
  addBlocksSheet(wb, "Properties", "Controlling · comparativa por property", `${data.meta.company} · ${data.meta.period}`, data.props.cols, data.props.blocks, "Grupo");
  addBlocksSheet(wb, "Property x Mes", "Controlling · property × mes (YTD)", `${data.meta.company} · ${data.meta.period} · solo valores de este año`, data.propMonth.cols, data.propMonth.blocks, "Total");
  addLongSheet(wb, data.long);
  return wb;
}

export const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
