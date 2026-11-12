# TODO — lume-crm

## 定位(先说清,决定下面所有优先级)

lume-crm.erishen.cn 目前是**只读演示**(`LUME_CRM_READONLY=1`):
写 API 全 403,Agent 工具白名单只留 `crm_search_customers` /
`crm_get_customer` / `calc` / `get_time`。提示注入没有可破坏面。

所以真正的风险**不是"被写入/拖库",而是"只读数据本身是客户 PII,
公网可被爬"**:
- `GET /api/customers` 无鉴权即可全量读客户表(姓名/公司/邮箱/电话/商机金额)
- `GET /share/customer?id=N` 可枚举
- `?pin=` 猜中后看得到访客统计里的 IP 列表

**结论:数据本身该不该在公网裸奔,比任何 nginx 头都重要。** 若客户表里
是真实 PII,最有效的动作是**把 seed/持久化数据换成虚构数据**,
而不是继续往反代层堆限流。下面按此重排优先级。

## 现状(Nginx 反代层已做)

`deploy/nginx-lume-crm.conf` + `nginx-lume-crm-zones.conf` +
`docs/HARDENING.md` + `check.sh`:全员 429 限流 + 分享页枚举防护 +
`?pin=` 日志打码 + 安全响应头(CSP/HSTS/XFO)+ TLS 收紧 + 连接上限。
这些是**止血**,不是根治。

## P0 — 数据脱敏 → 已关闭(2026-10-22)

`.data/crm.db` 里的客户数据为**纯虚构 demo 数据**,公网无真实 PII 泄漏面。
P0 关闭;以下 P1 项按"虚构数据 + 只读"重排。

## P0b — 分享链接生命周期 + 字段分级 + 访客保留期 → 已完成(2026-10-23)

- [x] `share_links` 表(version/token/created/expires/revoked/last_access);
      老库 `CREATE IF NOT EXISTS` 自动补,老 token(version 0)首次访问迁移落库。
- [x] `LUME_CRM_SHARE_TTL_DAYS` 默认 30 天;过期链接 404,`/api/customer`
      不再返回 token。
- [x] `POST /api/share/create` 轮换(旧链接立即失效)、
      `POST /api/share/revoke` 单客户撤销;两者只写 `share_links`,
      刻意不受 `LUME_CRM_READONLY` 限制(安全控制)。
- [x] `/api/customer` 返回 `share_expires`;前端显示有效期 + 生成/重新生成/撤销。
- [x] 分享页默认隐藏 `activities.note`(「内部备注已隐藏」);
      `LUME_CRM_SHARE_INCLUDE_INTERNAL=1` 才恢复。
- [x] `LUME_CRM_VISIT_RETENTION_DAYS` 默认 90 天;启动 + 每 24h 清理
      `visits_full`/旧 `visits`;启动时一次性剥历史 referrer 的 query/hash。
- [x] VPS 端口统一 8089:compose `HOST_PORT` 默认 8089,本地 `.env` 用 11080;
      nginx `proxy_pass` 8089 不变。

## P1 — 根治 `?pin=` 走 URL 的 PII 泄漏 → 已完成(2026-10-22)

- [x] `lume/lang/bridge.c` `request_to_value` 映射 `req.authorization`
      (agent-httpd 早已解析该头到 `HttpRequest.authorization`,仅需一行
      `map_set`;未改 agent-httpd)。
- [x] `crm.lume` `visit_gate()` 优先读 `Authorization: Bearer <pin>`,
      `?pin=` 作 fallback(旧版 bridge 无该字段时 `get` 返回 `""` → 自动
      落回 query,零破坏)。`~/.local/bin/lume --check crm.lume` 通过。

**部署侧还需**(lume v0.8.1 已发布):
- [ ] 升级到 `lume v0.8.1` 并 rebuild lume-crm 镜像(`Dockerfile` 已 pin
      `ARG LUME_VERSION=v0.8.1`),让 `req.headers` / `req.authorization`
      生效;旧版二进制自动走 query fallback。
- [ ] 客户端改走 `X-CRM-Pin` 头:`curl -H "X-CRM-Pin: $PIN" .../api/visits`
      (反代 Basic Auth 下仍可用;nginx 默认转发自定义头)。直连可用
      `Authorization: Bearer $PIN`。Nginx 的 `?pin=` 日志打码保留作兜底。
- [ ] **反代冲突已解决**:`auth_basic` 占用 `Authorization`,应用改用
      `X-CRM-Pin` 读 `req.headers`(头名大小写不敏感);`Basic ...` 显式跳过。
      `req.headers` 与 `authorization` 均自 lume v0.8.1 起可用。
      详见 HARDENING §3。

