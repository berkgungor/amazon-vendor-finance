export type Chat = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

export type ChartSpec = {
  type: "bar" | "line" | "area" | "pie" | "table" | "kpi" | "html";
  title: string;
  xKey?: string;
  yKeys?: string[];
  data: Record<string, string | number | null>[];
  unit?: string;
  description?: string;
  /** Widget width on the dashboard grid (1–3 columns). */
  span?: 1 | 2 | 3;
  /** type "html": self-contained snippet rendered in a sandboxed iframe. */
  html?: string;
  height?: number;
  /** shadcn-style variants: line/area → natural | linear | step | dots | labels | gradient; bar → horizontal | stacked | labels; pie → donut | labels */
  variant?: "natural" | "linear" | "step" | "dots" | "labels" | "gradient" | "horizontal" | "stacked" | "donut";
  /** Card footer, e.g. { value: 5.2, label: "this month" } → "Trending up by 5.2% this month" */
  trend?: { value: number; label?: string };
  footnote?: string;
  /** The query that produced the data; lets a chat chart be saved as a live dashboard widget. */
  sql?: string;
};

/** How a stored widget maps its query columns to a chart (OPS.DASHBOARD_WIDGETS.CHART_CONFIG). */
export type ChartConfig = {
  x?: string;
  y?: string[];
  format?: "usd" | "percent" | "number";
  span?: 1 | 2 | 3;
  variant?: ChartSpec["variant"];
};

export type DashboardStatus = "draft" | "published" | "archived";

export type Dashboard = {
  id: string;
  title: string;
  description: string | null;
  business_problem: string | null;
  status: DashboardStatus;
  created_by: string;
  created_via: string;
  updated_at: string;
  widget_count: number;
  mine: boolean;
};

/** A widget rendered with live data, or the error its query raised. */
export type WidgetData = {
  id: string;
  position: number;
  spec: ChartSpec;
  error?: string;
};

export type ActionStatus = "open" | "in_progress" | "done" | "dismissed";

export type ActionItem = {
  id: string;
  title: string;
  action_type?: string;
  notes?: string | null;
  owner?: string | null;
  priority?: "low" | "medium" | "high";
  status: ActionStatus;
  due_date?: string | null;
  amount_usd?: number | null;
  /** Amount actually recovered or collected, recorded on completion. */
  outcome_amount_usd?: number | null;
  source?: "agent" | "user" | "alert" | "recommendation" | string | null;
  recommendation_id?: string | null;
  created_at?: string;
};

/** Events streamed to the chat UI and persisted on assistant messages. */
export type AgentEvent =
  | { type: "status"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input?: unknown }
  | { type: "tool_result"; name: string; ok: boolean }
  | { type: "chart"; spec: ChartSpec }
  | { type: "dashboard"; id: string; name: string; widgets: number }
  | { type: "action_items"; items: ActionItem[] }
  | { type: "upload"; upload: UploadResult }
  | { type: "error"; text: string }
  | { type: "done"; text: string; chatId: string };

/** A file uploaded in chat and loaded into AMAZON_FINANCE_APP.UPLOADS (OPS.LOAD_UPLOAD). */
export type UploadResult = {
  file: string;
  table: string;
  rows: number;
  columns: { name: string; type: string }[];
  preview: Record<string, string | number | null>[];
};

export type Message = {
  id: string;
  chat_id: string;
  role: "user" | "assistant";
  content: string;
  events: AgentEvent[];
  created_at: string;
};

/** OPS.INSIGHTS row (sql/04_ops_tables.sql). */
export type Insight = {
  id: string;
  generated_at: string;
  problem_area: "shortage_recovery" | "unexplained_deductions" | "cash_collection" | string;
  severity: "high" | "medium" | "low";
  title: string;
  summary: string;
  metric: string;
  current_value: number | null;
  comparison_value: number | null;
  change_pct: number | null;
  evidence_sql?: string | null;
  related_entity?: string | null;
  dashboard_id?: string | null;
};

/** OPS.RECOMMENDED_ACTIONS row (sql/04_ops_tables.sql). */
export type Recommendation = {
  id: string;
  insight_id: string | null;
  action_type: string;
  title?: string;
  entity_type?: string | null;
  entity_id?: string | null;
  estimated_value_usd: number;
  confidence: "high" | "medium" | "low";
  rationale: string;
  status: "new" | "accepted" | "dismissed" | "expired";
  action_item_id?: string | null;
  expires_at?: string | null;
  created_at?: string;
};

/** Success metrics from docs/plan.md, shown on the Today page. */
export type Metrics = {
  shortage_recovery_rate_pct: number;
  deduction_categorized_pct: number;
  unpaid_over_60d_usd: number;
  median_hours_to_action: number | null;
  recovered_to_date_usd: number;
};

export type PlaybookStep = {
  id: string;
  title: string;
  description: string;
  /** "review" shows a checklist of rows; "assign" asks for owner/due; "confirm" creates action items. */
  kind: "review" | "assign" | "confirm";
};

export type Playbook = {
  id: string;
  title: string;
  problem_area: string;
  summary: string;
  action_type: string;
  estimated_value_usd: number;
  /** Candidate rows the playbook works through. */
  rows: { id: string; label: string; detail: string; value_usd: number }[];
  steps: PlaybookStep[];
};

export type Automation = {
  id: string;
  title: string;
  description: string;
  kind: "digest" | "alert" | "refresh";
  channel: "slack" | "email" | "app";
  cadence: "hourly" | "daily" | "weekly";
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  threshold_usd?: number;
};
