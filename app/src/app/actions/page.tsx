"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { CheckSquare, Circle, CircleCheck, CircleDot, Lightbulb, Plus, Sparkles, UserRound, X } from "lucide-react";
import { OutcomeDialog } from "@/components/DecisionDialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { humanize, isOverdue, usd } from "@/lib/format";
import { useOps } from "@/lib/ops-store";
import { OWNERS } from "@/lib/sample";
import type { ActionItem } from "@/lib/types";

type Col = "open" | "in_progress" | "done";
const COLUMNS: { key: Col; label: string; icon: typeof Circle; tone: string }[] = [
  { key: "open", label: "To do", icon: Circle, tone: "text-muted-foreground" },
  { key: "in_progress", label: "In progress", icon: CircleDot, tone: "text-info" },
  { key: "done", label: "Done", icon: CircleCheck, tone: "text-success" },
];
const NEXT: Record<Col, Col> = { open: "in_progress", in_progress: "done", done: "open" };
const PRIORITY: Record<string, string> = {
  high: "bg-danger-soft text-destructive border-destructive/30",
  medium: "bg-warning-soft text-warning border-warning/30",
  low: "bg-muted text-muted-foreground",
};
const SOURCE: Record<string, string> = { recommendation: "From recommendation", agent: "From assistant", alert: "From alert", playbook: "From playbook" };

