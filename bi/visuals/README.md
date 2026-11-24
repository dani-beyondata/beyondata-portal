# Visual `p1_tbl` — "Summary Table" (página 1 · Executive Summary) como MATRIZ

Convierte la **Summary Table** (`p1_tbl`, antes `type:"html"`) en una **matriz nativa**
del BI, usando la extensión de *formato por eje (fila)* + *total desde el SQL*
(`feat/bi-matrix-axis-format`).

> La tabla de **Controlling** (`p1_ctrl`, "Metrics by Month") NO se toca: se queda
> en HTML tal cual. El dashboard vive en Supabase (`bi_dashboards`, jsonb) y nunca
> se modificó desde aquí.

## Qué muestra (idéntico al original)
7 métricas × 12 meses (Ene–Dic) + Total, del año en curso (`$CY`):
`% Occ` (pct), `Bednights` (int), `ADB` (€), `RevPab` (€),
`Prod Aloj.` / `Prod Extras` / `Prod Total` (K€). Una línea por métrica (sólo CY).

## Forma del SQL (una fila por celda)
Columnas: `row` (métrica), `col` (`Ene`…`Dic` o `Total`), `colOrd` (1..12, 99=Total),
`v` (número), `fmt` (formato de esa fila). Sin `arrow` (no hay deltas).
- Sólo se emiten meses con datos (`join yr`), así que la tabla crece con el año.
  Hoy hay datos hasta Dic (hay reservas futuras ya cargadas) → **7 filas × 13 columnas**.
- **Total** desde el SQL (`autoTotal:false`): agregado correcto por métrica —
  ratios recalculados sobre el total anual (occ = Σbn/Σcap, adb = Σprod/Σbn,
  revpab = Σprod/Σcap) y sumas en bn/€. Por eso % Occ·Total = 52,4 % (ponderado,
  no media de meses) y Prod Total·Total = 2.092 K€.

## Ajustes del visual (ya en el JSON)
- `fmtAxis:"row"` → imprescindible para que cada fila use su `fmt` (en `off` usaría
  un formato global).
- `autoTotal:false` → el Total viene del SQL, no del motor.
- `sortable:false`, `sortRows:"none"` → mantiene el orden del SQL.
- `fmt:"int"` es sólo fallback.
- Geometría conservada: x16 y594 w1256 h300.

## Cómo aplicarlo
1. En el BI en modo editor, borra el visual HTML `p1_tbl` y añade uno **Matriz** en
   la misma posición, pega el SQL de `p1_tbl_matrix.sql`, pon *Formato por eje → Por
   fila* y desmarca *Añadir Total propio*. Guarda.
2. O sustituye el objeto `p1_tbl` de la página 1 por el de `p1_tbl_matrix.json` en
   el jsonb.

## Nota menor (tuya)
`Bednights`·Total se abrevia a "55,8 K" con `fmt=int` (los meses van sin abreviar;
mismo criterio que la KPI card). Si lo quieres entero completo ("55.824"), cambio esa
fila a `fmt='dec'`.
