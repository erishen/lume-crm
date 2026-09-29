/* /examples — Lume 开发者引导页:宣传语 hero + 「用 Lume 怎么写」代码卡。
 * 目标不是列 CRM 的 HTTP 调用,而是展示 Lume 运行时本身的写法,吸引开发者
 * 用 Lume 写后台(一个 .lume 脚本 = 后端 + 数据库 + AI Agent)。代码片段均
 * 对齐 crm.lume / src/db.lume 的真实 DSL,可直接抄去跑。 */
import React from "react";

// 复制按钮:把代码块内容写入剪贴板。
function CodeBlock({ code, lang }: { code: string; lang?: string }): React.ReactElement {
  const [copied, setCopied] = React.useState(false);
  function copy(): void {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  }
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{lang ?? "text"}</span>
        <button className="copy-btn" onClick={copy} type="button">
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const SNIPPETS: { id: string; label: string; lang: string; code: string }[] = [
  {
    id: "min",
    label: "① 最小应用",
    lang: "lume",
    code: [
      "// app.lume —— 一份脚本，就是一个服务",
      "server {",
      '  port = 8089;',
      '  bind = "127.0.0.1";   // 本地安全；容器化传 LUME_BIND=0.0.0.0',
      "};",
      "",
      'get "/", (req) => {',
      '  return { msg: "hello from lume", time: now() };',
      "};",
      "",
      "run();   // 关闭注册窗口，开始伺服",
    ].join("\n"),
  },
  {
    id: "db",
    label: "② 接 SQLite",
    lang: "lume",
    code: [
      'let db = open("./app.db");   // 首次自动建库（SQLite 文件）',
      "",
      "// 建表（幂等）",
      'sql_write(db, "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, body TEXT, created INTEGER)", []);',
      "",
      "// 写：参数绑定，杜绝 SQL 注入",
      'sql_write(db, "INSERT INTO notes (id, body, created) VALUES (?, ?, ?)",',
      '  [next_id("notes"), "第一笔笔记", now()]);',
      "",
      "// 读：物理只读，免锁",
      'let rows = sql_query(db, "SELECT * FROM notes ORDER BY created DESC", []);',
    ].join("\n"),
  },
  {
    id: "api",
    label: "③ REST API",
    lang: "lume",
    code: [
      'post "/api/notes", (req) => {',
      "  let b = try(() => json(req.body));          // 解析 JSON body",
      '  if (b.err != null) { return { status: 400, body: { err: "bad json" } }; }',
      '  let body = str(get(b.ok, "body", ""));',
      '  if (body == "") { return { status: 400, body: { err: "body 必填" } }; }',
      "  let id = next_id(\"notes\");",
      '  sql_write(db, "INSERT INTO notes (id, body, created) VALUES (?, ?, ?)",',
      "    [id, body, now()]);",
      '  return { status: 201, body: { ok: true, id: id } };',
      "};",
      "",
      'get "/api/notes", (req) => {',
      '  return { notes: sql_query(db, "SELECT * FROM notes", []) };',
      "};",
    ].join("\n"),
  },
  {
    id: "spa",
    label: "④ 挂前端 SPA",
    lang: "lume",
    code: [
      "server {",
      "  port = 8089;",
      '  docroot = "./www";   // 前端构建产物目录',
      "  spa = true;          // 干净 URL 刷新回退到 index.html",
      "};",
      "",
      'get "/api/stats", (req) => {',
      '  return { count: sql_query(db, "SELECT COUNT(*) n FROM notes", [])[0].n };',
      "};",
      "",
      "run();",
      "// 前端是普通 React/Vue/原生 SPA：构建进 ./www，lume 只做静态托管 + JSON API",
    ].join("\n"),
  },
  {
    id: "agent",
    label: "⑤ 加 AI Agent",
    lang: "lume",
    code: [
      "// 注册一个工具，聊天 Agent 就能调用你的函数",
      'tool "add_note", "新增一条笔记。body 为笔记内容。", { body: string }, (arg) => {',
      '  sql_write(db, "INSERT INTO notes (id, body, created) VALUES (?, ?, ?)",',
      '    [next_id("notes"), arg.body, now()]);',
      "  return { ok: true };",
      "};",
      "",
      "// 聊天走框架原生 SSE：前端 POST /react/api/chat 读流即可",
      "// 模型会按需调用上面注册的 add_note —— 后台逻辑 = 一份 .lume 脚本",
    ].join("\n"),
  },
];

export function Examples(): React.ReactElement {
  const [tab, setTab] = React.useState(SNIPPETS[0].id);
  const active = SNIPPETS.find((s) => s.id === tab) ?? SNIPPETS[0];

  return (
    <main className="wrap examples">
      <div className="ex-hero">
        <h1>一份 .lume 脚本，写完后端、数据库和 AI Agent</h1>
        <p className="hero-sub">
          用 <strong>Lume</strong> 开发后台管理系统：服务端零其它语言，一个 C11 单二进制{" "}
          <code>lume</code> + 一份 <code>.lume</code> 脚本，就撑起从数据库、REST API、到 LLM Agent、再到前端壳的整套系统。
          下面 5 段代码，照着拼就是下一个内部系统。
        </p>
        <a className="btn" href="/">
          ← 回仪表盘
        </a>
      </div>

      <section className="ex-card">
        <h2>Lume 替你做了什么</h2>
        <div className="ex-grid">
          <div className="ex-item">
            <div className="ex-k">数据库</div>
            <div className="ex-v">原生 <code>sql_query</code>（物理只读）/ <code>sql_write</code>（护栏写），参数绑定杜绝注入</div>
          </div>
          <div className="ex-item">
            <div className="ex-k">REST API</div>
            <div className="ex-v">路由糖 <code>get</code>/<code>post</code>，错误码 + JSON 响应，并发写 <code>flock</code> 串行</div>
          </div>
          <div className="ex-item">
            <div className="ex-k">LLM Agent</div>
            <div className="ex-v"><code>tool</code> 注册 typed 工具 + SSE 聊天 <code>/react/api/chat</code>，模型按需调你的函数</div>
          </div>
          <div className="ex-item">
            <div className="ex-k">前端 SPA</div>
            <div className="ex-v"><code>server {"{ spa = true }"}</code> 历史路由回退 + 单 <code>app.js</code> 壳，React/Vue/原生都行</div>
          </div>
        </div>
      </section>

      <section className="ex-card">
        <h2>5 分钟看懂 .lume 写法</h2>
        <div className="code-tabs">
          {SNIPPETS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={s.id === tab ? "tab active" : "tab"}
              onClick={() => setTab(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <CodeBlock code={active.code} lang={active.lang} />
      </section>

      <section className="ex-card">
        <h2>跑这个样板</h2>
        <p className="subtitle">装好 Lume 运行时，直接跑本项目；或先调这个公网只读实例感受 API。</p>
        <div className="code-tabs">
          <span className="tab static">安装并运行</span>
        </div>
        <CodeBlock
          lang="bash"
          code={[
            "curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh | sh",
            "lume crm.lume        # 启动后访问 http://127.0.0.1:8089",
          ].join("\n")}
        />
        <div className="code-tabs">
          <span className="tab static">调公网只读实例（无需鉴权）</span>
        </div>
        <CodeBlock
          lang="bash"
          code={[
            "curl https://lume-crm.erishen.cn/api/stats",
            "curl https://lume-crm.erishen.cn/api/customers",
            "# 写接口在只读模式下返回 403：演示模式为只读，数据玩不坏",
          ].join("\n")}
        />
      </section>
    </main>
  );
}
