import "server-only";
import { autoChart, resultSetRows } from "./charts";
import { getSnowflakeBaseUrl, restAuthHeaders, sqlLong } from "./snowflake";
import type { ActionItem, AgentEvent } from "./types";

// The Cortex Agent behind the chat (sql/07_agent.sql). It answers from the semantic view,
// searches saved dashboards and insights, and saves dashboards and action items through
// owner's-rights procedures, all as the signed-in user.
const AGENT = { database: "AMAZON_FINANCE_APP", schema: "APP", name: "AMAZON_VENDOR_FINANCE_AGENT" };
const AGENT_FQN = `${AGENT.database}.${AGENT.schema}.${AGENT.name}`;

export type Turn = { role: "user" | "assistant"; content: string };

const STATUS: Record<string, string> = {
  FinanceAnalyst: "Reading the finance model…",
  system_execute_sql: "Querying Snowflake…",
  PlatformSearch: "Searching saved dashboards and insights…",
  SaveDashboard: "Saving the dashboard…",
  CreateActionItem: "Adding the action item…",
  SaveInsight: "Saving the insight and its action items…",
};

type ToolUse = { tool_use_id: string; name: string; input?: Record<string, unknown> };
type ToolResult = { tool_use_id: string; name: string; status?: string; content?: { json?: Record<string, unknown> }[] };
type Table = { tool_use_id?: string; title?: string; result_set?: Parameters<typeof resultSetRows>[0] };

/**
 * Turns Cortex Agent output (streamed events or the final message's content items, which share
 * the same shapes) into chat events. Tracks tool inputs and SQL by tool_use_id so tables become
 * charts that remember their query, and procedure results become dashboard and action item cards.
 */
class EventMapper {
  private inputs = new Map<string, ToolUse>();
  private sqlByTool = new Map<string, string>();
  text = "";

  constructor(private emit: (e: AgentEvent) => void) {}

  status(text: string) {
    this.emit({ type: "status", text });
  }

  textDelta(t: string) {
    this.text += t;
    this.emit({ type: "text", text: this.text });
  }

  toolUse(t: ToolUse) {
    this.inputs.set(t.tool_use_id, t);
    if (STATUS[t.name]) this.status(STATUS[t.name]);
    // Internal steps (semantic context, SQL execution) only update the status line.
    if (t.name === "system_execute_sql" || !t.input || !Object.keys(t.input).length || "pruning_question" in t.input) return;
    const brief = t.name === "SaveDashboard" || t.name === "SaveInsight" ? { title: t.input.title } : t.input;
    this.emit({ type: "tool", name: t.name, input: brief });
  }

  toolResult(r: ToolResult) {
    const body = r.content?.[0]?.json ?? {};
    if (typeof body.sql === "string") this.sqlByTool.set(r.tool_use_id, body.sql);
    if (r.name !== "SaveDashboard" && r.name !== "CreateActionItem" && r.name !== "SaveInsight") return;

    const result = typeof body.result === "string" ? safeJson(body.result) : (body.result as Record<string, unknown> | undefined);
    if (!result?.ok) {
      this.emit({ type: "tool_result", name: r.name, ok: false });
      return;
    }
    if (r.name === "SaveDashboard") {
      this.emit({ type: "dashboard", id: String(result.dashboard_id), name: String(result.title ?? "Dashboard"), widgets: Number(result.widgets ?? 0) });
    } else if (r.name === "SaveInsight") {
      // One insight plus the action items it created, in the order the agent sent them.
      const input = this.inputs.get(r.tool_use_id)?.input ?? {};
      const ids = (result.action_item_ids as string[] | undefined) ?? [];
      const sent = safeJsonArray(String(input.actions_json ?? "[]"));
      this.emit({ type: "insight", id: String(result.insight_id), title: String(result.title ?? input.title ?? "Insight"), actions: ids.length });
      if (ids.length) {
        this.emit({
          type: "action_items",
          items: ids.map((id, i): ActionItem => ({
            id,
            title: String(sent[i]?.title ?? "Action item"),
            owner: (sent[i]?.owner as string) || null,
            priority: (sent[i]?.priority as ActionItem["priority"]) ?? "medium",
            due_date: (sent[i]?.due_date as string) || null,
            amount_usd: sent[i]?.amount_usd == null ? null : Number(sent[i].amount_usd),
            action_type: (sent[i]?.action_type as string) || undefined,
            source: "agent",
            status: "open",
            insight_id: String(result.insight_id),
          })),
        });
      }
    } else {
      const input = this.inputs.get(r.tool_use_id)?.input ?? {};
      const item: ActionItem = {
        id: String(result.action_item_id),
        title: String(input.title ?? "Action item"),
        owner: (input.owner as string) || null,
        priority: (input.priority as ActionItem["priority"]) ?? "medium",
        due_date: (input.due_date as string) || null,
        amount_usd: input.amount_usd == null ? null : Number(input.amount_usd),
        action_type: (input.action_type as string) || undefined,
        source: "agent",
        status: "open",
      };
      this.emit({ type: "action_items", items: [item] });
    }
  }

