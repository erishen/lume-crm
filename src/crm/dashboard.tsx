/* 仪表盘视图(SPA 内导出,由 app.tsx 挂载):统计卡 + 商机管道 + 客户总表。 */
import React from "react";
import { CustomerRow, apiPost } from "../api";
import { useStats, fmtMoney, useMeta } from "./ui";

function CustomerForm({ onDone, onErr }: { onDone: () => void; onErr: (m: string) => void }) {
  const [name, setName] = React.useState("");
  const [company, setCompany] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/customers", {
        name: name.trim(),
        company: company.trim(),
        email: email.trim(),
        phone: phone.trim(),
      });
      setName("");
      setCompany("");
      setEmail("");
      setPhone("");
      onDone();
    } catch (err) {
      onErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline" onSubmit={submit}>
      <label className="field">
        姓名
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="张三" />
      </label>
      <label className="field">
        公司
        <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="可选" />
      </label>
      <label className="field">
        邮箱
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="可选" />
      </label>
      <label className="field">
        电话
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="可选" />
      </label>
      <button className="btn" type="submit" disabled={busy || !name.trim()}>
        新建客户
      </button>
    </form>
  );
}

export function Dashboard(): React.ReactElement {
  const { data, err, reload } = useStats();
  const [msg, setMsg] = React.useState("");
  const { stages: metaStages } = useMeta();

  const shell = (body: React.ReactNode): React.ReactElement => (
    <main className="wrap">
      <div className="hero">
        <div className="hero-title">一份 .lume 脚本，写完后端、数据库和 AI Agent</div>
        <p className="hero-sub">
          用 Lume 开发后台：服务端零其它语言，单二进制 <code>lume</code> + 一份 <code>.lume</code> 脚本撑起整套 CRM。想照着写？看「用 Lume 开发」。
        </p>
        <a className="btn" href="/examples">看 Lume 怎么写 →</a>
      </div>
      <h1>仪表盘</h1>
      <p className="subtitle">
        Lume + React CRM · 数据落 .data/crm.db(SQLite · sql_query/sql_write) ·
        服务端零其它语言——一个 .lume 脚本撑起整套后台
      </p>
      {body}
    </main>
  );

  if (err) return shell(<div className="err">加载失败: {err}</div>);
  if (!data) return shell(<p className="subtitle">加载仪表盘…</p>);

  // 管道按服务端 meta 阶段序展示(白名单顺序=业务漏斗顺序);
  // 库里出现的、meta 外的历史阶段补在后面(不丢数据)。
  const stages = [
    ...metaStages,
    ...Object.keys(data.by_stage).filter(
      (k) => !k.endsWith(".amt") && !metaStages.includes(k),
    ),
  ];

  return shell(
    <React.Fragment>
      <div className="cards">
        <div className="card">
          <div className="label">客户</div>
          <div className="value">{data.customer_count}</div>
        </div>
        <div className="card">
          <div className="label">商机</div>
          <div className="value">{data.deal_count}</div>
        </div>
        <div className="card">
          <div className="label">开放管道</div>
          <div className="value">{fmtMoney(data.open_pipeline)}</div>
        </div>
        <div className="card">
          <div className="label">成交率</div>
          <div className="value">{Math.round((data.win_rate ?? 0) * 100)}%</div>
          <div className="sub">
            成交 {data.won_deals ?? 0} · {fmtMoney(data.won_amount ?? 0)} / 丢单 {data.lost_deals ?? 0}
          </div>
        </div>
      </div>

      {stages.length > 0 && (
        <div className="stages">
          {stages.map((s) => (
            <div className="stage" key={s}>
              <div className="name">{s}</div>
              <div className="n">{data.by_stage[s] ?? 0}</div>
              <div className="a">{fmtMoney(data.by_stage[s + ".amt"] || 0)}</div>
            </div>
          ))}
        </div>
      )}

      <CustomerForm onDone={reload} onErr={(m) => setMsg(m)} />
      {msg && <div className="err">{msg}</div>}

      <table>
        <thead>
          <tr>
            <th>客户</th>
            <th>公司</th>
            <th>邮箱</th>
            <th>商机</th>
            <th>跟进</th>
            <th className="num">管道</th>
          </tr>
        </thead>
        <tbody>
          {data.customers.map((c: CustomerRow) => (
            <tr key={c.id}>
              <td>
                <a href={"/customers/" + c.id}>{c.name}</a>
              </td>
              <td>{c.company || "—"}</td>
              <td>{c.email || "—"}</td>
              <td>{c.deal_count}</td>
              <td>{c.activity_count}</td>
              <td className="num">{c.pipeline > 0 ? fmtMoney(c.pipeline) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </React.Fragment>,
  );
}
