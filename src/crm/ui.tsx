/* SPA 共享原子:统一导航 + 统计 hook。Nav 由 app.tsx 渲染一次(不再各页自带)。
 * history 路由:链接用干净路径(/customers…),点击由 app.tsx 的 click 拦截做
 * 客户端导航;直接访问/刷新由服务端 spa=true 回退到 index.html。 */
import React from "react";
import { Stats, Meta, apiGet, apiMeta, fmtMoney, DEAL_STAGES } from "../api";

export function Nav(): React.ReactElement {
  const p = window.location.pathname;
  const active = p.startsWith("/customers")
    ? "/customers"
    : p === "/chat"
      ? "/chat"
      : "/";
  const links: [string, string][] = [
    ["/", "仪表盘"],
    ["/customers", "客户"],
    ["/chat", "Agent"],
  ];
  return (
    <nav className="top">
      <span className="brand">Lume CRM</span>
      {links.map(([href, label]) => (
        <a key={href} href={href} className={href === active ? "active" : ""}>
          {label}
        </a>
      ))}
    </nav>
  );
}

export function useStats(): { data: Stats | null; err: string; reload: () => void } {
  const [data, setData] = React.useState<Stats | null>(null);
  const [err, setErr] = React.useState("");
  const load = React.useCallback(() => {
    setData(null);
    setErr("");
    apiGet<Stats>("/api/stats").then(setData, (e: Error) => setErr(e.message));
  }, []);
  React.useEffect(() => {
    load();
  }, [load]);
  return { data, err, reload: load };
}

/* 业务字典 hook:阶段白名单 / 终态标记 / 默认阶段 / 跟进类型建议集,从服务端 /api/meta 拉。
 * 未就绪(loading/失败)时返回 DEAL_STAGES 兜底,保证选项框永远有值。 */
export function useMeta(): {
  stages: string[];
  closedStages: string[];
  defaultStage: string;
  kinds: string[];
  ready: boolean;
} {
  const [meta, setMeta] = React.useState<Meta | null>(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    apiMeta().then((m) => {
      setMeta(m);
      setReady(true);
    }, () => {
      setReady(true);
    });
  }, []);
  return {
    stages: meta ? meta.deal_stages : DEAL_STAGES,
    closedStages: meta ? meta.closed_stages : ["成交", "丢单"],
    defaultStage: meta ? meta.default_stage : DEAL_STAGES[0],
    kinds: meta ? meta.activity_kinds : ["电话", "会议", "邮件", "拜访", "记录"],
    ready,
  };
}

export function stageClass(stage: string): string {
  if (stage === "成交") return "badge closed";
  if (stage === "丢单") return "badge lost";
  return "badge";
}

/* 程序化客户端导航(与 app.tsx 的 link 拦截同源:pushState + crm:navigate),
 * 供「删完跳回列表」这类非 <a> 场景用。 */
export function go(path: string): void {
  try {
    const u = new URL(path, window.location.href);
    if (u.origin !== window.location.origin) return;
    window.history.pushState(null, "", u.pathname + u.search);
    window.dispatchEvent(new Event("crm:navigate"));
  } catch {
    window.location.href = path;
  }
}

export { fmtMoney };