  table(t: Table) {
    if (!t.result_set) return;
    const { cols, rows } = resultSetRows(t.result_set);
    if (!rows.length) return;
    const sql = t.tool_use_id ? this.sqlByTool.get(t.tool_use_id) : undefined;
    this.emit({ type: "chart", spec: autoChart(t.title ?? "Result", cols, rows, sql) });
  }

  /** Non-streaming responses: replay the final message's content items in order. */
  content(items: Record<string, unknown>[]) {
    for (const c of items) {
      if (c.type === "text") this.textDelta(String(c.text ?? ""));
      else if (c.type === "tool_use") this.toolUse(c.tool_use as ToolUse);
      else if (c.type === "tool_result") this.toolResult(c.tool_result as ToolResult);
      else if (c.type === "table") this.table(c.table as Table);
    }
  }
}

function safeJsonArray(s: string): Record<string, unknown>[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeJson(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function requestBody(history: Turn[], message: string, stream: boolean) {
  const messages = [...history, { role: "user" as const, content: message }].map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  }));
  return { messages, stream };
}

/**
 * Runs one chat turn. Streams from the agent:run REST API; if REST isn't available
 * (no base URL, or the token is rejected), falls back to SNOWFLAKE.CORTEX.DATA_AGENT_RUN.
 * Returns the final answer text.
 */
export async function runAgent(history: Turn[], message: string, emit: (e: AgentEvent) => void, signal?: AbortSignal): Promise<string> {
  const mapper = new EventMapper(emit);
  const base = getSnowflakeBaseUrl();

  if (base) {
    const res = await fetch(`${base}/api/v2/databases/${AGENT.database}/schemas/${AGENT.schema}/agents/${AGENT.name}:run`, {
      method: "POST",
      headers: { ...(await restAuthHeaders()), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(requestBody(history, message, true)),
      signal,
    }).catch((e: Error) => {
      if (e.name === "AbortError") throw e;
      console.warn("[agent] REST request failed, using DATA_AGENT_RUN:", e.message);
      return null;
    });

    if (res?.ok && res.body) {
      await readStream(res.body, mapper);
      return mapper.text;
    }
    if (res && res.status !== 401 && res.status !== 403 && res.status !== 404) {
      throw new Error(`Cortex Agent error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    if (res) console.warn(`[agent] REST returned ${res.status}, using DATA_AGENT_RUN`);
  }

  mapper.status("Thinking…");
  const [row] = await sqlLong<{ r: string }>("SELECT SNOWFLAKE.CORTEX.DATA_AGENT_RUN(?, ?) AS r", [
    AGENT_FQN,
    JSON.stringify(requestBody(history, message, false)),
  ]);
  const out = safeJson(row?.r ?? "") as { content?: Record<string, unknown>[]; message?: string } | undefined;
  if (!out?.content) throw new Error(out?.message ?? "The agent returned no response");
  mapper.content(out.content);
  return mapper.text;
}

async function readStream(body: ReadableStream<Uint8Array>, mapper: EventMapper) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split(/\r?\n\r?\n/);
    buf = frames.pop() ?? "";
    for (const frame of frames) handleFrame(frame, mapper);
  }
  if (buf.trim()) handleFrame(buf, mapper);
}

function handleFrame(frame: string, mapper: EventMapper) {
  let event = "message";
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  const d = safeJson(data.join("\n"));
  if (!d) return;
  switch (event) {
    case "response.status":
      if (typeof d.message === "string") mapper.status(d.message);
      break;
    case "response.text.delta":
      mapper.textDelta(String(d.text ?? ""));
      break;
    case "response.tool_use":
      mapper.toolUse(d as unknown as ToolUse);
      break;
    case "response.tool_result":
      mapper.toolResult(d as unknown as ToolResult);
      break;
    case "response.table":
      mapper.table(d as Table);
      break;
    case "error":
      throw new Error(String(d.message ?? "Cortex Agent error"));
  }
}
