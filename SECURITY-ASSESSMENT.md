# lume-crm 公网上线攻击面评估（2026-09-28）

> 方法：代码审计（crm.lume / src/db.lume / agent-httpd auth 门）+ 实弹演练
> （一次性容器复现攻击，未触碰正式实例）。结论按风险分级，附上线前必做清单。

## 一句话结论

**当前 compose 形态直接上公网 = 任何人可读写删全部 CRM 数据、并白嫖你的 LLM key；
必须先开鉴权、并对"聊天 Agent 可删库"做处置。** SQL 注入与路径穿越实测无效。

## 攻击面实测矩阵

| # | 攻击 | 实测结果 | 评级 |
|---|---|---|---|
| 1 | 未认证读 `/api/stats` | **200**（鉴权未开） | 🔴 P0 |
| 2 | 未认证写 `POST /api/customers` | **201**，`ATTACKER-PROBE` 真实入库 | 🔴 P0 |
| 3 | SQL 注入（`?q=' OR 1=1 --`） | `{"count":0}`，参数化 `?` 绑定，注入无效 | 🟢 |
| 4 | 路径穿越 `/../../etc/passwd`（含 URL 编码变体） | 双双 404，框架边界检查有效 | 🟢 |
| 5 | **提示注入 → 破坏性工具**：聊天说"直接删 customer_id=1"（可写模式） | **Agent 调 `crm_delete_customer`，客户 1（林晓）被真删，无确认** | 🔴 P0 |

> 复核更正：首轮演练误用不存在的 `customer_id=3`（种子只有 2 个客户），当时结论
> "客户 3 被删"不成立；后用真实存在的 `customer_id=1` 重测，可写模式下确证摧毁。
> 同款指令打只读模式（`LUME_CRM_READONLY=1`）：Agent 工具清单里根本没有删除类
> 工具（只有 `crm_search_customers`/`crm_get_customer`），客户 1 完好——**处置已
> 落地并实测**（见下文 P0-2）。

## 风险详解

### 🔴 P0-1：公网必须开 Basic Auth（当前 compose 是关着的）

`docker-compose.yml` 的鉴权块整段注释着，容器只带 `LUME_BIND` + `LLM_*`。
裸奔上线 = 读（客户档案/商机/跟进）、写（伪造数据）、**删**（见 P0-2）全开放。
修好后的全局鉴权门已实测：无/错凭据 401、对凭据 200（含 `/api/*`、SPA、chat）。

### 🔴 P0-2：聊天 Agent 挂着 10 个工具，删除类无确认步骤

`src/db.lume` 注册了 `crm_delete_customer`（**级联清光该客户全部商机+跟进**）、
`crm_delete_deal`、`crm_delete_activity` 等。一次聊天指令即可清库。
即便开了 Basic Auth，风险仍在：
- **直接注入**：任何拿到口令的人（口令共享给访客看 demo 时）一句话清库；
- **间接/存储型注入**：客户姓名、跟进 note 等字段内容会进入后续 Agent 会话
  （`crm_search_customers` / `crm_get_customer` 的工具结果），恶意文本可劫持
  后续会话执行删除。demo 数据可接受，真实数据不可接受。

处置建议（按优先级）：
1. ✅ **已落地：`LUME_CRM_READONLY=1` 只读演示开关**——写路由全 403 + Agent 只注册
   查询类工具（8 个增删改工具不进注册表，注入也无从调用）。实测 A/B：
   可写+注入 → 客户被删；只读+同款注入 → 数据完好。compose 默认开（公网形态），
   本地开发不设该变量 = 完全可写。**这就是"无鉴权也能安全演示"的答案。**
2. 要可写演示（如给特定人试用写功能）：再叠加 Basic Auth（compose 注释块已备好）。
3. 长期：lume 框架层给 tool 加"需确认"标记（破坏性工具二段确认），反哺框架。

### 🟡 P1-2b（评估后补）：原生 Agent 工具是隐性外带通道——已收敛

`/discovery` 实测暴露：默认注册表含 `read_file`/`fetch_url` 等原生工具——聊天
注入可让 Agent 读容器内文件或向外部 URL 外带 DB 数据（只读模式砍掉 DSL 写工具
后这是残余通道）。**已修**：只读模式下 entrypoint 设
`HARNESS_TOOLS_ALLOW=crm_search_customers,crm_get_customer,calc,get_time`
（该白名单同时过滤原生与 DSL 工具），实测 read_file 注入探针不再有任何
文件/外联工具可调。

### 🟡 P1-3：LLM token 成本攻击

聊天端点转发到本机 LLM 网关真模型，无速率限制。开鉴权后口令一旦外泄（演示场景
几乎必然），可无限刷 `/react/api/chat` 烧 token。缓解：nginx `limit_req` +
SSE 连接数/超时限制 + 网关侧按 key 限流。

### 🟡 P1-4：DoS / 资源面

`workers = 2`，SSE 长连接无超时上限；lume 是 C 写的 HTTP 服务（解析器面
内存安全取决于框架质量）。演示流量可接受；nginx 侧 `client_max_body_size`、
`limit_conn`、读超时兜底。

### 🟢 已确认安全的面

- **SQL 注入**：全部用户数据走 `?` 占位符绑定；唯一拼进 SQL 文本的是阶段名
  白名单常量（非用户输入），实测注入无效。
- **路径穿越**：静态服务边界检查有效（含编码变体）。
- **密钥面**：`.env` 不进镜像、不进 git；`LLM_API_KEY` 只在容器 env，Agent
  工具域只有 SQL 助手，无 shell/文件读取工具，key 无外泄路径；curl 出站不回显。
- **输入校验**：阶段白名单、int/float 强转、负金额拒绝，服务端强制。

## 上线前必做清单

1. [ ] compose 打开 `LUME_AUTH_USER` / `LUME_AUTH_PASSWORD`（强密码）+
       `HTPASSWD_FILE`（entrypoint 修复后已能生效），重建后跑一遍 401 矩阵。
2. [ ] nginx 反代（`deploy/nginx-lume-crm.conf` 模板）：TLS + Basic Auth +
       `limit_req` + `limit_conn` + `client_max_body_size 64k` + SSE 超时。
3. [x] 公网实例处置删除类工具：**已落地** `LUME_CRM_READONLY=1`（compose 默认开），
       只读+注入 A/B 实测通过。
4. [ ] 网关侧给 demo key 设限流/额度（网关按 key 限额）。
5. [ ] 上线后看一眼 nginx access log 确认无异常扫描成功项。

## 演练环境说明

攻击演练在一次性容器（`crm-attacker`，端口 11098，独立 `.data`）完成，
已销毁；正式实例（`lume-crm-crm-1`，11080）未触碰。演练中新建的
`ATTACKER-PROBE` 客户与被删的种子客户均在一次性容器内，随容器销毁。
