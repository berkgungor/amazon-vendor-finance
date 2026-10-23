import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";
import { addMessage, createChat, listMessages } from "@/lib/db";
import type { AgentEvent, UploadResult } from "@/lib/types";

/** Tells the agent which tables the user's uploads became, so it can query them (ListUploads / QueryUploads). */
function uploadNote(uploads: UploadResult[]) {
  if (!uploads.length) return "";
  const lines = uploads.map((u) => `- ${u.file} → ${u.table} (${u.rows} rows; columns: ${u.columns.map((c) => `${c.name} ${c.type}`).join(", ")})`);
  return `\n\n[Uploaded files, now Snowflake tables]\n${lines.join("\n")}`;
}

const isUpload = (u: UploadResult) => typeof u?.table === "string" && /^AMAZON_FINANCE_APP\.UPLOADS\.[A-Z0-9_]+$/.test(u.table);

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { chatId?: string; message?: string; uploads?: UploadResult[] };
  const existing = body.chatId;
  const uploads = (body.uploads ?? []).filter(isUpload).slice(0, 5);
  const message = body.message?.trim() || (uploads.length ? "I uploaded a file. Summarize what's in it." : "");
  if (!message) return Response.json({ error: "message required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      // Persist what the UI renders under the answer; text and status are transient.
      const events: AgentEvent[] = [];
      const emit = (e: AgentEvent) => {
        if (e.type !== "text" && e.type !== "status") events.push(e);
        send(e);
      };
      let chatId = existing;

      try {
        const history = chatId
          ? (await listMessages(chatId)).slice(-12).map((m) => ({ role: m.role, content: m.content })).filter((m) => m.content)
          : [];
        chatId ??= await createChat(message.slice(0, 80));
        const agentMessage = message + uploadNote(uploads);
        await addMessage(chatId, "user", agentMessage);
        for (const upload of uploads) emit({ type: "upload", upload });

        send({ type: "status", text: "Thinking…" });
        const text = await runAgent(history, agentMessage, emit, req.signal);

        await addMessage(chatId, "assistant", text, events);
        send({ type: "done", text, chatId });
      } catch (err) {
        if ((err as Error).name !== "AbortError") send({ type: "error", text: (err as Error).message });
        if (chatId) send({ type: "done", text: "", chatId });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
