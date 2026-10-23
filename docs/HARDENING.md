# lume-crm.erishen.cn 加固说明

> 背景:2026-10-22 公网上线后的攻击面评估。核心风险:全站 Basic Auth 唯一
> 认证层 + `/share/customer?id=N` 可枚举 + `?pin=` 走 URL 泄漏 + 无限流。
> 本目录 `nginx-lume-crm.conf` + `nginx-lume-crm-zones.conf` 已按此加固,
> 部署步骤见下。

## 1. 加固后的部署步骤(在 VPS 上)

```bash
# 1) 拷贝两个 conf 到 nginx(路径自选, 保持相对关系即可)
sudo cp deploy/nginx-lume-crm.conf   /etc/nginx/conf.d/lume-crm.conf
sudo cp deploy/nginx-lume-crm-zones.conf /etc/nginx/conf.d/lume-crm-zones.conf

# 2) zones 文件里的 zone/map 定义**必须在 http{} 层**, 不能放 server{} 里。
#    /etc/nginx/conf.d/*.conf 通常被 include 在 http{} 里, 直接放即可;
#    若报错 "limit_req_zone directive is not allowed here" 之类,
#    说明 include 位置不对, 需把 zones.conf 的 include 挪到 http{} 内
#    (通常在 server include 之前)。

# 3) 校验 + 重载
sudo nginx -t && sudo systemctl reload nginx

# 4) 确认 htpasswd 强度
sudo htpasswd -v /etc/nginx/lume-crm.htpasswd admin   # 看 $6$ 强哈希
# 密码 >= 20 位随机, 且与 WordPress/其他站点不复用:
#   htpasswd /etc/nginx/lume-crm.htpasswd admin   # 改密码
```

## 2. 加固项清单

| # | 风险 | 加固 | 文件 |
|---|------|------|------|
| 1 | 字典爆破 / 爬虫 | `limit_req_zone crm429 5r/s + burst 20` → 429 + Retry-After | zones + conf |
| 2 | `/share/customer?id=N` 枚举爬全库 | 应用层 token(`sha256(salt:id[:version])` + `share_links` 校验)+ `crm-share 10r/m` | db.lume + zones + conf |
| 3 | `?pin=` / `?token=` 写进 access log / Referer(凭据/PII) | `map` 打码 URL 与 Referer 中的 pin/token + `log_format crm_crm` | zones + conf |
| 4 | XSS / 点击劫持 / MIME 嗅探 | CSP + X-Frame-Options DENY + nosniff + Referrer-Policy + Permissions-Policy | conf |
| 5 | 弱 TLS | 仅 TLSv1.2/1.3 + HIGH 密码 + 会话缓存 | conf |
| 6 | 单 IP 耗尽 worker | `limit_conn_zone crm_conn 20` | zones + conf |
| 7 | 429 响应无 Retry-After | named location `@crm_ratelimit`, 带 Retry-After 并**重复**安全头 | conf |

**nginx 继承坑**:server 级有 `add_header` 安全头组,任何 `location` 里再写
`add_header` 都会**中止继承**导致安全头丢失。因此 `location /` 不写;
`location /share/` 只补应用没有的 HSTS/Permissions,借此同时中止继承
server 级 `Referrer-Policy: strict-origin`,让 lume 响应自带的
`Referrer-Policy: no-referrer`(以及 XFO/CSP/nosniff)生效;不要再重复
XFO/CSP/Referrer,否则出现双头。`@crm_ratelimit` 因为要带 `Retry-After`,
仍需重复 server 级整组安全头。改 server 级安全头时记得同步该块。

> 另:限流状态码用 `limit_req_status 429; / limit_conn_status 429;`,
> `limit_req_zone` **没有** `status=` 参数(写了会 `invalid number of
> arguments`, 且 nginx 1.24 与新版都拒绝)。

## 3. PIN 泄漏的根治(代码已完成, v0.8.1 已发布)