export default function ActionsPage() {
  const { ready, sample, items: all, metrics, updateItems, createItems, removeItem, reload } = useOps();
  // Items can be created elsewhere (the agent, recommendations), so load fresh data on every visit.
  useEffect(() => { reload(); }, [reload]);
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<"all" | "mine" | "overdue">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [closing, setClosing] = useState<string[] | null>(null);

  const items = useMemo(
    () => all.filter((i) => i.status !== "dismissed")
      .filter((i) => scope === "all" || (scope === "mine" ? i.owner === "Me" : i.status !== "done" && isOverdue(i.due_date))),
    [all, scope],
  );
  const open = all.filter((i) => i.status === "open" || i.status === "in_progress");
  const overdue = open.filter((i) => isOverdue(i.due_date)).length;
  const picked = [...selected].filter((id) => items.some((i) => i.id === id));

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  function advance(i: ActionItem) {
    const next = NEXT[i.status as Col] ?? "open";
    if (next === "done") setClosing([i.id]);
    else updateItems([i.id], { status: next });
  }

  async function closeWith(ids: string[], amount: number | null) {
    setClosing(null);
    setSelected(new Set());
    // A bulk total is attributed to the first item so the sum stays correct.
    const ok = await Promise.all(ids.map((id, n) =>
      updateItems([id], { status: "done", ...(amount != null ? { outcome_amount_usd: n === 0 ? amount : 0 } : {}) })));
    if (ok.every(Boolean)) toast.success(ids.length === 1 ? "Marked as done" : `${ids.length} items done`, {
      description: amount ? `${usd(amount, false)} added to recovered to date` : undefined,
    });
  }

  async function bulk(patch: Partial<ActionItem>, msg: string) {
    const ids = picked;
    setSelected(new Set());
    if (await updateItems(ids, patch)) toast.success(msg);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    if (await createItems([{ title: title.trim(), owner: "Me", priority: "medium", action_type: "other", source: "user" }])) {
      setTitle("");
      toast.success("Action item added");
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><CheckSquare className="size-5" /> Action items</h1>
              {sample && <Badge variant="outline" className="border-warning/30 bg-warning-soft text-warning">Sample data</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">
              {ready ? (
                <>
                  {open.length} open
                  {overdue > 0 && <> · <span className="text-destructive">{overdue} overdue</span></>}
                  {" "}· <span className="text-success">{usd(metrics.recovered_to_date_usd)} recovered to date</span>
                </>
              ) : "Owned follow-ups, tracked to recovery"}
            </p>
          </div>
          <form onSubmit={add} className="flex w-full max-w-sm gap-2">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an action item…" aria-label="New action item" />
            <Button type="submit" disabled={!title.trim()}><Plus /> Add</Button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-8">
        <div className="flex min-h-9 flex-wrap items-center gap-2">
          <Tabs value={scope} onValueChange={(v) => { setScope(String(v) as typeof scope); setSelected(new Set()); }}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="mine">Mine</TabsTrigger>
              <TabsTrigger value="overdue">Overdue{overdue > 0 && <span className="ml-1 tabular-nums text-destructive">{overdue}</span>}</TabsTrigger>
            </TabsList>
          </Tabs>
          {picked.length > 0 && (
            <div role="toolbar" aria-label="Bulk actions" className="ml-auto flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/40 px-2 py-1 text-sm">
              <span className="px-1 font-medium">{picked.length} selected</span>
              <Select onValueChange={(v) => bulk({ owner: String(v) }, `Assigned to ${v}`)}>
                <SelectTrigger size="sm" className="h-7 w-auto gap-1"><UserRound className="size-3.5" /><SelectValue placeholder="Assign" /></SelectTrigger>
                <SelectContent>{OWNERS.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
              </Select>
              <Button size="sm" variant="outline" className="h-7" onClick={() => bulk({ status: "in_progress" }, "Moved to in progress")}><CircleDot /> Start</Button>
              <Button size="sm" className="h-7" onClick={() => setClosing(picked)}><CircleCheck /> Done</Button>
              <Button size="icon" variant="ghost" className="size-7" aria-label="Clear selection" onClick={() => setSelected(new Set())}><X /></Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((col) => {
            const list = items.filter((i) => i.status === col.key);
            const recovered = col.key === "done" ? list.reduce((s, i) => s + (i.outcome_amount_usd ?? 0), 0) : 0;
            return (
              <section key={col.key} aria-label={col.label} className="rounded-xl bg-muted/50 p-3">
                <div className="mb-3 flex items-center gap-2 px-1 text-sm font-medium">
                  <col.icon className={`size-4 ${col.tone}`} /> {col.label}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {recovered > 0 && <span className="mr-2 text-success">{usd(recovered)}</span>}
                    {list.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {!ready && [0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
                  {ready && list.length === 0 && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Nothing here</p>}
                  {list.map((i) => {
                    const late = i.status !== "done" && isOverdue(i.due_date);
                    return (
                      <Card key={i.id} size="sm" className={`group ${selected.has(i.id) ? "ring-2 ring-primary/40" : ""}`}>
                        <CardContent className="space-y-2">
                          <div className="flex items-start gap-2">
                            <Checkbox className="mt-0.5" aria-label={`Select ${i.title}`} checked={selected.has(i.id)} onCheckedChange={() => toggle(i.id)} />
                            <div className={`flex-1 text-sm font-medium ${i.status === "done" ? "text-muted-foreground line-through" : ""}`}>{i.title}</div>
                            <Button size="icon" variant="ghost" onClick={() => removeItem(i.id).then((ok) => ok && toast("Action item dismissed", { description: i.title }))}
                              aria-label="Dismiss" title="Dismiss" className="size-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                              <X />
                            </Button>
                          </div>
                          {i.notes && <p className="pl-6 text-xs text-muted-foreground line-clamp-2">{i.notes}</p>}
                          <div className="flex flex-wrap items-center gap-1.5 pl-6 text-xs text-muted-foreground">
                            <Badge variant="outline" className={PRIORITY[i.priority ?? "medium"]}>{i.priority ?? "medium"}</Badge>
                            {i.amount_usd != null && <span className="font-medium tabular-nums text-foreground">{usd(i.amount_usd)}</span>}
                            {i.action_type && i.action_type !== "other" && <span>{humanize(i.action_type)}</span>}
                            {i.owner && <span className="inline-flex items-center gap-1"><UserRound className="size-3" />{i.owner}</span>}
                            {i.due_date && <span className={late ? "font-medium text-destructive" : ""}>· {late ? "overdue" : "due"} {i.due_date}</span>}
                            {i.outcome_amount_usd ? <span className="font-medium text-success">· {usd(i.outcome_amount_usd)} recovered</span> : null}
                          </div>
                          {i.insight_id && (
                            <Link href="/insights" className="ml-6 flex items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground" title={i.insight_title ?? undefined}>
                              <Lightbulb className="size-3 shrink-0 text-warning" /> <span className="truncate">From insight: {i.insight_title ?? i.insight_id}</span>
                            </Link>
                          )}
                          <div className="flex items-center justify-between pl-6">
                            {i.source && SOURCE[i.source] ? (
                              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><Sparkles className="size-3" />{SOURCE[i.source]}</span>
                            ) : <span />}
                            <Button size="xs" variant={col.key === "in_progress" ? "default" : "ghost"} onClick={() => advance(i)}>
                              {col.key === "open" ? "Start" : col.key === "in_progress" ? "Mark done" : "Reopen"}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <OutcomeDialog
        open={closing !== null}
        onOpenChange={(o) => !o && setClosing(null)}
        count={closing?.length ?? 0}
        onConfirm={(amount) => closing && closeWith(closing, amount)}
      />
    </div>
  );
}

