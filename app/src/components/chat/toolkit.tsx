"use client";
import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import type { Toolkit, ToolCallMessagePartComponent } from "@assistant-ui/react";
import { AlertCircle, ArrowUpRight, CheckCircle2, CheckSquare, Database, FileSpreadsheet, LayoutDashboard, Loader2, Plus, Search } from "lucide-react";
import { DecisionBar } from "@/components/DecisionBar";
import { ChartCard } from "@/components/ChartCard";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ActionItem, AgentEvent, ChartSpec, Dashboard, UploadResult } from "@/lib/types";
import { UI_TOOLS } from "./use-finance-runtime";

const TOOL_LABEL: Record<string, { label: string; icon: typeof Database }> = {
  FinanceAnalyst: { label: "Cortex Analyst · finance model", icon: Database },
  PlatformSearch: { label: "Cortex Search · saved dashboards & insights", icon: Search },
  SaveDashboard: { label: "Saving dashboard", icon: LayoutDashboard },
  CreateActionItem: { label: "Adding action item", icon: CheckSquare },
  ListUploads: { label: "Uploaded files · listing tables", icon: FileSpreadsheet },
  QueryUploads: { label: "Uploaded files · querying", icon: FileSpreadsheet },
};

const AgentTool: ToolCallMessagePartComponent = ({ toolName, args, result }) => {
  const meta = TOOL_LABEL[toolName] ?? { label: toolName, icon: Database };
  const a = (args ?? {}) as Record<string, unknown>;
  const detail = String(a.query ?? a.title ?? a.message ?? "");
  return (
    <div className="my-1.5 flex items-start gap-2.5 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-info-soft text-info">
        <meta.icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium">
          {meta.label}
          {result ? <CheckCircle2 className="size-3.5 text-success" /> : <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        </div>
        {detail && <div className="truncate text-muted-foreground">{detail}</div>}
      </div>
    </div>
  );
};

/** Chart types a stored widget supports, and how a chat chart maps to a widget's chart_config. */
function widgetFrom(spec: ChartSpec) {
  const type = spec.type === "html" ? "table" : spec.type;
  const format = spec.unit === "USD" ? "usd" : spec.unit === "%" ? "percent" : "number";
  return { type, title: spec.title, description: spec.description, sql: spec.sql!, config: { x: spec.xKey, y: spec.yKeys, format, span: spec.type === "table" ? 3 : 2, variant: spec.variant } };
}

function SaveToDashboard({ spec }: { spec: ChartSpec }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Dashboard[] | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [savedTo, setSavedTo] = useState<string>();

  async function toggle() {
    setOpen((o) => !o);
    if (!drafts) {
      const r = await fetch("/api/dashboards");
      const list: Dashboard[] = r.ok ? await r.json() : [];
      setDrafts(list.filter((d) => d.mine && d.status === "draft"));
    }
  }

  async function save(dashboardId?: string) {
    setState("saving");
    setOpen(false);
    const r = await fetch("/api/dashboards/widgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dashboardId, widget: widgetFrom(spec) }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.ok) {
      setSavedTo(body.dashboardId);
      setState("saved");
      toast.success("Saved to dashboard");
    } else {
      setError(body.error ?? "Could not save");
      setState("error");
      toast.error(body.error ?? "Couldn't save this chart");
    }
  }

  if (state === "saved")
    return (
      <Link href={`/dashboard?d=${encodeURIComponent(savedTo ?? "")}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
        <CheckCircle2 /> Saved · open
      </Link>
    );
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={toggle} disabled={state === "saving"} title={state === "error" ? error : undefined}>
        {state === "saving" ? <Loader2 className="animate-spin" /> : state === "error" ? <AlertCircle className="text-destructive" /> : <Plus />}
        Save to dashboard
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border bg-popover p-1 text-sm shadow-md">
          <button className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => save()}>
            New dashboard: “{spec.title}”
          </button>
          {drafts === null && <div className="px-2 py-1.5 text-muted-foreground">Loading drafts…</div>}
          {drafts?.map((d) => (
            <button key={d.id} className="w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => save(d.id)}>
              {d.title}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ChartUI: ToolCallMessagePartComponent = ({ result }) => {
  const spec = result as ChartSpec | undefined;
  if (!spec) return null;
  return (
    <div className="my-3 space-y-2">
      <ChartCard spec={spec} action={spec.sql ? <SaveToDashboard spec={spec} /> : undefined} />
      <DecisionBar
        title={spec.title ?? "Follow up on this chart"}
        detail={spec.description}
        followUp={`About "${spec.title ?? "this chart"}": what is driving it, and what should we do next?`}
      />
    </div>
  );
};

const DashboardUI: ToolCallMessagePartComponent = ({ result }) => {
  const d = result as Extract<AgentEvent, { type: "dashboard" }> | undefined;
  if (!d) return null;
  return (
    <Card size="sm" className="my-3 bg-gradient-to-br from-info-soft to-background">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><LayoutDashboard className="size-4 text-info" /> {d.name}</CardTitle>
        <CardDescription>Dashboard ready · {d.widgets} widgets</CardDescription>
        <CardAction>
          <Link href={`/dashboard?d=${encodeURIComponent(d.id)}`} className={buttonVariants({ size: "sm" })}>
            Open <ArrowUpRight />
          </Link>
        </CardAction>
      </CardHeader>
    </Card>
  );
};

const PRIORITY: Record<string, string> = {
  high: "bg-danger-soft text-destructive border-destructive/30",
  medium: "bg-warning-soft text-warning border-warning/30",
  low: "bg-muted text-muted-foreground",
};

const ActionsUI: ToolCallMessagePartComponent = ({ result }) => {
  const items = (result as ActionItem[] | undefined) ?? [];
  if (!items.length) return null;
  return (
    <Card size="sm" className="my-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><CheckSquare className="size-4 text-success" /> {items.length} action item{items.length > 1 ? "s" : ""} added</CardTitle>
        <CardAction>
          <Link href="/actions" className={buttonVariants({ size: "sm", variant: "ghost" })}>View board <ArrowUpRight /></Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {items.map((a) => (
            <li key={a.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
              <div className="mt-1 size-3.5 shrink-0 rounded border" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{a.title}</div>
                {(a.owner || a.due_date || a.amount_usd) && (
                  <div className="text-xs text-muted-foreground">
                    {[a.amount_usd ? `$${Math.round(a.amount_usd).toLocaleString("en-US")} at stake` : null, a.owner, a.due_date && `due ${a.due_date}`].filter(Boolean).join(" · ")}
                  </div>
                )}
              </div>
              <Badge variant="outline" className={PRIORITY[a.priority ?? "medium"]}>{a.priority ?? "medium"}</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
};

const UploadUI: ToolCallMessagePartComponent = ({ result }) => {
  const u = result as UploadResult | undefined;
  if (!u) return null;
  const cols = u.preview[0] ? Object.keys(u.preview[0]) : u.columns.map((c) => c.name);
  return (
    <Card size="sm" className="my-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="size-4 text-success" /> {u.file} uploaded to Snowflake</CardTitle>
        <CardDescription className="font-mono text-xs">{u.table} · {u.rows.toLocaleString("en-US")} rows</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1">
          {u.columns.map((c) => (
            <Badge key={c.name} variant="outline" className="font-mono text-[11px]">{c.name} <span className="text-muted-foreground">{c.type.toLowerCase()}</span></Badge>
          ))}
        </div>
        {u.preview.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50"><tr>{cols.map((c) => <th key={c} className="px-2 py-1 text-left font-medium text-muted-foreground">{c}</th>)}</tr></thead>
              <tbody>
                {u.preview.map((r, i) => (
                  <tr key={i} className="border-t">{cols.map((c) => <td key={c} className="px-2 py-1 tabular-nums">{r[c] == null ? "" : String(r[c])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

const ErrorUI: ToolCallMessagePartComponent = ({ result }) => (
  <div className="my-2 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
    <AlertCircle className="mt-0.5 size-4 shrink-0" />
    <span>{String(result ?? "Something went wrong")}</span>
  </div>
);

/** UI-only renderers: these tools run on the backend; we only draw their results. */
export const chatToolkit: Toolkit = {
  ...Object.fromEntries(Object.keys(TOOL_LABEL).map((name) => [name, { type: "backend" as const, render: AgentTool }])),
  [UI_TOOLS.chart]: { type: "backend", render: ChartUI },
  [UI_TOOLS.dashboard]: { type: "backend", render: DashboardUI },
  [UI_TOOLS.actions]: { type: "backend", render: ActionsUI },
  [UI_TOOLS.upload]: { type: "backend", render: UploadUI },
  [UI_TOOLS.error]: { type: "backend", render: ErrorUI },
};