`crm.lume` 的 `visit_gate()` 三条通道:`X-CRM-Pin` 专用头(反代推荐) →
`Authorization: Bearer <pin>` / 裸 PIN(直连)→ `?pin=`(过渡 fallback)。
对应的 `lume` **v0.8.1**(2026-10-23)起已映射 `req.headers` 与
`req.authorization`,容器/本机直接用该版本即可,**不再需要源码构建**。
旧版二进制没有这两个字段 → 自动走 query fallback,功能不坏,只是 PIN 仍在 URL。
未设 `LUME_CRM_VISIT_PIN` 时:只读演示(`LUME_CRM_READONLY=1`)一律 403
(fail closed,防止忘配时 `/api/visits` 的 IP 列表裸奔);本地可写开发仍免 PIN。

- [x] `lume` v0.8.1 已发布(含 bridge 的 `req.headers` / `req.authorization`)。
- [x] 只读模式下未配 PIN 时 `/api/visits` fail closed(403),避免漏配裸奔。
- [x] lume-crm 镜像/本机二进制升级到 v0.8.1(`Dockerfile` 的
      `ARG LUME_VERSION=v0.8.1` 已 pin),镜像重建验证通过。
- [ ] 把 `LUME_CRM_VISIT_PIN` 重新生成成 `openssl rand -hex 32`,
      确认旧值不在 git 历史里。
- [ ] 客户端改走 `X-CRM-Pin` 头(反代推荐):
      `curl -u admin:<basic> -H "X-CRM-Pin: $PIN" .../api/visits`。
      nginx 默认转发自定义头,无需改配置;应用对头名大小写不敏感。
      直连/无反代 Basic 时也可用 `Authorization: Bearer $PIN`;反代塞进来的
      `Basic ...` 会被应用显式跳过,不会误当 PIN。
      Nginx 的 `?pin=` 打码(`crm_crm` log_format)保留作过渡兜底。

> **为什么不用 Authorization**:nginx 的 `auth_basic` 与它抢同一个头——一个
> 请求只能带一个 `Authorization`,客户端无法同时发 `Basic`(过反代)和
> `Bearer`(给应用)。故反代场景改用 `X-CRM-Pin`;应用保留 Bearer/裸 PIN
> 通道供直连使用。
>
> **依赖**:`X-CRM-Pin` 读取 `req.headers`,`req.authorization` 同理,二者
> 自 lume **v0.8.1** 起可用(v0.8.0 及更早没有);未升级时 `X-CRM-Pin`
> 静默失效、只剩 `?pin=`。

## 4. 分享链接:防枚举 + TTL/撤销

`/share/customer` 现在必须带正确的 `?token=`:

- token = `substr(sha256(<salt>:<id>), 0, 32)`(version 0)或
  `substr(sha256(<salt>:<id>:<version>), 0, 32)`(version>0);链接元数据
  (`customer/version/token/created/expires/revoked/last_access`)落 `share_links`
  表。salt 优先 `LUME_CRM_SHARE_SALT`,未配置则回退用 `LUME_CRM_VISIT_PIN`
  派生;两者都无 → 一律 404(fail closed)。
- 生成 salt:`openssl rand -hex 32`,写进容器 env / `.env`
  (`LUME_CRM_SHARE_SALT=...`)。变量名别含 SECRET/TOKEN/KEY(会被 `env()` 屏蔽)。
- 过期:`LUME_CRM_SHARE_TTL_DAYS`(默认 30 天;0=不过期,不推荐);过期链接
  404,`/api/customer` 不再返回 token。
- 撤销/轮换:`POST /api/share/revoke` 撤销该客户全部有效链接;
  `POST /api/share/create` 先撤销旧链接再生成 version+1 新链接。两个接口
  只写 `share_links`,**刻意不套 `LUME_CRM_READONLY`**(只读演示也应能撤销
  泄露链接),公网必须由 nginx Basic 保护。
