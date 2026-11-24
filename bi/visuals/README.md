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

---

# Visual `p5_ctrl` — "Controlling por categoría" (pág. 5) en formato ESCALONADO

Convierte la tabla `p5_ctrl` (antes `type:"table"`, con la categoría repetida como
columna) en un **controlling escalonado** tipo página 1: cada **categoría** es una
fila-título (`<tr class="ctsec">`) y debajo van **YTD / LYTD / Δ YoY**, con las 6
métricas en columnas (Prod Total, Prod Acc, Prod Extras, ADB, Bednights, RevPab).

## Cómo funciona el escalonado
- `type:"html"` + **`post:"ctrl"`** → `ctrlAssemble()` inserta una fila-cabecera a lo
  ancho cada vez que cambia la columna `section` del SQL.
- El SQL devuelve, por cada (categoría × período): `section` (categoría), `lbl`
  (YTD/LYTD/Δ YoY), `rowcls` (ytd/lytd/delta, para el estilo), `cs` (7 = nº de
  columnas, para el `colspan` de la cabecera) y las 6 celdas de métrica ya
  formateadas (€, ▲▼ %). Ordenado por categoría y período.
- La plantilla HTML pinta `[[&sechtml]]` (la fila-título) + la fila de datos.

## Reutiliza los CTEs del original
Los bloques `ytd`/`lytd` son **idénticos** a los de `p5_ctrl` (ya validados en
producción). Sólo cambia el `SELECT` final (a formato escalonado) y **un arreglo**:

> **Fix Bednights Δ.** En el original, el Δ% de Bednights salía siempre "▲ 0,0%"
> porque `bn` es entero y Postgres hacía división entera (`9370/13049 → 0`). Se
> castea a `::numeric`, así que ahora el Δ de Bednights es real (p. ej. Hab 4 =
> ▼ -28,2%). Es el único cambio de cálculo respecto a la tabla vieja.

## Aplicarlo
Modo editor → abre el visual **p5_ctrl** → sección **"JSON del visual (editable)"**
abajo → pega `p5_ctrl_step.json` → **Aplicar JSON**. (Altura subida a 760 para que
quepan las filas-título; ajústala si quieres.)

## Opcional
Los ▲▼ van en texto plano (como la tabla original). Si quieres el Δ en **verde/rojo**,
se añade envolviendo la celda en un `<span style="color…">` desde el SQL — dímelo y
lo hago.
