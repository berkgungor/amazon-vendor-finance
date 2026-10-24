"use client";
import { useEffect, useMemo, useState } from "react";
import { AssistantRuntimeProvider, AuiConfig, Suggestions, Tools } from "@assistant-ui/react";
import { MessageSquarePlus, Search, Sparkles, Trash2 } from "lucide-react";
import { Thread } from "@/components/assistant-ui/elements/thread.aui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useOps } from "@/lib/ops-store";
import type { Chat as ChatT, Message } from "@/lib/types";
import { chatToolkit } from "./chat/toolkit";
import { fromStored, useFinanceRuntime } from "./chat/use-finance-runtime";

const SUGGESTIONS = [
  { title: "What should I act on first?", label: "ranked by recoverable $", prompt: "What are the top 3 things I should act on this week to recover money? Rank by estimated value and create action items." },
  { title: "Disputable shortages", label: "before the window closes", prompt: "Which shortage claims are still disputable, and how much could we recover? Chart it by month." },
  { title: "Unexplained deductions", label: "categorize and route", prompt: "Break down unexplained deductions by likely category and suggest who should resolve each." },
  { title: "Cash collection dashboard", label: "aging, pending, unpaid", prompt: "Build a cash collection dashboard: unpaid invoices by age bucket, pending Amazon action, and the top invoices to chase." },
];

function Welcome() {
  return (
    <div className="mb-6 flex flex-col items-start px-2">
      <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Sparkles className="size-5" />
      </div>
      <p className="text-2xl font-semibold tracking-tight">Good to see you.</p>
      <p className="text-2xl tracking-tight text-muted-foreground">What should we look at in your Amazon finances?</p>
    </div>
  );
}

function relativeDay(iso: string) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
}

export function Chat() {
  const [chats, setChats] = useState<ChatT[]>([]);
  const [chatId, setChatId] = useState<string | undefined>();
  const [filter, setFilter] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch("/api/chats").then(async (r) => r.ok && setChats(await r.json())).catch(() => {});
  }, [reloadKey]);

  const { reload: reloadOps } = useOps();
  const runtimeOpts = useMemo(
    // After each answer, refresh the chat list and the shared store, so action items the agent
    // created show up on the Action items and Today pages without a page reload.
    () => ({ chatId, onChatId: setChatId, onSettled: () => { setReloadKey((k) => k + 1); reloadOps(); } }),
    [chatId, reloadOps],
  );
  const { runtime, setMessages } = useFinanceRuntime(runtimeOpts);
  const config = useMemo(() => AuiConfig({ tools: Tools({ toolkit: chatToolkit }), suggestions: Suggestions(SUGGESTIONS) }), []);

  // ?q=… from other pages pre-fills the composer
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) runtime.thread.composer.setText(q);
  }, [runtime]);

  async function openChat(id: string) {
    setChatId(id);
    const r = await fetch(`/api/chats/${id}`);
    setMessages(r.ok ? fromStored((await r.json()) as Message[]) : []);
  }

  function newChat() {
    setChatId(undefined);
    setMessages([]);
  }

  async function removeChat(id: string) {
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    if (id === chatId) newChat();
    setReloadKey((k) => k + 1);
  }

  const visible = chats.filter((c) => c.title.toLowerCase().includes(filter.toLowerCase()));
  const groups = visible.reduce<Record<string, ChatT[]>>((acc, c) => {
    (acc[relativeDay(c.updated_at)] ??= []).push(c);
    return acc;
  }, {});

  return (
    <AssistantRuntimeProvider runtime={runtime} config={config}>
      <div className="flex h-full">
        <aside className="hidden w-64 shrink-0 flex-col border-r bg-background md:flex">
          <div className="space-y-2 p-3">
            <Button onClick={newChat} variant="outline" className="w-full justify-start"><MessageSquarePlus /> New conversation</Button>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search" className="h-8 pl-8 text-sm" />
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 pb-3">
            {chats.length === 0 && <p className="px-2 py-6 text-center text-xs text-muted-foreground">Your conversations will appear here.</p>}
            {Object.entries(groups).map(([label, list]) => (
              <div key={label} className="mb-3">
                <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
                {list.map((c) => (
                  <div key={c.id} className={`group flex items-center rounded-md text-sm ${c.id === chatId ? "bg-muted font-medium" : "hover:bg-muted/60"}`}>
                    <button onClick={() => openChat(c.id)} className="flex-1 truncate px-2 py-1.5 text-left">{c.title}</button>
                    <Button size="icon" variant="ghost" onClick={() => removeChat(c.id)} aria-label="Delete conversation"
                      className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </nav>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <div className="flex items-center justify-end border-b px-3 py-1.5 md:hidden">
            <Button size="sm" variant="ghost" onClick={newChat}><MessageSquarePlus /> New conversation</Button>
          </div>
          <div className="min-h-0 flex-1"><Thread components={{ Welcome }} /></div>
        </section>
      </div>
    </AssistantRuntimeProvider>
  );
}
