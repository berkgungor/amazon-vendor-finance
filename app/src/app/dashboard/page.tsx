"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Archive, LayoutDashboard, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { ChartCard } from "@/components/ChartCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { fmt } from "@/components/ChartView";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChartSpec, Dashboard, WidgetData } from "@/lib/types";

const SPAN = { 1: "lg:col-span-1", 2: "lg:col-span-2", 3: "lg:col-span-3" } as const;
// Preview shown until live dashboards exist, matching the Revenue trend design.
const SAMPLE_REVENUE_TREND: ChartSpec = {
  type: "area", variant: "gradient", title: "Revenue trend", description: "Closed-won revenue, last 6 months",
  xKey: "month", yKeys: ["Enterprise", "Mid Market"], unit: "USD",
  data: [
    { month: "May", Enterprise: 186_000, "Mid Market": 80_000 },
    { month: "Jun", Enterprise: 205_000, "Mid Market": 92_000 },
    { month: "Jul", Enterprise: 237_000, "Mid Market": 120_000 },
    { month: "Aug", Enterprise: 173_000, "Mid Market": 190_000 },
    { month: "Sep", Enterprise: 209_000, "Mid Market": 130_000 },
    { month: "Oct", Enterprise: 264_000, "Mid Market": 140_000 },
  ],
  trend: { value: 5.2, label: "this month" }, footnote: "May – October 2026",
};

const SAMPLE_DEALS_BY_STAGE: ChartSpec = {
  type: "pie", variant: "donut", title: "Deals by stage", description: "Count of open and closed deals",
  xKey: "stage", yKeys: ["deals"],
  data: [
    { stage: "Closed won", deals: 14 },
    { stage: "Negotiation", deals: 9 },
    { stage: "Proposal", deals: 7 },
    { stage: "Closed lost", deals: 5 },
  ],
};

const SAMPLE_KPIS = [
  { label: "Pipeline value", value: "$1.3M", delta: 8.4 },
  { label: "Closed won", value: "$486.5K", delta: 12.1 },
  { label: "Win rate", value: "62%", delta: -3.2 },
  { label: "Open deals", value: "14", delta: 2.0 },
];

const NEW_DASHBOARD = "/assistant?q=Build%20a%20shortage%20recovery%20dashboard";

function defaultSpan(w: WidgetData) {
  return w.spec.span ?? (w.spec.type === "table" ? 3 : 1);
}