- 兼容:老库无 `share_links` 行时,version=0 的旧 `sha256(salt:id)` token
  首次访问会落库;一旦撤销/过期,旧 token 不会复活。
- 访问审计:`last_access` 随成功访问更新(Unix 秒);token 明文存库,DB 泄露
  即等同链接泄露,故 SQLite 卷仍需磁盘加密/权限。
- Nginx `/share/` 设了 `auth_basic off`,让拿到 token 的外部客户可直接打开
  (否则"分享"无意义);无 token / token 错误都 404,且 `?token=` 已打码
  (保留路径/id 便于审计,重复参数也会逐段打码)。
- 分享页 `<head>` 加了 `<meta name='referrer' content='no-referrer'>`,防止
  浏览器把含 token 的分享 URL 作为 Referer 发给外链(如页脚 GitHub);nginx
  access log 的 `$http_referer` 也用 `[redacted]` 兜底。HTTP→HTTPS 的 301
  同样走 `crm_crm` 格式,不会把 `?token=` 落到默认 access.log。
- 分享页响应加 `Cache-Control: no-store` + `X-Robots-Tag: noindex,nofollow,noarchive`
  (应用层 headers envelope),HTML 里再加 `<meta name='robots'>`;`www/robots.txt`
  同时 Disallow `/share/`、`/api/`。三层防索引/缓存。
- 分享页 nginx location 只补 HSTS/Permissions,并借 `add_header` 中止继承
  server 级 `Referrer-Policy: strict-origin`;lume 路由自身返回
  `Referrer-Policy: no-referrer` / XFO / CSP / nosniff,不再重复。
  `/robots.txt` 设 `auth_basic off`,让爬虫能读到 Disallow(真正的门仍是
  noindex 头/meta,robots.txt 不是安全控制)。
- `GET /api/customer` 会返回 `share_token` / `share_expires` 供前端拼链接与
  显示有效期;空 token 表示已撤销/过期。该接口必须留在 Basic Auth 之后。
- 分享页默认隐藏 `activities.note`(内部跟进备注),显示「内部备注已隐藏」;
  仅 `LUME_CRM_SHARE_INCLUDE_INTERNAL=1` 时恢复。商机金额仍展示,后续可加
  字段级 `shareable` 标记。
- `check.sh` 第 4 项会探测多个 id,出现任何 200 即判失败;429 视为结果
  不完整(共享 zone 10r/m,可等 60s 复跑),不会误判成通过。

> **不要把 lume 自身 Basic 和公开分享同时开**:`LUME_AUTH_PASSWORD` /
> `HTPASSWD_FILE` 在 v0.8.1 是全局门,连 `/share/` 也会 401(已在容器实测);
> nginx 的 `auth_basic off` 只关反代层。公网分享只保留 nginx Basic 并给
> `/share/` 例外。
>
> **残余风险**:nginx `error.log` 在上游 5xx/超时时可能打印原始 request line
> (含 `?token=`),它不走 access log 的 `map` 打码。建议单独 `error_log` 并
> 限制权限/轮转;Docker/应用日志同理。

> 依赖:`token` 用 `sha256()` 内建(2026-10-15 加入):v0.6.1 没有、v0.8.0+
> 有;本项目统一要求 **lume v0.8.1+**(同时满足 §3 的请求头字段)。

## 5. 容器/运维侧核对

- `docker inspect lume-crm | grep LUME_CRM_READONLY` 应为 `1`(演示模式,
  写 API 全 403 + Agent 工具白名单收敛)。
- **VPS 端口统一 8089**:compose 默认 `${HOST_BIND:-127.0.0.1}:${HOST_PORT:-8089}:8089`,
  `deploy/nginx-lume-crm.conf` 的 `proxy_pass` 也是 `127.0.0.1:8089`;用 compose 或
  `docker run -p 127.0.0.1:8089:8089` 都一致。