- [ ] 重新生成 `LUME_CRM_VISIT_PIN` 为 `openssl rand -hex 32`,并
      `git log -S` 确认旧值没进过历史(过渡期 query 仍可读,新 PIN 需
      同时能走 header;部署后把 Nginx `?pin=` 打码保留作兜底)。
- [x] 未配 PIN 时 `/api/visits` 一律 fail closed(403),避免漏配裸奔。

### P1 — `/share/customer?id=N` ID 枚举 → 已关闭(2026-10-23)

> 后续已在 P0 加 TTL/撤销/字段分级;下面保留当时的派生 token 设计记录。

- [x] 分享链接必须带 `?token=`:`token = substr(sha256(salt:id), 0, 32)`。
      用**派生** token 而非随机列:DSL 无 CSPRNG,且 `sql_write` 禁 ALTER
      (随机列要整表迁移);派生方案无需迁移、链接稳定、salt 保密即抗枚举。
- [x] salt 取 `LUME_CRM_SHARE_SALT`,缺失回退 `LUME_CRM_VISIT_PIN`;
      两者都无 → `/share/*` 一律 404(fail closed)。
- [x] Nginx `/share/` 设 `auth_basic off`(token 即能力)+ `?token=` 日志打码。
- [x] `check.sh` 改为枚举多个 id,出现 200 即失败(429 视为不完整,不误判通过)。
- [x] 分享页 `<meta no-referrer>` + nginx Referer 打码,防止 token 经 Referer 外泄。
- [ ] 部署时设 `LUME_CRM_SHARE_SALT=$(openssl rand -hex 32)`
      (不设则回退用 PIN 派生,链接会随 PIN 变化)。
- [ ] 依赖 `sha256()` 内建(v0.8.0 起有);统一要求 `lume v0.8.1+`,
      `Dockerfile` 已 pin。

### P1 — audit log(取证据,不是控权)

现在只有 Nginx access log。加一份**应用侧**审计,给安全事件可回放:

- [ ] `crm.lume` 对 401/403/429/写操作 追加写 `.data/audit.log`
      (带时间戳 + 源 IP + 路由 + 结果),`logrotate` 90 天 + zstd。
- [ ] 与 Nginx access log 分文件,避免 PII 集中在一个 log。

### P2 — fail2ban 兜底(VPS 侧,非本仓代码)

- [ ] VPS 上加 fail2ban 规则:`nginx-bad-auth`(401 10 次/10min → 封 1h)
      + `crm-share-abuse`(429 密集封 30min)。写到 `docs/HARDENING.md`
      附录,不进本仓(运维态)。

### P3 — 产品定位边界声明(防"变 PHP")

lume 若未来加"跑不可信用户 .lume 脚本"的能力,CRM 的多租户数据 +
长驻 worker 会进入 php2shell 同类攻击半径(见 `../agent-httpd/TODO.md`
P1、`../lume-core/TODO.md` P11)。

- [ ] 在 `README` 明确:lume-crm 只跑**受信**(自己写的)脚本;
      官方不提供"运行第三方/用户提交脚本"路径,sandbox 责任推给
      集成方。这条一旦要打破,先做 WASM/seccomp 隔离再开闸。

---
## 部署核对清单(每次上线前跑 `sh check.sh`)

- [ ] `LUME_CRM_READONLY=1` 生效(写 API 403 + Agent 工具白名单)。
- [ ] `LUME_CRM_VISIT_PIN` 已设(未设时 `/api/visits` 403),分享 salt 已设。
- [ ] 端口只绑 `127.0.0.1:8089`(VPS;本地联调可 `HOST_PORT=11080`),
      `ss -lntp` 无 `0.0.0.0:8089/11080`。
- [ ] nginx `proxy_pass` 与容器宿主端口一致:VPS 8089(compose 默认 /
      docker run 8089),本地 11080 仅联调。
- [ ] `LUME_CRM_SHARE_TTL_DAYS`、`LUME_CRM_VISIT_RETENTION_DAYS` 按隐私政策设置;
      不要把 `LUME_CRM_SHARE_INCLUDE_INTERNAL=1` 带到公网。
- [ ] htpasswd `$6$` 强哈希 + 密码 ≥20 位随机,全站不复用。
- [ ] `check.sh` 全绿:认证门 401 / 6 项安全头 / 限流 429 / 探针不 200。