export default function DashboardPage() {
  const [dashboards, setDashboards] = useState<Dashboard[] | null>(null);
  const [active, setActive] = useState("");
  const [widgets, setWidgets] = useState<WidgetData[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // State is set in .then callbacks so the effects below don't set state synchronously.
  const loadList = useCallback((wanted?: string | null) =>
    fetch("/api/dashboards").then(async (r) => {
      const body = await r.json();
      if (!r.ok) return setError(body.error ?? "Could not load dashboards");
      const list = body as Dashboard[];
      setDashboards(list);
      setActive((cur) => list.find((d) => d.id === (wanted ?? cur))?.id ?? list[0]?.id ?? "");
    }), []);

  useEffect(() => {
    loadList(new URLSearchParams(window.location.search).get("d"));
  }, [loadList]);

  const loadWidgets = useCallback((id: string) => {
    let live = true;
    fetch(`/api/dashboards/${encodeURIComponent(id)}`).then(async (r) => {
      const body = await r.json();
      if (live) setWidgets(r.ok ? (body as WidgetData[]) : []);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => (active ? loadWidgets(active) : undefined), [active, loadWidgets]);

  function select(id: string) {
    setWidgets(null);
    setActive(id);
    window.history.replaceState(null, "", `?d=${encodeURIComponent(id)}`);
  }

  async function setStatus(status: "published" | "archived") {
    setBusy(true);
    const r = await fetch(`/api/dashboards/${encodeURIComponent(active)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await r.json();
    setBusy(false);
    if (!r.ok) return void toast.error(body.error ?? "Couldn't update the dashboard");
    toast.success(status === "published" ? "Dashboard published" : "Dashboard archived");
    await loadList(status === "archived" ? null : active);
  }

  const current = dashboards?.find((d) => d.id === active);
  const kpis = widgets?.filter((w) => w.spec.type === "kpi") ?? [];
  const rest = widgets?.filter((w) => w.spec.type !== "kpi") ?? [];

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-8 py-5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold tracking-tight truncate">{current?.title ?? "Dashboards"}</h1>
              {current && (
                <Badge variant="outline" className={current.status === "published" ? "border-success/30 bg-success-soft text-success" : "text-muted-foreground"}>
                  {current.status}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">
              {current?.description ?? "Live from Snowflake: every widget runs its query when you open it"}
              {current && <> · {current.created_via === "agent" ? "built by the agent for" : "created by"} {current.created_by}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {current && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => { setWidgets(null); loadWidgets(current.id); }} aria-label="Refresh">
                <RefreshCw />
              </Button>
            )}
            {current?.mine && current.status === "draft" && (
              <Button size="sm" variant="outline" onClick={() => setStatus("published")} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Send />} Publish
              </Button>
            )}
            {current?.mine && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmArchive(true)} disabled={busy}>
                <Archive /> Archive
              </Button>
            )}
            <Link href={NEW_DASHBOARD} className={buttonVariants({ size: "sm" })}>
              <Sparkles /> New dashboard
            </Link>
          </div>
        </div>
        {dashboards && dashboards.length > 1 && (
          <div className="mx-auto max-w-7xl px-4 sm:px-8 pb-3 overflow-x-auto">
            <Tabs value={active} onValueChange={(v) => select(String(v))}>
              <TabsList>
                {dashboards.map((d) => (
                  <TabsTrigger key={d.id} value={d.id} className="gap-1.5">
                    {d.title}
                    {d.status === "draft" && <span className="text-[10px] text-muted-foreground">draft</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-8 py-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-danger-soft px-4 py-2.5 text-sm text-destructive">{error}</div>
        )}

        {dashboards?.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <LayoutDashboard className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">No dashboards yet</p>
              <p className="text-sm text-muted-foreground">Ask the assistant to build one. It saves the queries, so the numbers stay live.</p>
              <Link href={NEW_DASHBOARD} className={`${buttonVariants({ size: "sm" })} mt-4`}>
                <Sparkles /> Build a shortage recovery dashboard
              </Link>
            </CardContent>
          </Card>
        )}

        {(error || dashboards?.length === 0) && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {SAMPLE_KPIS.map((k) => (
              <Card key={k.label} size="sm">
                <CardContent>
                  <div className="text-sm text-muted-foreground">{k.label}</div>
                  <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{k.value}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={`rounded px-1 py-0.5 font-medium tabular-nums ${k.delta >= 0 ? "bg-success-soft text-success" : "bg-danger-soft text-destructive"}`}>
                      {k.delta >= 0 ? "+" : ""}{k.delta.toFixed(1)}%
                    </span>
                    vs prior period
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
        {(error || dashboards?.length === 0) && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <ChartCard
              spec={SAMPLE_REVENUE_TREND}
              className="lg:col-span-2"
              action={<Badge variant="outline" className="border-warning/30 bg-warning-soft text-warning">Sample data</Badge>}
            />
            <ChartCard spec={SAMPLE_DEALS_BY_STAGE} />
          </div>
        )}

        {active && widgets === null && <DashboardSkeleton />}

        {kpis.length > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((w) => <KpiCard key={w.id} widget={w} />)}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {rest.map((w) =>
            w.error ? (
              <WidgetError key={w.id} widget={w} className={SPAN[defaultSpan(w)]} />
            ) : (
              <ChartCard key={w.id} spec={w.spec} className={SPAN[defaultSpan(w)]} />
            ),
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive "${current?.title ?? "dashboard"}"?`}
        description="It will no longer be listed. Its saved queries are kept."
        confirmLabel="Archive dashboard"
        destructive
        onConfirm={() => { setConfirmArchive(false); setStatus("archived"); }}
      />
    </div>
  );
}

function KpiCard({ widget }: { widget: WidgetData }) {
  const d = widget.spec.data[0];
  return (
    <Card size="sm" title={widget.spec.description}>
      <CardContent>
        <div className="text-sm text-muted-foreground">{widget.spec.title}</div>
        <div className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
          {widget.error ? <span className="text-sm text-destructive">Query failed</span> : fmt(d?.value, widget.spec.unit)}
        </div>
        {widget.spec.description && <div className="mt-1 text-xs text-muted-foreground line-clamp-1">{widget.spec.description}</div>}
      </CardContent>
    </Card>
  );
}

function WidgetError({ widget, className }: { widget: WidgetData; className: string }) {
  return (
    <Card className={className}>
      <CardContent className="space-y-1 py-6">
        <div className="font-medium">{widget.spec.title}</div>
        <div className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> <span className="line-clamp-3">{widget.error}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-muted" />)}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="h-72 rounded-xl bg-muted lg:col-span-2" />
        <div className="h-72 rounded-xl bg-muted" />
      </div>
    </div>
  );
}