- 本地若 8089 被旧 lume dev server 占用,用 `HOST_PORT=11080 docker compose up -d`
  联调;VPS 不要设 `HOST_PORT`(或显式 8089)。两种模式都只绑 `127.0.0.1`,
  确认没有 `0.0.0.0:8089`: `sudo ss -lntp | grep -E '8089|11080'`。
- `LUME_CRM_VISIT_PIN` / `LUME_CRM_SHARE_SALT` 若设了,`docker exec` 进去
  看是否 ≥32 字符。
- 可选:fail2ban 规则对 401 爆破(10 次/10min → 封 1h)。

## 6. 隐私/合规残余

**已缓解(本批代码)**:

- 访客 IP 只信 nginx 覆写的 `X-Real-IP`(回退 `remote_addr`),不再读
  可伪造的 `X-Forwarded-For`;nginx 同时把 XFF 覆写为 `$remote_addr`。
- `referrer` 入库前剥掉 query/hash,避免第三方 URL 的 token/搜索词进库。
- 分享页 `no-referrer` + `noindex/noarchive` + `Cache-Control: no-store`;
  `/api/*` 的 PII 读接口同样 `no-store`。
- 分享链接有 TTL(默认 30 天)、单客户撤销/轮换、`last_access` 审计;
  分享页默认隐藏内部跟进 note。
- `visits_full`/旧 `visits` 按 `LUME_CRM_VISIT_RETENTION_DAYS`(默认 90 天)
  清理;启动时 + 运行中每 24h;历史 referrer 启动时剥 query/hash。
- PIN/token 在 access log / 301 中打码;只读未配 PIN 时访客统计 403。

**仍需产品/合规决策(代码未做)**:

- **分享页仍有过度披露**:内部 `activities.note` 已默认隐藏,但商机标题/
  金额、邮箱/电话仍全量展示;尚无字段级 `shareable` 标记。真实数据可按客户
  类型选择隐藏金额或只分享联系人摘要。
- **分享 token 在 URL/DB**:`last_access` 已记录,但 token 明文存 `share_links`
  且 URL 会进浏览器历史/代理日志;轮换能止损,不能防已泄露副本。高敏客户
  建议一次性 token + 更短 TTL。
- **LLM 外发**:`crm_*` 工具会把客户 PII 送进 `LLM_API_URL`。真实数据必须
  有 DPA/告知同意/区域/最小化,或改用本地模型/脱敏;当前 demo 请只放虚构数据。
- **访客保留期已自动清理,但页脚/隐私政策仍需写明**:`visits_full` 存
  IP/UA/referrer/visitor,默认 90 天;旧 `visits` 表也同步删。env=0 会关闭
  清理,公网不要这么配。
- **访问日志**:nginx access log 仍有 IP/UA/路径/客户 id/token 打码后的记录,
  权限、轮转、保留期未定义;`/api/visits` 的 IP 列表也仅靠 PIN。
- **隐私政策/同意**:页脚只有一句说明,没有隐私政策、cookie/localStorage
  告知、数据主体权利流程;visitor id 是持久标识符,公开上线前需补齐。
- **访问控制粒度**:Basic 是共享账号,任一持有者可读全部客户和 share_token;
  无 per-user 审计。高敏感场景需独立账号/ACL。
- **日志残余**:nginx `error.log` 在 upstream 5xx/超时时可能带原始
  `?token=`;需单独 error_log、限制权限并轮转。
- **`?pin=` fallback**:日志已打码,但 URL 仍可能进浏览器历史;迁移到
  `X-CRM-Pin` 后应移除。
- **静态数据**:容器默认 root、SQLite 卷未加密;真实 PII 需非 root、磁盘
  加密、备份加密与保留策略。

## 7. 体检

上线/每次改 conf 后跑:

```bash
sh check.sh            # 默认 https://lume-crm.erishen.cn
sh check.sh https://lume-crm.erishen.cn
```

全绿即认证门 + 安全头 + 限流 + 枚举防护均生效。
