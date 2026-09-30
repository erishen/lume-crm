/* Shared API layer + types for the CRM pages. All endpoints live on the
 * Lume server (views root www/crm, so plain root URLs). */

export interface CustomerRow {
  id: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  created: number;
  created_fmt: string;
  deal_count: number;
  activity_count: number;
  pipeline: number;
}

export interface Deal {
  id: number;
  customer: number;
  title: string;
  stage: string;
  amount: number;
  updated: number;
  updated_fmt?: string;
}

export interface Activity {
  id: number;
  customer: number;
  kind: string;
  note: string;
  at: number;
  at_fmt?: string;
}

export interface CustomerDetail extends Omit<CustomerRow, "deal_count" | "activity_count" | "pipeline"> {
  deals: Deal[];
  activities: Activity[];
}

export interface Stats {
  customer_count: number;
  deal_count: number;
  open_pipeline: number;
  won_deals: number;
  won_amount: number;
  lost_deals: number;
  win_rate: number;
  by_stage: Record<string, number>;
  customers: CustomerRow[];
}

export interface VisitDay {
  d: string;
  pv: number;
  uv: number;
}

export interface VisitsSummary {
  total: number;
  today: number;
  uv: number;
  days: VisitDay[];
}

export async function apiGet<T>(url: string): Promise<T> {
  const r = await window.fetch(url);
  if (!r.ok) throw new Error(url + " -> HTTP " + r.status);
  return (await r.json()) as T;
}

export async function apiPost<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await window.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: T;
  try {
    data = (await r.json()) as T;
  } catch {
    data = {} as T;
  }
  if (!r.ok) {
    const err = (data as { err?: string } & { error?: string }).err ?? (data as { error?: string }).error;
    throw new Error(err || url + " -> HTTP " + r.status);
  }
  return data;
}

/* 推进管道:改商机阶段/金额/标题(服务端语义:空串/0 = 不改该字段)。
 * closed:服务端在阶段推进到 成交/丢单 时自动记一条系统跟进,返回该标记。 */
export function apiUpdateDeal(dealId: number, patch: { stage?: string; amount?: number; title?: string }): Promise<{ ok: boolean; deal_id: number; stage: string; amount: number; closed?: boolean }> {
  const body: Record<string, unknown> = { deal_id: dealId };
  if (patch.stage !== undefined) body.stage = patch.stage;
  if (patch.amount !== undefined) body.amount = patch.amount;
  if (patch.title !== undefined) body.title = patch.title;
  return apiPost("/api/deals/update", body);
}

/* 改客户资料:空串字段 = 不改(服务端语义)。 */
export function apiUpdateCustomer(id: number, patch: { name?: string; company?: string; email?: string; phone?: string }): Promise<{ ok: boolean; id: number; name: string }> {
  const body: Record<string, unknown> = { customer_id: id };
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.company !== undefined) body.company = patch.company;
  if (patch.email !== undefined) body.email = patch.email;
  if (patch.phone !== undefined) body.phone = patch.phone;
  return apiPost("/api/customers/update", body);
}

/* 删客户 + 级联清掉其名下商机/跟进。 */
export function apiDeleteCustomer(id: number): Promise<{ ok: boolean; id: number; deals_deleted: number; activities_deleted: number }> {
  return apiPost("/api/customers/delete", { customer_id: id });
}

/* 删一条商机。 */
export function apiDeleteDeal(id: number): Promise<{ ok: boolean; deal_id: number }> {
  return apiPost("/api/deals/delete", { deal_id: id });
}

/* 删一条跟进。 */
export function apiDeleteActivity(id: number): Promise<{ ok: boolean; activity_id: number }> {
  return apiPost("/api/activities/delete", { activity_id: id });
}

/* 业务字典(服务端单一事实源):商机阶段白名单 + 终态标记 + 默认阶段 + 跟进类型建议集。
 * 选项从 /api/meta 下发,不再前端写死;DEAL_STAGES 仅作 meta 未就绪时的兜底。 */
export interface Meta {
  deal_stages: string[];
  closed_stages: string[];
  default_stage: string;
  activity_kinds: string[];
}

/* 访客埋点:页面加载/路由切换时上报一次(PV)。visitor id 由前端 localStorage
 * 生成并持久化,服务端不存 IP——隐私干净,线上只读模式也可用。 */
export function apiRecordVisit(): Promise<{ ok: boolean }> {
  let visitor = window.localStorage.getItem("lume_crm_visitor");
  if (!visitor) {
    visitor = "v-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem("lume_crm_visitor", visitor);
  }
  return apiPost("/api/visit", {
    path: window.location.pathname,
    referrer: document.referrer,
    ua: navigator.userAgent,
    visitor,
  });
}

export function apiVisits(): Promise<VisitsSummary> {
  return apiGet<VisitsSummary>("/api/visits");
}

export function apiMeta(): Promise<Meta> {
  return apiGet<Meta>("/api/meta");
}

export const DEAL_STAGES = ["初步接洽", "方案", "谈判", "成交", "丢单"];

export function fmtMoney(n: number): string {
  if (n >= 10000) {
    return "¥" + (n / 10000).toFixed(1) + "万";
  }
  return "¥" + Math.round(n).toLocaleString("en-US");
}
