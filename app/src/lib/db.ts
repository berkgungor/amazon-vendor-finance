import "server-only";
import { plainRows, widgetChart } from "./charts";
import { callProc, json, sql, sqlLongRaw, type ProcResult } from "./snowflake";
import type { ActionItem, ActionStatus, ChartConfig, Chat, Dashboard, DashboardStatus, Insight, Message, Metrics, Recommendation, WidgetData } from "./types";

// All reads run as the signed-in user; all writes go through owner's-rights procedures,
// which validate input and record CURRENT_USER().

function ok(r: ProcResult): ProcResult {
  if (!r?.ok) throw new Error(r?.error ?? "Request failed");
  return r;
}

const parse = <T>(v: unknown, fallback: T): T => (typeof v === "string" ? JSON.parse(v) : (v ?? fallback)) as T;

// ---------- chats ----------
export async function listChats(): Promise<Chat[]> {
  return sql<Chat>(
    "SELECT chat_id AS id, title, created_at, updated_at FROM AMAZON_FINANCE_APP.APP.MY_CHATS ORDER BY updated_at DESC LIMIT 50",
  );
}

export async function createChat(title: string): Promise<string> {
  return String(ok(await callProc("AMAZON_FINANCE_APP.APP.CREATE_CHAT", [title])).chat_id);
}

export async function deleteChat(id: string) {
  ok(await callProc("AMAZON_FINANCE_APP.APP.DELETE_CHAT", [id]));
}

export async function listMessages(chatId: string): Promise<Message[]> {
  const rows = await sql<Message & { events: unknown }>(
    `SELECT message_id AS id, chat_id, role, content, events, created_at
       FROM AMAZON_FINANCE_APP.APP.MY_MESSAGES WHERE chat_id = ? ORDER BY created_at, message_id`,
    [chatId],
  );
  return rows.map((r) => ({ ...r, content: r.content ?? "", events: parse(r.events, []) }));
}

export async function addMessage(chatId: string, role: "user" | "assistant", content: string, events: unknown[] = []) {
  ok(await callProc("AMAZON_FINANCE_APP.APP.SAVE_MESSAGE", [chatId, role, content, JSON.stringify(events)]));
}

// ---------- dashboards ----------
/** Published dashboards plus the user's own drafts. */
export async function listDashboards(): Promise<Dashboard[]> {
  const rows = await sql<Dashboard & { mine: unknown }>(
    `SELECT d.dashboard_id AS id, d.title, d.description, d.business_problem, d.status, d.created_by, d.created_via,
            d.updated_at, COUNT(w.widget_id) AS widget_count, d.created_by = CURRENT_USER() AS mine
       FROM AMAZON_FINANCE_APP.OPS.DASHBOARDS d
       LEFT JOIN AMAZON_FINANCE_APP.OPS.DASHBOARD_WIDGETS w ON w.dashboard_id = d.dashboard_id
      WHERE d.status = 'published' OR (d.status = 'draft' AND d.created_by = CURRENT_USER())
      GROUP BY ALL
      ORDER BY IFF(d.status = 'published', 0, 1), d.updated_at DESC`,
  );
  return rows.map((r) => ({ ...r, widget_count: Number(r.widget_count), mine: Boolean(r.mine) }));
}

type WidgetRow = {
  widget_id: string;
  position: number;
  widget_type: string;
  title: string;
  description: string | null;
  query_sql: string;
  chart_config: unknown;
};

/** Runs every widget's stored query as the signed-in user, in parallel; one failure doesn't break the rest. */
export async function dashboardData(dashboardId: string): Promise<WidgetData[]> {
  const widgets = await sql<WidgetRow>(
    `SELECT w.widget_id, w.position, w.widget_type, w.title, w.description, w.query_sql, w.chart_config
       FROM AMAZON_FINANCE_APP.OPS.DASHBOARD_WIDGETS w
       JOIN AMAZON_FINANCE_APP.OPS.DASHBOARDS d ON d.dashboard_id = w.dashboard_id
      WHERE w.dashboard_id = ? AND (d.status = 'published' OR d.created_by = CURRENT_USER())
      ORDER BY w.position`,
    [dashboardId],
  );
  return Promise.all(
    widgets.map(async (w) => {
      const meta = { ...w, chart_config: parse<ChartConfig | null>(w.chart_config, null) };
      try {
        const rows = plainRows(await sqlLongRaw(w.query_sql.replace(/;\s*$/, "")));
        return { id: w.widget_id, position: Number(w.position), spec: widgetChart(meta, rows) };
      } catch (e) {
        return {
          id: w.widget_id,
          position: Number(w.position),
          spec: widgetChart(meta, []),
          error: (e as Error).message,
        };
      }
    }),
  );
}

