/* 客户列表 + 详情视图(SPA 内导出,由 app.tsx 按 /customers[/N] 挂载)。 */
import React from "react";
import { apiGet, apiPost, apiUpdateDeal, apiUpdateCustomer, apiDeleteCustomer, apiDeleteDeal, apiDeleteActivity, CustomerRow, CustomerDetail as CustomerDetailData } from "../api";
import { fmtMoney, stageClass, go, useMeta } from "./ui";

export function CustomerList(): React.ReactElement {
  const [rows, setRows] = React.useState<CustomerRow[] | null>(null);
  const [err, setErr] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [custId, setCustId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [sort, setSort] = React.useState<"" | "pipeline">("");
  const { stages, defaultStage } = useMeta();
  const [stage, setStage] = React.useState(defaultStage);
  const [amount, setAmount] = React.useState("");

  function load(s: "" | "pipeline" = sort): void {
    let url = "/api/customers";
    if (s === "pipeline") url += "?sort=pipeline";
    apiGet<{ customers: CustomerRow[] }>(url)
      .then((d) => {
        setRows(d.customers);
        // 默认挂到第一个客户,用户可换
        setCustId((prev) => (prev !== "" ? prev : String(d.customers[0]?.id ?? "")));
      })
      .catch((e: Error) => setErr(e.message));
  }
  React.useEffect(load, []);

  function toggleSort(): void {
    const next = sort === "pipeline" ? "" : "pipeline";
    setSort(next);
    load(next);
  }

  async function addDeal(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!title.trim() || !custId || !rows || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/deals", {
        customer_id: Number(custId),
        title: title.trim(),
        stage: stage,
        amount: amount.trim() === "" ? 0 : Number(amount),
      });
      setTitle("");
      setAmount("");
      load();
    } catch (er) {
      setMsg((er as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (err)
    return (
      <main className="wrap">
        <div className="err">加载失败: {err}</div>
      </main>
    );
  if (!rows)
    return (
      <main className="wrap">
        <p className="subtitle">加载客户列表…</p>
      </main>
    );

  return (
    <main className="wrap">
      <h1>客户</h1>
      <p className="subtitle">共 {rows.length} 位客户 · 点名字看全档(商机 + 跟进)</p>

      <form className="inline" onSubmit={addDeal}>
        <label className="field">
          客户
          <select value={custId} onChange={(e) => setCustId(e.target.value)}>
            {rows.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          商机标题
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如:私有部署" />
        </label>
        <label className="field">
          阶段
          <select value={stage} onChange={(e) => setStage(e.target.value)}>
            {stages.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="field">
          金额
          <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" inputMode="decimal" />
        </label>
        <button className="btn" type="submit" disabled={busy || !title.trim() || !custId}>
          加商机
        </button>
      </form>
      {msg && <div className="err">{msg}</div>}

      <table>
        <thead>
          <tr>
            <th>姓名</th>
            <th>公司</th>
            <th>电话</th>
            <th>加入</th>
            <th className="num sortable" onClick={toggleSort} title="点击按管道排序">
              管道{sort === "pipeline" ? " ↓" : ""}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <a href={"/customers/" + c.id}>{c.name}</a>
              </td>
              <td>{c.company || "—"}</td>
              <td>{c.phone || "—"}</td>
              <td>{c.created_fmt}</td>
              <td className="num">{c.pipeline > 0 ? fmtMoney(c.pipeline) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

export function CustomerDetail({ id }: { id: number }): React.ReactElement {
  const [d, setD] = React.useState<CustomerDetailData | null>(null);
  const [err, setErr] = React.useState("");
  const [kind, setKind] = React.useState("电话");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [updating, setUpdating] = React.useState<number | null>(null);
  const { stages, kinds } = useMeta();

  function refresh(): void {
    apiGet<CustomerDetailData>("/api/customer?id=" + id).then(setD, () => {});
  }

  React.useEffect(() => {
    setD(null);
    setErr("");
    apiGet<CustomerDetailData>("/api/customer?id=" + id)
      .then(setD)
      .catch((e: Error) => setErr(e.message));
  }, [id]);

  async function moveStage(dealId: number, newStage: string): Promise<void> {
    setUpdating(dealId);
    try {
      await apiUpdateDeal(dealId, { stage: newStage });
      const fresh = await apiGet<CustomerDetailData>("/api/customer?id=" + id);
      setD(fresh);
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setUpdating(null);
    }
  }

  async function removeDeal(deal: { id: number; title: string }): Promise<void> {
    if (!window.confirm("删除商机「" + deal.title + "」?不可撤销。")) return;
    try {
      await apiDeleteDeal(deal.id);
      refresh();
    } catch (er) {
      setErr((er as Error).message);
    }
  }

  async function removeActivity(actId: number): Promise<void> {
    try {
      await apiDeleteActivity(actId);
      refresh();
    } catch (er) {
      setErr((er as Error).message);
    }
  }

  async function addActivity(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!note.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/activities", { customer_id: id, kind: kind, note: note.trim() });
      setNote("");
      apiGet<CustomerDetailData>("/api/customer?id=" + id).then(setD, () => {});
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---- 编辑资料 ----
  const [editing, setEditing] = React.useState(false);
  const [eName, setEName] = React.useState("");
  const [eCompany, setECompany] = React.useState("");
  const [eEmail, setEmail] = React.useState("");
  const [ePhone, setPhone] = React.useState("");
  const [eBusy, setEBusy] = React.useState(false);
  const [delBusy, setDelBusy] = React.useState(false);

  function startEdit(): void {
    if (!d) return;
    setEName(d.name);
    setECompany(d.company);
    setEmail(d.email);
    setPhone(d.phone);
    setEditing(true);
  }

  async function saveProfile(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (eBusy || !d) return;
    setEBusy(true);
    try {
      // 空串字段服务端视为"不改";name 传空也只是保留旧值
      await apiUpdateCustomer(id, {
        name: eName,
        company: eCompany,
        email: eEmail,
        phone: ePhone,
      });
      setEditing(false);
      const fresh = await apiGet<CustomerDetailData>("/api/customer?id=" + id);
      setD(fresh);
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setEBusy(false);
    }
  }

  async function removeCustomer(): Promise<void> {
    if (delBusy || !d) return;
    const dealN = d.deals.length;
    if (!window.confirm("删除客户「" + d.name + "」" + (dealN ? "(含 " + dealN + " 条商机)" : "") + "及其全部跟进记录?不可撤销。")) {
      return;
    }
    setDelBusy(true);
    try {
      await apiDeleteCustomer(id);
      go("/customers");
    } catch (er) {
      setErr((er as Error).message);
      setDelBusy(false);
    }
  }

  if (err)
    return (
      <main className="wrap">
        <div className="err">{err}</div>
      </main>
    );
  if (!d)
    return (
      <main className="wrap">
        <p className="subtitle">加载客户…</p>
      </main>
    );

  return (
    <main className="wrap">
      <p className="subtitle">
        <a href="/customers">← 客户列表</a>
      </p>
      {editing ? (
        <form className="inline" onSubmit={saveProfile}>
          <label className="field">
            姓名
            <input value={eName} onChange={(e) => setEName(e.target.value)} />
          </label>
          <label className="field">
            公司
            <input value={eCompany} onChange={(e) => setECompany(e.target.value)} placeholder="留空 = 不改" />
          </label>
          <label className="field">
            邮箱
            <input value={eEmail} onChange={(e) => setEmail(e.target.value)} placeholder="留空 = 不改" />
          </label>
          <label className="field">
            电话
            <input value={ePhone} onChange={(e) => setPhone(e.target.value)} placeholder="留空 = 不改" />
          </label>
          <button className="btn" type="submit" disabled={eBusy}>
            保存
          </button>
          <button className="btn ghost" type="button" onClick={() => setEditing(false)} disabled={eBusy}>
            取消
          </button>
        </form>
      ) : (
        <div>
          <h1>{d.name}</h1>
          <p className="subtitle">
            {d.company || "—"} · {d.email || "—"} · {d.phone || "—"} · 加入 {d.created_fmt}
          </p>
          <div className="row-actions">
            <button className="btn ghost" onClick={startEdit}>
              编辑资料
            </button>
            <button className="btn danger" onClick={removeCustomer} disabled={delBusy}>
              删除客户
            </button>
          </div>
        </div>
      )}

      <div className="detail-grid">
        <div className="panel">
          <h2>商机({d.deals.length})</h2>
          {d.deals.length === 0 && <p className="subtitle">暂无商机</p>}
          <table>
            <thead>
              <tr>
                <th>标题</th>
                <th>阶段</th>
                <th className="num">金额</th>
                <th className="num">更新</th>
                <th className="num">操作</th>
              </tr>
            </thead>
            <tbody>
              {d.deals.map((x) => (
                <tr key={x.id}>
                  <td>{x.title}</td>
                  <td>
                    <select
                      className={"stage-select" + (updating === x.id ? " busy" : "")}
                      value={x.stage}
                      disabled={updating === x.id}
                      onChange={(e) => moveStage(x.id, e.target.value)}
                    >
                      {(stages.includes(x.stage) ? stages : [x.stage, ...stages]).map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{fmtMoney(x.amount)}</td>
                  <td className="num">{x.updated_fmt || "—"}</td>
                  <td className="num">
                    <button className="btn tiny danger" onClick={() => removeDeal(x)}>
                      删
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>跟进({d.activities.length})</h2>
          <form className="inline" onSubmit={addActivity}>
            <label className="field">
              类型
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {kinds.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <label className="field">
              内容
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="今天聊了什么" />
            </label>
            <button className="btn" type="submit" disabled={busy || !note.trim()}>
              记录
            </button>
          </form>
          {d.activities.map((a) => (
            <div className="act" key={a.id}>
              <span className={stageClass("")}>{a.kind}</span>{" "}
              {a.note}
              {a.kind === "系统" ? (
                <span className="sys" title="推进到终态时系统自动留痕,不可删">
                  系统
                </span>
              ) : (
                <button
                  className="btn tiny ghost act-del"
                  title="删除这条跟进"
                  onClick={() => removeActivity(a.id)}
                >
                  ×
                </button>
              )}
              <div className="meta">{a.at_fmt}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export function Customers({ id }: { id?: number }): React.ReactElement {
  // key=id:切到另一个客户详情时整组件重挂载,避免旧详情的 state 残留
  return id ? <CustomerDetail key={id} id={id} /> : <CustomerList />;
}
