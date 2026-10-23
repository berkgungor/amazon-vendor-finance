import { NextRequest } from "next/server";
import { json } from "@/lib/api";
import { callProc, sql } from "@/lib/snowflake";
import { MAX_UPLOAD_BYTES, parseUpload, tableNameFor } from "@/lib/uploads";
import type { UploadResult } from "@/lib/types";

export const maxDuration = 120;

// POST multipart { file } → parses the CSV/xlsx and loads it into AMAZON_FINANCE_APP.UPLOADS
// through OPS.LOAD_UPLOAD (which names, types and creates the table). Runs as the signed-in user.
export async function POST(req: NextRequest) {
  return json(async (): Promise<UploadResult> => {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) throw new Error("file required");
    if (!/\.(csv|xlsx)$/i.test(file.name)) throw new Error("Only .csv and .xlsx files are supported");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files are limited to 10 MB");

    const parsed = await parseUpload(file.name, await file.arrayBuffer());
    const r = await callProc("AMAZON_FINANCE_APP.OPS.LOAD_UPLOAD", [
      tableNameFor(file.name),
      file.name,
      JSON.stringify(parsed.columns),
      JSON.stringify(parsed.rows),
    ]);
    if (!r.ok) throw new Error(r.error ?? "Upload failed");

    const table = String(r.table);
    if (!/^AMAZON_FINANCE_APP\.UPLOADS\.[A-Z0-9_]+$/.test(table)) throw new Error("Unexpected table name");
    const preview = await sql<Record<string, string | number | null>>(`SELECT * FROM ${table} LIMIT 5`);
    return {
      file: file.name,
      table,
      rows: Number(r.rows),
      columns: r.columns as UploadResult["columns"],
      preview: preview.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toUpperCase(), (v as unknown) instanceof Date ? (v as unknown as Date).toISOString().slice(0, 10) : (v as string | number | null)]))),
    };
  });
}