export async function setDashboardStatus(id: string, status: DashboardStatus) {
  return ok(await callProc("AMAZON_FINANCE_APP.OPS.SET_DASHBOARD_STATUS", [id, status]));
}

export async function createDashboard(title: string, description: string | null, sourceQuestion: string | null) {
  const r = ok(await callProc("AMAZON_FINANCE_APP.OPS.CREATE_DASHBOARD", [title, description, "general", sourceQuestion, "user"]));
  return String(r.dashboard_id);
}

/** Saves a chart from chat as a live widget (ADD_WIDGET validates the query). */
export async function addWidget(dashboardId: string, w: { type: string; title: string; description?: string; sql: string; config: ChartConfig }) {
  return ok(
    await callProc("AMAZON_FINANCE_APP.OPS.ADD_WIDGET", [
      dashboardId,
      w.type,
      w.title,
      w.description ?? null,
      w.sql,
      json(w.config),
    ]),
  );
}

// ---------- action items ----------
export async function listActionItems(): Promise<ActionItem[]> {
  const rows = await sql<ActionItem>(
    `SELECT a.action_item_id AS id, a.title, a.action_type, a.notes, a.owner, a.priority, a.status,
            TO_VARCHAR(a.due_date) AS due_date, a.amount_usd, a.outcome_amount_usd, a.source, a.created_at,
            a.recommendation_id, a.insight_id, i.title AS insight_title
       FROM AMAZON_FINANCE_APP.OPS.ACTION_ITEMS a
       LEFT JOIN AMAZON_FINANCE_APP.OPS.INSIGHTS i ON i.insight_id = a.insight_id
      WHERE a.status <> 'dismissed'
      ORDER BY IFF(a.status = 'done', 1, 0), DECODE(a.priority, 'high', 0, 'medium', 1, 2), a.due_date NULLS LAST, a.created_at DESC`,
  );
  return rows.map((r) => ({
    ...r,
    amount_usd: r.amount_usd == null ? null : Number(r.amount_usd),
    outcome_amount_usd: r.outcome_amount_usd == null ? null : Number(r.outcome_amount_usd),
  }));
}

export async function createActionItem(i: { title: string; action_type?: string; notes?: string | null; owner?: string | null; priority?: string; due_date?: string | null; amount_usd?: number | null; source?: string }) {
  const r = ok(
    await callProc("AMAZON_FINANCE_APP.OPS.CREATE_ACTION_ITEM", [
      i.action_type ?? "other",
      i.title,
      null,
      null,
      i.amount_usd ?? null,
      i.priority ?? "medium",
      i.owner ?? null,
      i.due_date ?? null,
      i.notes ?? null,
      i.source ?? "user",
    ]),
  );
  return String(r.action_item_id);
}

export async function updateActionItem(id: string, u: { status?: ActionStatus; owner?: string | null; outcome_amount_usd?: number | null; notes?: string | null }) {
  return ok(
    await callProc("AMAZON_FINANCE_APP.OPS.UPDATE_ACTION_ITEM", [id, u.status ?? null, u.owner ?? null, u.outcome_amount_usd ?? null, u.notes ?? null]),
  );
}

// ---------- insights & recommendations ----------
export async function listInsights(): Promise<Insight[]> {
  const rows = await sql<Insight & { actions: unknown }>(
    `SELECT i.insight_id AS id, i.business_problem AS problem_area, i.severity, i.title, i.summary, i.metric_name AS metric,
            i.current_value, i.comparison_value, i.change_pct, i.evidence_sql,
            IFF(i.entity_id IS NULL, NULL, i.entity_type || ' ' || i.entity_id) AS related_entity, i.dashboard_id, i.generated_at,
            ARRAY_AGG(IFF(a.action_item_id IS NULL, NULL,
                          OBJECT_CONSTRUCT('id', a.action_item_id, 'title', a.title, 'status', a.status,
                                           'priority', a.priority, 'amount_usd', a.amount_usd, 'owner', a.owner)))
              WITHIN GROUP (ORDER BY a.amount_usd DESC NULLS LAST) AS actions
       FROM AMAZON_FINANCE_APP.OPS.INSIGHTS i
       LEFT JOIN AMAZON_FINANCE_APP.OPS.ACTION_ITEMS a ON a.insight_id = i.insight_id AND a.status <> 'dismissed'
      WHERE i.status = 'active'
      GROUP BY ALL
      ORDER BY DECODE(i.severity, 'high', 0, 'medium', 1, 2), i.generated_at DESC LIMIT 50`,
  );
  return rows.map((r) => ({
    ...r,
    current_value: r.current_value == null ? null : Number(r.current_value),
    comparison_value: r.comparison_value == null ? null : Number(r.comparison_value),
    change_pct: r.change_pct == null ? null : Number(r.change_pct),
    actions: (parse<Insight["actions"]>(r.actions, []) ?? []).map((a) => ({ ...a, amount_usd: a.amount_usd == null ? null : Number(a.amount_usd) })),
  }));
}

