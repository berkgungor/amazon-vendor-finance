/**
 * Snowflake access for the app. Wraps the Snowflake App Runtime SDK (./sar-sdk), which handles
 * auth: the app's service token when deployed, your local connection in development.
 *
 * Every call made on behalf of a user runs with caller's rights, so Snowflake sees the
 * signed-in user (CURRENT_USER()) and their role. The app writes only through owner's-rights
 * procedures (OPS.* and APP.*) with bind parameters; it never issues DML itself.
 */
import "server-only";
import { headers } from "next/headers";
import * as sdk from "./sar-sdk";

export { getSnowflakeBaseUrl } from "./sar-sdk";

export const WAREHOUSE = process.env.SNOWFLAKE_WAREHOUSE ?? "AMZ_FIN_WH";

export type Bind = string | number | boolean | null;

async function requestHeaders(): Promise<sdk.RequestHeaders> {
  return Object.fromEntries(await headers());
}

/** Runs a query as the signed-in user. Always pass user input as binds. */
export async function sql<T = Record<string, unknown>>(query: string, binds: Bind[] = []): Promise<T[]> {
  const rows = await sdk.querySnowflake(
    query,
    { callersRights: true, warehouse: WAREHOUSE, binds: binds as never },
    requestHeaders,
  );
  return lower<T>(rows);
}

/** Same as {@link sql} for statements that can take a while (agent runs, widget queries). */
export async function sqlLong<T = Record<string, unknown>>(query: string, binds: Bind[] = []): Promise<T[]> {
  return lower<T>(await sqlLongRaw(query, binds));
}

/** Long-running query as the signed-in user, keeping Snowflake's column names (widget queries). */
export async function sqlLongRaw(query: string, binds: Bind[] = []): Promise<Record<string, unknown>[]> {
  return sdk.querySnowflakeLongRunning(
    query,
    { callersRights: true, warehouse: WAREHOUSE, binds: binds as never },
    requestHeaders,
  );
}

export type ProcResult = { ok: boolean; error?: string; [k: string]: unknown };

/** A procedure argument passed as JSON to a VARIANT parameter. */
export const json = (value: unknown) => ({ json: JSON.stringify(value) });
type ProcArg = Bind | { json: string };

/** Calls a platform procedure (fully qualified name) and returns its OBJECT result. */
export async function callProc(name: string, args: ProcArg[]): Promise<ProcResult> {
  if (!/^[A-Z_]+\.[A-Z_]+\.[A-Z_]+$/.test(name)) throw new Error(`Invalid procedure name ${name}`);
  const placeholders = args.map((a) => (a !== null && typeof a === "object" ? "PARSE_JSON(?)" : "?"));
  const binds = args.map((a) => (a !== null && typeof a === "object" ? a.json : a));
  const rows = await sdk.querySnowflake(
    `CALL ${name}(${placeholders.join(", ")})`,
    { callersRights: true, warehouse: WAREHOUSE, binds: binds as never },
    requestHeaders,
  );
  const value = rows[0] ? Object.values(rows[0])[0] : null;
  return (typeof value === "string" ? JSON.parse(value) : value) as ProcResult;
}

/**
 * Authorization headers for Snowflake REST calls (Cortex Agents) on behalf of the signed-in user.
 * Deployed: the caller's-rights token built from the request's user token. Local dev: your
 * local connection's token.
 */
export async function restAuthHeaders(): Promise<Record<string, string>> {
  const deployed = sdk.getServiceToken() && process.env.NODE_ENV !== "development";
  if (deployed) {
    const userToken = (await requestHeaders())["sf-context-current-user-token"];
    if (!userToken) throw new Error("No signed-in Snowflake user on this request");
    return {
      Authorization: `Bearer ${sdk.buildCallerRightsToken(userToken)}`,
      "X-Snowflake-Authorization-Token-Type": "OAUTH",
    };
  }
  // Local dev with a programmatic access token in .env.local (SNOWFLAKE_PASSWORD holds the PAT).
  if (process.env.SNOWFLAKE_USER && process.env.SNOWFLAKE_PASSWORD) {
    return {
      Authorization: `Bearer ${process.env.SNOWFLAKE_PASSWORD}`,
      "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
    };
  }
  return { Authorization: sdk.getRestApiAuthHeader(), "X-Snowflake-Authorization-Token-Type": "OAUTH" };
}

/** Snowflake returns upper-case column names; normalise to lower-case keys. */
export function lower<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.toLowerCase(), v])) as T);
}
