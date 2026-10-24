"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleCheck, Clock, ListChecks, Sparkles, TrendingUp } from "lucide-react";
import { RecommendationList } from "@/components/RecommendationList";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { AREA } from "@/lib/areas";
import { isOverdue, usd } from "@/lib/format";
import { useOps } from "@/lib/ops-store";
import { SAMPLE_PLAYBOOKS } from "@/lib/sample";

const noop = () => () => {};
const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** Success metrics from docs/plan.md. Targets are UI defaults until the platform provides them. */
function MetricCard({ label, value, hint, pct, good }: { label: string; value: string; hint: string; pct?: number; good?: boolean }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-2">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        {pct != null && <Progress value={pct} aria-label={label} />}
        <div className={`text-xs ${good === false ? "text-destructive" : "text-muted-foreground"}`}>{hint}</div>
      </CardContent>
    </Card>
  );
}

export default function TodayPage() {
  const router = useRouter();
  const { ready, sample, recommendations, items, metrics, reload } = useOps();
  // The agent creates insights and action items from chat, so load fresh data on every visit.
  useEffect(() => { reload(); }, [reload]);
  const [q, setQ] = useState("");
  // Time of day is client-only; the prerender shows a neutral greeting.
  const hello = useSyncExternalStore(noop, greeting, () => "Welcome back");

  const open = useMemo(
    () => recommendations.filter((r) => r.status === "new").sort((a, b) => b.estimated_value_usd - a.estimated_value_usd),
    [recommendations],
  );
  // Money at stake: open action items (most come from the agent's insights) plus recommendations
  // still waiting for a decision.
  const openItems = useMemo(
    () => items.filter((i) => (i.status === "open" || i.status === "in_progress") && (i.amount_usd ?? 0) > 0),
    [items],
  );
  const atStake = open.reduce((s, r) => s + r.estimated_value_usd, 0) + openItems.reduce((s, i) => s + (i.amount_usd ?? 0), 0);
  const stakeLabel = [
    openItems.length ? `${openItems.length} open action item${openItems.length === 1 ? "" : "s"}` : "",
    open.length ? `${open.length} open recommendation${open.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" and ") || "no open actions or recommendations";
  const byArea = useMemo(() => {
    const areaOf: Record<string, string> = {
      dispute_shortage: "shortage_recovery", fix_root_cause: "shortage_recovery",
      classify_deductions: "unexplained_deductions", resolve_deduction: "unexplained_deductions",
      chase_payment: "cash_collection", price_fix: "cash_collection", coop_review: "coop",
    };
    const m = new Map<string, number>();
    const add = (type: string | null | undefined, v: number) => { const k = areaOf[type ?? ""] ?? "other"; m.set(k, (m.get(k) ?? 0) + v); };
    for (const r of open) add(r.action_type, r.estimated_value_usd);
    for (const i of openItems) add(i.action_type, i.amount_usd ?? 0);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [open, openItems]);

  const mine = items
    .filter((i) => i.owner === "Me" && (i.status === "open" || i.status === "in_progress"))
    .sort((a, b) => Number(isOverdue(b.due_date)) - Number(isOverdue(a.due_date)) || (a.due_date ?? "9").localeCompare(b.due_date ?? "9"));
  const overdue = mine.filter((i) => isOverdue(i.due_date)).length;

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4 px-4 py-6 sm:px-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">{hello}</h1>
              {sample && <Badge variant="outline" className="border-warning/30 bg-warning-soft text-warning">Sample data</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {ready
                ? <>{open.length} decision{open.length === 1 ? "" : "s"} waiting{mine.length > 0 && <> · {mine.length} item{mine.length === 1 ? "" : "s"} on your plate</>}{overdue > 0 && <> · <span className="text-destructive">{overdue} overdue</span></>}</>
                : "Loading your day…"}
            </p>
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/assistant?q=${encodeURIComponent(q.trim())}`); }}
            className="flex w-full max-w-md gap-2"
          >
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything, e.g. Which deductions should I dispute first?" aria-label="Ask the assistant" />
            <Button type="submit" disabled={!q.trim()}><Sparkles /> Ask</Button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
        {/* Money at stake + recovered */}
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card className="bg-primary text-primary-foreground">
            <CardContent className="space-y-4">
              <div>
                <div className="text-sm opacity-80">Money at stake</div>
                <div className="text-4xl font-semibold tabular-nums tracking-tight">{ready ? usd(atStake) : "–"}</div>
                <div className="text-sm opacity-80">across {stakeLabel}</div>
              </div>
              {byArea.length > 0 && (
                <div className="space-y-2">
                  <div className="flex h-2 overflow-hidden rounded-full bg-primary-foreground/15" aria-hidden>
                    {byArea.map(([k, v], i) => (
                      <div key={k} style={{ width: `${(v / atStake) * 100}%`, opacity: 1 - i * 0.25 }} className="bg-primary-foreground" />
                    ))}
                  </div>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-90">
                    {byArea.map(([k, v]) => <li key={k}>{AREA[k]?.label ?? "Other"} · <span className="tabular-nums">{usd(v)}</span></li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex h-full flex-col justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground"><CircleCheck className="size-4 text-success" /> Recovered to date</div>
                <div className="text-4xl font-semibold tabular-nums tracking-tight text-success">{usd(metrics.recovered_to_date_usd)}</div>
                <div className="text-sm text-muted-foreground">recorded when action items are closed</div>
              </div>
              <Link href="/actions" className={`${buttonVariants({ variant: "outline", size: "sm" })} self-start`}>Open the board <ArrowRight /></Link>
            </CardContent>
          </Card>
        </div>

        {/* Success metrics */}
        <section aria-labelledby="metrics" className="space-y-3">
          <h2 id="metrics" className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground"><TrendingUp className="size-4" /> Success metrics</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label="Shortage recovery rate" value={`${metrics.shortage_recovery_rate_pct}%`} pct={metrics.shortage_recovery_rate_pct} hint="of disputable shortage $ recovered" />
            <MetricCard label="Deduction $ categorized" value={`${metrics.deduction_categorized_pct}%`} pct={metrics.deduction_categorized_pct} hint="goal: every deduction explained" />
            <MetricCard label="Unpaid > 60 days" value={usd(metrics.unpaid_over_60d_usd)} hint="invoices waiting on Amazon" good={metrics.unpaid_over_60d_usd < 500_000} />
            <MetricCard
              label="Insight → action"
              value={metrics.median_hours_to_action == null ? "–" : metrics.median_hours_to_action < 48 ? `${metrics.median_hours_to_action}h` : `${(metrics.median_hours_to_action / 24).toFixed(1)}d`}
              hint="median time from insight to owned action"
            />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          {/* Top decisions */}
          <section aria-labelledby="decisions" className="min-w-0 space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="decisions" className="text-sm font-medium text-muted-foreground">Top decisions</h2>
              <Link href="/insights" className={buttonVariants({ variant: "ghost", size: "sm" })}>All {open.length} <ArrowRight /></Link>
            </div>
            {!ready && [0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}
            {ready && open.length === 0 && (
              <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No decisions waiting. Nice work.</CardContent></Card>
            )}
            <RecommendationList recs={open.slice(0, 3)} compact />
          </section>

          <div className="space-y-6">
            {/* My work */}
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><Clock className="size-4" /> My work</CardTitle>
                <CardDescription>Open items assigned to you</CardDescription>
                <CardAction><Link href="/actions" className={buttonVariants({ variant: "ghost", size: "xs" })}>Board</Link></CardAction>
              </CardHeader>
              <CardContent>
                {mine.length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">Nothing assigned to you.</p>
                ) : (
                  <ul className="divide-y">
                    {mine.slice(0, 5).map((i) => {
                      const late = isOverdue(i.due_date);
                      return (
                        <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                          <span className="min-w-0 truncate">{i.title}</span>
                          <span className={`shrink-0 text-xs tabular-nums ${late ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                            {i.due_date ? (late ? "Overdue" : i.due_date) : "No date"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            {/* Playbooks */}
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-1.5"><ListChecks className="size-4" /> Run a playbook</CardTitle>
                <CardDescription>Guided, repeatable work. Finish in minutes.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {SAMPLE_PLAYBOOKS.map((p) => {
                  const A = AREA[p.problem_area];
                  return (
                    <Link key={p.id} href={`/playbooks/${p.id}`}
                      className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring outline-none">
                      {A && <A.icon className="size-4 text-muted-foreground" />}
                      <span className="flex-1 font-medium">{p.title}</span>
                      <span className="text-xs tabular-nums text-success">{usd(p.estimated_value_usd)}</span>
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