export async function listRecommendations(): Promise<Recommendation[]> {
  const rows = await sql<Recommendation>(
    `SELECT recommendation_id AS id, insight_id, title, rationale, action_type, entity_type, entity_id,
            estimated_value_usd, confidence, status, action_item_id, expires_at, created_at
       FROM AMAZON_FINANCE_APP.OPS.RECOMMENDED_ACTIONS
      WHERE status = 'new' AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP())
      ORDER BY estimated_value_usd DESC NULLS LAST LIMIT 50`,
  );
  return rows.map((r) => ({ ...r, estimated_value_usd: Number(r.estimated_value_usd ?? 0) }));
}

export async function acceptRecommendation(id: string, owner: string | null) {
  return ok(await callProc("AMAZON_FINANCE_APP.OPS.ACCEPT_RECOMMENDATION", [id, owner]));
}

export async function dismissRecommendation(id: string, reason: string | null) {
  return ok(await callProc("AMAZON_FINANCE_APP.OPS.DISMISS_RECOMMENDATION", [id, reason]));
}

// ---------- metrics ----------
/** Success metrics from docs/plan.md, shown on the Today page. */
export async function getMetrics(): Promise<Metrics> {
  const [m] = await sql<Record<keyof Metrics, unknown>>(
    `SELECT
       ROUND(100 * (SELECT SUM(resolved_amount) FROM AMAZON_FINANCE_APP.STAGING.STG_DISPUTES)
             / NULLIF((SELECT SUM(deducted_amount) FROM AMAZON_FINANCE_APP.STAGING.STG_DEDUCTION_CLAIMS WHERE category = 'Shortage'), 0), 2)
         AS shortage_recovery_rate_pct,
       ROUND(100 * (SELECT SUM(IFF(category_method <> 'Unresolved', deducted_amount, 0)) / NULLIF(SUM(deducted_amount), 0)
                      FROM AMAZON_FINANCE_APP.STAGING.STG_DEDUCTION_CLAIMS), 2) AS deduction_categorized_pct,
       (SELECT COALESCE(SUM(unpaid_amount), 0) FROM AMAZON_FINANCE_APP.STAGING.STG_INVOICES
         WHERE invoice_status_group <> 'PAID' AND unpaid_amount > 0
           AND DATEDIFF('day', COALESCE(payment_due_date, invoice_date), CURRENT_DATE()) > 60) AS unpaid_over_60d_usd,
       (SELECT MEDIAN(DATEDIFF('hour', r.created_at, a.created_at))
          FROM AMAZON_FINANCE_APP.OPS.RECOMMENDED_ACTIONS r
          JOIN AMAZON_FINANCE_APP.OPS.ACTION_ITEMS a ON a.action_item_id = r.action_item_id) AS median_hours_to_action,
       (SELECT COALESCE(SUM(resolved_amount), 0) FROM AMAZON_FINANCE_APP.STAGING.STG_DISPUTES)
         + (SELECT COALESCE(SUM(outcome_amount_usd), 0) FROM AMAZON_FINANCE_APP.OPS.ACTION_ITEMS) AS recovered_to_date_usd`,
  );
  return {
    shortage_recovery_rate_pct: Number(m.shortage_recovery_rate_pct ?? 0),
    deduction_categorized_pct: Number(m.deduction_categorized_pct ?? 0),
    unpaid_over_60d_usd: Number(m.unpaid_over_60d_usd ?? 0),
    median_hours_to_action: m.median_hours_to_action == null ? null : Number(m.median_hours_to_action),
    recovered_to_date_usd: Number(m.recovered_to_date_usd ?? 0),
  };
}
