import "server-only";
import ExcelJS from "exceljs";
import Papa from "papaparse";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_UPLOAD_ROWS = 100_000;

type Cell = string | number | boolean | null;
export type ColumnType = "VARCHAR" | "NUMBER" | "DATE" | "TIMESTAMP_NTZ" | "BOOLEAN";
export type ParsedTable = { columns: { name: string; type: ColumnType }[]; rows: Cell[][] };

const NUMBER = /^-?\(?\$?\s*-?[\d,]*\.?\d+\)?%?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;
const BOOLEAN = /^(true|false|yes|no)$/i;

/** Parses a CSV or the first Excel sheet into a header and rows. */
export async function parseUpload(fileName: string, bytes: ArrayBuffer): Promise<ParsedTable> {
  const raw = /\.xlsx$/i.test(fileName) ? await readXlsx(bytes) : readCsv(new TextDecoder().decode(bytes));
  const [header = [], ...body] = raw.filter((r) => r.some((v) => v !== null && String(v).trim() !== ""));
  if (!header.length) throw new Error("The file has no header row");
  if (!body.length) throw new Error("The file has no data rows");
  if (body.length > MAX_UPLOAD_ROWS) throw new Error(`Files are limited to ${MAX_UPLOAD_ROWS.toLocaleString()} rows`);

  const names = uniqueNames(header.map((h) => String(h ?? "")));
  const rows = body.map((r) => names.map((_, i) => normalize(r[i])));
  const columns = names.map((name, i) => ({ name, type: inferType(rows.map((r) => r[i])) }));
  // Numbers like "$1,234.50" or "(120)" are cleaned so Snowflake's TRY_TO_DECIMAL reads them.
  for (const [i, c] of columns.entries()) {
    if (c.type === "NUMBER") for (const r of rows) r[i] = r[i] === null ? null : cleanNumber(String(r[i]));
    if (c.type === "DATE") for (const r of rows) r[i] = r[i] === null ? null : isoDate(String(r[i]));
  }
  return { columns, rows };
}

function readCsv(text: string): Cell[][] {
  const out = Papa.parse<string[]>(text.replace(/^\uFEFF/, ""), { skipEmptyLines: true });
  if (out.errors.length && !out.data.length) throw new Error(`Couldn't read the CSV: ${out.errors[0].message}`);
  return out.data;
}

async function readXlsx(bytes: ArrayBuffer): Promise<Cell[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("The workbook has no sheets");
  const rows: Cell[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]).slice(1); // ExcelJS rows are 1-based
    rows.push(values.map(excelValue));
  });
  return rows;
}

function excelValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 19 : 10).replace("T", " ");
  if (typeof v === "object") {
    if ("result" in v) return excelValue(v.result as ExcelJS.CellValue); // formula
    if ("text" in v) return String(v.text); // hyperlink
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    return null;
  }
  return v as Cell;
}

function normalize(v: Cell | undefined): Cell {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  return v;
}

function uniqueNames(header: string[]): string[] {
  const seen = new Map<string, number>();
  return header.map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    const n = (seen.get(base.toLowerCase()) ?? 0) + 1;
    seen.set(base.toLowerCase(), n);
    return n > 1 ? `${base}_${n}` : base;
  });
}

/** A column gets a type only if every non-empty value fits it; otherwise it stays text. */
function inferType(values: Cell[]): ColumnType {
  const present = values.filter((v) => v !== null).map(String);
  if (!present.length) return "VARCHAR";
  if (present.every((v) => NUMBER.test(v.replace(/\s/g, "")))) return "NUMBER";
  if (present.every((v) => DATE.test(v) && isoDate(v) !== null)) return "DATE";
  if (present.every((v) => TIMESTAMP.test(v))) return "TIMESTAMP_NTZ";
  if (present.every((v) => BOOLEAN.test(v))) return "BOOLEAN";
  return "VARCHAR";
}

function cleanNumber(v: string): string | null {
  const negative = /^\(.*\)$/.test(v.trim()) || v.includes("-");
  const digits = v.replace(/[^\d.]/g, "");
  if (!digits) return null;
  const n = Number(digits) / (v.trim().endsWith("%") ? 100 : 1);
  return String(negative ? -n : n);
}

/** ISO date from YYYY-MM-DD or M/D/YYYY (US order, as in Amazon Vendor Central exports). */
function isoDate(v: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const [, mo, d, y] = m;
  const year = y.length === 2 ? `20${y}` : y;
  if (Number(mo) > 12 || Number(d) > 31) return null;
  return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** Table name from the file name: "Q1 chargebacks.csv" → "Q1_CHARGEBACKS". LOAD_UPLOAD makes it unique. */
export function tableNameFor(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "UPLOAD";
}
