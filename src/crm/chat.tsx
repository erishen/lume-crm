/* /chat — Agent 聊天页:框架原生 POST /react/api/chat(SSE)。
 * crm_* 工具已在 .lume 里注册,模型可直接增删改查 CRM 数据。
 * 需 .env 配 LLM_API_URL/LLM_MODEL/LLM_API_KEY;留空 = 离线演示引擎。 */
import React from "react";
import { renderMarkdown } from "./markdown";

const SID_KEY = "lume.crm.sid";

function makeSessionId(): string {
  const a = new Uint8Array(8);
  window.crypto.getRandomValues(a);
  let h = "sess-";
  for (const b of a) h += b.toString(16).padStart(2, "0");
  return h;
}
function getSessionId(): string {
  const e = window.localStorage.getItem(SID_KEY);
  if (e) return e;
  const n = makeSessionId();
  window.localStorage.setItem(SID_KEY, n);
  return n;
}

type Msg = { role: "user" | "agent"; text: string; notes: string[] };

async function streamChat(args: {
  message: string;
  sessionId: string;
  signal: AbortSignal;
  onDelta: (d: string) => void;
  onNote: (n: string) => void;
  onError: (m: string) => void;
}): Promise<void> {
  const res = await window.fetch("/react/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: args.message, sessionId: args.sessionId }),
    signal: args.signal,
  });
  const body = res.body;
  if (!res.ok || !body) {
    const t = await res.text().catch(() => "");
    throw new Error((res.status ? res.status + " " : "") + t.slice(0, 120).trim());
  }
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let sawDone = false;
  const handleLine = (line: string): void => {
    const data = line.startsWith("data: ") ? line.slice(6) : line;
    if (!data.startsWith("{")) return;
    let ev: { t: string; d?: string };
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.t === "delta" && typeof ev.d === "string") args.onDelta(ev.d);
    else if (ev.t === "note" && typeof ev.d === "string") args.onNote(ev.d);
    else if (ev.t === "error") args.onError(typeof ev.d === "string" ? ev.d : "agent error");
    else if (ev.t === "done") sawDone = true;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      for (const ln of buf.slice(0, idx).split("\n")) handleLine(ln);
      buf = buf.slice(idx + 2);
    }
  }
  for (const ln of buf.split("\n")) handleLine(ln);
  if (!sawDone) throw new Error("stream ended without a done event");
}

export function Chat(): React.ReactElement {
  const [messages, setMessages] = React.useState<Msg[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [input, setInput] = React.useState("");
  const [session, setSession] = React.useState(getSessionId);
  const abortRef = React.useRef<AbortController | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  React.useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  function reset(): void {
    setSession(makeSessionId());
    setMessages([]);
  }

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text, notes: [] }, { role: "agent", text: "", notes: [] }]);
    const notes: string[] = [];
    try {
      await streamChat({
        message: text,
        sessionId: session,
        signal: controller.signal,
        onDelta: (d) =>
          setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: x.text + d } : x))),
        onNote: (n) => {
          notes.push(n);
          setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, notes: [...notes] } : x)));
        },
        onError: (msg) =>
          setMessages((m) => m.map((x, i) => (i === m.length - 1 ? { ...x, text: x.text + "\n[error] " + msg } : x))),
      });
    } catch (err) {
      const e2 = err as Error;
      setMessages((m) =>
        m.map((x, i) => (i === m.length - 1 ? { ...x, notes: [...notes, "⚠ " + e2.message] } : x)),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const last = messages[messages.length - 1];
  const lastNote = last?.role === "agent" ? last.notes[last.notes.length - 1] ?? "" : "";

  return (
    <main className="wrap chat-page">
        <p className="subtitle">本地 CRM 助手 · 试试「把客户 1 的商机改成谈判」或「给客户 2 记一条电话跟进」</p>
        <ul className="msgs" ref={listRef}>
          {messages.length === 0 && (
            <li className="note">
              我是本地 CRM 助手,可用工具:<code>crm_search_customers</code>、<code>crm_get_customer</code>、
              <code>crm_add_customer</code>、<code>crm_add_deal</code>、<code>crm_add_activity</code>。
            </li>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <li key={i} className="msg user">
                {m.text}
              </li>
            ) : (
              <li key={i} className="msg agent">
                {m.notes.length > 0 && (
                  <div className="note-strip">
                    {m.notes.map((n, j) => (
                      <span key={j} className="note">
                        {n}
                      </span>
                    ))}
                  </div>
                )}
                {m.text.trim() ? (
                  renderMarkdown(m.text)
                ) : (
                  <div className="text">{busy ? "…" : ""}</div>
                )}
              </li>
            ),
          )}
          {busy && <li className="note busy">agent 处理中 · {lastNote}</li>}
        </ul>
        <form className="input-bar" onSubmit={send}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={busy ? "agent 正在处理…" : "输入指令,回车发送…"}
            autoComplete="off"
            disabled={busy}
          />
          {busy ? (
            <button type="button" className="btn ghost" onClick={() => abortRef.current?.abort()}>
              停止
            </button>
          ) : (
            <button type="submit" className="btn" disabled={busy || !input.trim()}>
              发送
            </button>
          )}
          <button type="button" className="btn ghost" onClick={reset}>
            新会话
          </button>
        </form>
    </main>
  );
}


