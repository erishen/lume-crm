/* SPA shell — history 路由 + 统一导航 + 挂载。单一 app.js:
 * 点击站内链接用 pushState 做客户端导航(无白屏抖动),直接访问/刷新由
 * 服务端 spa=true 回退到 docroot/index.html,React 再按 pathname 渲染。
 *
 * 路由表(pathname):
 *   /              仪表盘
 *   /customers     客户列表
 *   /customers/N   客户详情
 *   /chat          Agent 聊天
 *
 * history 而非 hash:Lume 的 spa fallback(GET+Accept:text/html+静态404 →
 * docroot/index.html)保证干净 URL 刷新不 404;API/fetch 的 404 不受影响。 */
import React from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./dashboard";
import { Customers } from "./customers";
import { Chat } from "./chat";
import { Nav } from "./ui";

function parsePath(): { view: string; id?: number } {
  const p = window.location.pathname.replace(/\/+$/, "");
  const parts = p.split("/").filter(Boolean); // "" → []; /customers/3 → [customers,3]
  const id = parts.length > 1 ? Number(parts[1]) : undefined;
  return { view: parts[0] || "", id: Number.isFinite(id) ? id : undefined };
}

// 客户端导航:pushState + 广播,App 监听统一更新 route(不整页重载)。
function navigate(href: string): void {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;
  window.history.pushState(null, "", url.pathname + url.search);
  window.dispatchEvent(new Event("crm:navigate"));
}

function App(): React.ReactElement {
  const [route, setRoute] = React.useState(parsePath);

  React.useEffect(() => {
    const onNav = (): void => setRoute(parsePath());
    window.addEventListener("popstate", onNav);
    window.addEventListener("crm:navigate", onNav);
    const onClick = (e: MouseEvent): void => {
      const el = e.target as Element;
      const a = el.closest?.("a") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target === "_blank" || a.hasAttribute("download")) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = a.getAttribute("href") ?? "";
      // 站内相对/绝对路径才拦;外链、锚点、API 一律交给浏览器
      if (
        !href ||
        href.startsWith("#") ||
        /^https?:/i.test(href) ||
        href.startsWith("/api/")
      )
        return;
      e.preventDefault();
      navigate(href);
    };
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("crm:navigate", onNav);
      document.removeEventListener("click", onClick);
    };
  }, []);

  let view: React.ReactElement;
  if (route.view === "chat") view = <Chat />;
  else if (route.view === "customers") view = <Customers id={route.id} />;
  else view = <Dashboard />;

  return (
    <React.Fragment>
      <Nav />
      {view}
    </React.Fragment>
  );
}

document.addEventListener("DOMContentLoaded", () => {
  const host = document.getElementById("root");
  if (host) createRoot(host).render(<App />);
});
