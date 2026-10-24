"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckSquare, Lightbulb, MessageSquare } from "lucide-react";
import { AREA } from "@/lib/areas";
import { DecisionBar } from "@/components/DecisionBar";
import { RecommendationList } from "@/components/RecommendationList";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanize, usd } from "@/lib/format";
import { useOps } from "@/lib/ops-store";
import type { Insight } from "@/lib/types";

const SEVERITY: Record<Insight["severity"], string> = {
  high: "bg-danger-soft text-destructive border-destructive/30",
  medium: "bg-warning-soft text-warning border-warning/30",
  low: "bg-muted text-muted-foreground",
};

const metricValue = (i: Insight, v: number | null) =>
  v == null ? "–" : /\$/.test(i.metric) ? usd(v) : /rate|%/i.test(i.metric) ? `${v}%` : Intl.NumberFormat("en-US").format(v);

export default function InsightsPage() {
  const { ready, sample, insights, recommendations: recs, reload } = useOps();
  // Insights and their action items are written by the agent, so load fresh data on every visit.
  useEffect(() => { reload(); }, [reload]);
  const [area, setArea] = useState("all");

  const open = useMemo(
    () => recs.filter((r) => r.status === "new").sort((a, b) => b.estimated_value_usd - a.estimated_value_usd),
    [recs],
  );
  // Insights from the agent come with action items already created, so the value at stake is the
  // open action items linked to insights plus any recommendations still waiting for a decision.
  const insightActions = useMemo(
    () => insights.flatMap((i) => (i.actions ?? []).filter((a) => a.status === "open" || a.status === "in_progress"))
      .sort((a, b) => (b.amount_usd ?? 0) - (a.amount_usd ?? 0)),
    [insights],
  );
  const totalValue = open.reduce((s, r) => s + r.estimated_value_usd, 0) + insightActions.reduce((s, a) => s + (a.amount_usd ?? 0), 0);
  const counts = [
    insightActions.length ? `${insightActions.length} open action item${insightActions.length === 1 ? "" : "s"} from insights` : "",
    open.length ? `${open.length} open recommendation${open.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" and ") || "no open actions or recommendations";
  const shown = insights.filter((i) => area === "all" || i.problem_area === area);

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Lightbulb className="size-5" /> Insights</h1>
              {sample && <Badge variant="outline" className="border-warning/30 bg-warning-soft text-warning">Sample data</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">What changed, why it matters, and what to do next.</p>
          </div>
          <Link href="/assistant?q=Explain%20the%20biggest%20recovery%20opportunity%20right%20now" className={buttonVariants({ variant: "outline", size: "sm" })}>
            <MessageSquare /> Ask the assistant
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:px-8 lg:grid-cols-[1fr_380px]">
        {/* Insights feed */}
        <section aria-labelledby="feed" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="feed" className="text-sm font-medium text-muted-foreground">Latest insights</h2>
            <Tabs value={area} onValueChange={(v) => setArea(String(v))}>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                {Object.entries(AREA).map(([k, v]) => <TabsTrigger key={k} value={k}>{v.label}</TabsTrigger>)}
              </TabsList>
            </Tabs>
          </div>

          {!ready && [0, 1, 2].map((i) => <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />)}
          {ready && shown.length === 0 && (
            <Card className="border-dashed"><CardContent className="py-10 text-center text-sm text-muted-foreground">No insights in this area yet.</CardContent></Card>
          )}

          {shown.map((i) => {
            const A = AREA[i.problem_area] ?? { label: humanize(i.problem_area), icon: Lightbulb, playbook: "" };
            return (
              <Card key={i.id}>
                <CardHeader>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <A.icon className="size-3.5" /> {A.label}
                    <span aria-hidden>·</span>
                    <time dateTime={i.generated_at}>{new Date(i.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</time>
                  </div>
                  <CardTitle className="text-base">{i.title}</CardTitle>
                  <CardDescription>{i.summary}</CardDescription>
                  <CardAction>
                    <Badge variant="outline" className={SEVERITY[i.severity]}>
                      {i.severity === "high" && <AlertTriangle />} {i.severity}
                    </Badge>
                  </CardAction>
                </CardHeader>
                <CardFooter className="flex flex-wrap items-end justify-between gap-4 border-t pt-4">
                  <div>
                    <div className="text-xs text-muted-foreground">{i.metric}</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xl font-semibold tabular-nums tracking-tight">{metricValue(i, i.current_value)}</span>
                      {i.comparison_value != null && <span className="text-sm text-muted-foreground">vs {metricValue(i, i.comparison_value)}</span>}
                      {i.change_pct != null && (
                        <span className={`text-xs font-medium ${i.change_pct >= 0 ? "text-success" : "text-destructive"}`}>
                          {i.change_pct >= 0 ? "+" : ""}{i.change_pct}%
                        </span>
                      )}
                    </div>
                  </div>
                  {i.related_entity && <span className="text-xs text-muted-foreground">{i.related_entity}</span>}
                  {!!i.actions?.length && (
                    <div className="w-full space-y-1.5 border-t pt-3">
                      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
                        <span className="flex items-center gap-1.5"><CheckSquare className="size-3.5" /> {i.actions.length} action item{i.actions.length === 1 ? "" : "s"} from this insight</span>
                        <Link href="/actions" className="inline-flex items-center gap-0.5 hover:text-foreground">Action items <ArrowUpRight className="size-3" /></Link>
                      </div>
                      <ul className="divide-y rounded-md border">
                        {i.actions.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 px-2.5 py-1.5 text-sm">
                            <span className={`flex-1 truncate ${a.status === "done" ? "text-muted-foreground line-through" : ""}`}>{a.title}</span>
                            {a.amount_usd != null && <span className="tabular-nums text-muted-foreground">{usd(a.amount_usd)}</span>}
                            <Badge variant="outline" className="text-[11px]">{humanize(a.status)}</Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t pt-3">
                    <DecisionBar
                      title={i.title}
                      detail={i.summary}
                      followUp={`Tell me more about: ${i.title}. What is driving it and what should we do first?`}
                      actionType={recs.find((r) => r.insight_id === i.id)?.action_type ?? "other"}
                    />
                    {A.playbook && (
                      <Link href={`/playbooks/${A.playbook}`} className={buttonVariants({ size: "xs", variant: "secondary" })}>Run playbook</Link>
                    )}
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </section>

        {/* Recommended actions */}
        <aside aria-labelledby="recs" className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <Card size="sm" className="bg-primary text-primary-foreground">
            <CardContent>
              <div id="recs" className="text-sm opacity-80">Value at stake</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">{ready ? usd(totalValue) : "–"}</div>
              <div className="text-sm opacity-80">across {counts}</div>
            </CardContent>
          </Card>

          {!ready && [0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}
          {ready && insightActions.length > 0 && (
            <Card size="sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm"><CheckSquare className="size-4 text-success" /> Largest open actions</CardTitle>
                <CardAction>
                  <Link href="/actions" className={buttonVariants({ size: "xs", variant: "ghost" })}>All <ArrowUpRight /></Link>
                </CardAction>
              </CardHeader>
              <CardContent>
                <ul className="divide-y text-sm">
                  {insightActions.slice(0, 8).map((a) => (
                    <li key={a.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                      <span className="flex-1 truncate" title={a.title}>{a.title}</span>
                      {a.amount_usd != null && <span className="shrink-0 tabular-nums font-medium">{usd(a.amount_usd)}</span>}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {ready && open.length === 0 && insightActions.length === 0 && (
            <Card className="border-dashed"><CardContent className="py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</CardContent></Card>
          )}
          <RecommendationList recs={open} />
        </aside>
      </div>

    </div>
  );
}
