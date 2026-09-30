# Lume CRM — 用 Lume 开发 CRM 后台管理系统的完整样板

[English](README.md) | 简体中文

> **这个项目想证明一件事:后台管理系统(CRM 这类)可以完全用 Lume 开发。**
> 从数据库到 API 到 Agent 到前端壳,服务端没有一行其它语言——一个 C11
> 单二进制 `lume` + 一份 `.lume` 脚本,就撑起了一整套客户/商机/跟进管理后台。
> 它不是「Lume 玩具」,是一个能直接跑、有真实数据模型与业务规则、带 LLM
> Agent 交互的 admin 系统样板,拿来照着写下一个内部系统即可。

## 它展示了 Lume 做后台的哪些能力

| 后台要素 | 本项目里由 Lume 提供的 | 对应文件 |
|---|---|---|
| 数据库 | 原生 `sql_query`(物理只读)/ `sql_write`(护栏写),参数绑定杜绝注入 | `src/db.lume` |
| 领域模型 | 客户/商机/跟进三表 + 级联删除 + 管道推进自动留痕 + 成交率统计 | `src/db.lume` |
| REST API | 路由糖 `get`/`post`,错误码 + JSON 响应体,并发写 flock 串行 | `crm.lume` |
| LLM Agent | `tool` 注册(10 个 typed 工具)/ SSE 聊天 `/react/api/chat`,缺键零值兜底 | `src/db.lume` + `crm.lume` |
| 前端 SPA | `server { spa = true }` history 路由回退 + 单 `app.js` React 壳 | `crm.lume` + `src/crm/` |
| 强类型 | `.lume` 全量 `--check`,首错即停,同名/缺键/类型错编译期拦截 | 全量 |

> 一句话:**写业务只写 `.lume` + 前端,不碰任何其它语言运行时。**

## 线上只读演示

<https://lume-crm.erishen.cn> 以 `LUME_CRM_READONLY=1` 运行:写 API 全部 403,
Agent 只注册查询类工具(`crm_search_customers` / `crm_get_customer`),前端也
**隐藏全部写 UI**——仪表盘新建客户表单、客户页加商机/编辑资料/删除/推进管道/
记跟进等表单与按钮、以及写类快捷问法,都只在本地 localhost 开发时出现。聊天页内置
`crm_*` 快捷问法 chips(点按直发)与 markdown 表格渲染;另含「用 Lume 开发」
教学页(`/examples`,五段可复制的 `.lume` DSL 片段)与全站页脚
([开源仓](https://github.com/erishen/lume) +
[介绍文章](https://erishen.cn/lume))。本地可写运行:
`LUME_CRM_READONLY= docker compose up`。

## 技术形态

> 请求流图、Agent 工具调用循环与只读模式的传导机制:见
> [ARCHITECTURE.md](ARCHITECTURE.md)(英文)。

业务逻辑全在一个 `.lume` 脚本里(C11 单二进制 `lume` 服务端),前端是 React +
TypeScript **单页应用(history 路由)**,esbuild 打成单一 `app.js` 落进 docroot。
没有 Node 服务——数据是 **Lume 原生 SQLite 内建**(`sql_query` 物理只读 /
`sql_write` 护栏写 + flock 串行,`.data/crm.db`),前端靠 JSON API + SSE Agent
聊天驱动。

SPA 说明:`server { spa = true }` 让静态 404(GET + Accept:text/html)回退到
docroot 根的 `index.html`,所以能用**干净 URL**(`/customers/3`)、刷新不 404。
点击站内链接走 `pushState` 客户端导航(无白屏抖动),API/fetch 的 404 不受影响。

## 快速开始

```bash
make                 # 类型检查 + 构建前端 + 起服务(阻塞,Ctrl-C 停)
# → http://127.0.0.1:8089
```

其他目标:`make check`(DSL 类型检查) · `make ui`(只构建前端) ·
`make crm-dev`(前端热更新 + 起服务) · `make clean`(清产物与数据)。
`sh run.sh` 是 Makefile 之外的等价独立脚本入口。

页面(SPA history 路由,干净 URL):`/` 仪表盘 · `/customers` 客户 ·
`/customers/N` 客户详情 · `/chat` Agent · `/examples` 用 Lume 开发(教学页)。
任意路由直接访问 / 刷新都能打开(`spa=true` 回退到壳)。

依赖:Lume 用 **release 版本**(不再依赖源码树 `../lume`)。安装:
`curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh | sh`
(二进制落在 `~/.local/bin/lume`;CRM 用到的 DSL 特性需 `lume >= v0.5.1`,安装时
建议固定版本 `LUME_VERSION=v0.5.1 sh install.sh`)。前端 esbuild 优先用本目录
`npm install` 后的 `./node_modules/.bin/esbuild`,其次 PATH,最后兜底
`../lume/frontend/node_modules`(过渡);React 同样由 node_modules 解析。

## Docker

镜像基于 `alpine:3.20`:自 lume **v0.5.1** 起官方提供 `*-static` 预编译二进制
(`install.sh` 传 `LUME_STATIC=1` 拉取),该二进制把 libsqlite3 + 全部 libc 烤进
自身,**零运行时依赖**——故镜像无需 `libsqlite3-0`、不要求特定 glibc 版本,基底
可换 alpine,镜像从 120MB 砍到 ~10MB 级。前端 `www/` 是宿主 `make ui` 产出的纯
静态包,直接 COPY。

> DNS/出域说明(实测厘清):lume 的 LLM 调用是 fork + execlp 系统里的 `curl`
> (`agent-httpd/src/agent/agent.c`),DNS 由 alpine 自带 musl curl 解析(走 Docker
> 内嵌 DNS),`host.docker.internal` 等主机名正常可用——lume-invest 同款部署(容器
> 内调 host.docker.internal:<port> 的网关)已实证跑通。`curl` 是真实 LLM 的硬依赖
> (alpine 基础镜像不带,镜像里已显式安装)。lume 本体不解析域名;CRM 核心(SQLite +
> SPA + REST API)完全本地,离线演示亦不受影响。

```bash
make ui                   # 先构建前端(产出 www/app.js)
docker build -t lume-crm:latest .
docker run -d -p 8089:8089 -e LUME_BIND=0.0.0.0 lume-crm:latest
# → http://localhost:8089
```

- `crm.lume` 的 `bind` 默认 `127.0.0.1`,容器内需 `LUME_BIND=0.0.0.0` 才能被
  `-p` 端口映射命中;本地开发仍是安全的回环绑定(见 `server{}`)。
- **容器内真实 LLM(已接好)**:compose 从 `.env` 注入 `LLM_API_URL`(指向你自己的
  LLM 网关,如 `host.docker.internal:<port>/v1/chat/completions`)+ `LLM_MODEL=auto`;
  URL/key 都不写死缺省——放同目录 `.env`(gitignored),compose 经 `${VAR}` 变量
  替换注入。任一不配则聊天回落离线演示引擎。
- **SSR 客户分享页**:`GET /share/customer?id=<n>` 纯服务端渲染(el/html 组件,
  零 JavaScript,自包含 CSS),可直接外发链接展示单个客户全档(商机/跟进)。
  客户字段全部经 `html()` 标量槽输出——自动转义,存储型 XSS 不可行(有实测)。
  > **C SSR vs React SSR**:lume 另支持 React SSR——`server{ react_socket }` 把
  > `/react/*` FastCGI relay 到常驻 node 进程(react-dom/server + StaticRouter +
  > hydration),见 `examples/react-ssr.lume`。本 CRM **刻意不用**它:接 node 常驻
  > 进程会破坏「14.3MB 单二进制、无 Node 运行时」的核心卖点,业务页用框架内建的
  > C SSR(零 JS 零依赖)即可;React SSR 适合内容型/重交互页面(官网、文档站)。
- **发现页**:`GET /discovery` 返回框架内省目录(readonly 标志 + tools/skills/mcps)。
  只读模式下工具清单恰好 4 个(2 查询 DSL 工具 + calc + get_time)——安全故事在
  页面上自证;容器 entrypoint 在只读模式同步收敛 `HARNESS_TOOLS_ALLOW`,
  砍掉 read_file/fetch_url 等原生工具,聊天 Agent 无读文件/外联通道。
- **只读演示模式(公网推荐, compose 默认开)**:`LUME_CRM_READONLY=1` 时全部写 API
  统一 403,且 Agent **只注册查询类工具**(8 个增删改工具不进注册表)——提示注入
  再狠也没有可调用的破坏面,故**无需鉴权即可安全公网演示**:访客能看全部数据、
  能跟真模型聊天,但玩不坏。前端在非 localhost 下同步隐藏全部写 UI
  (`ui.tsx` 的 `IS_LOCAL`),访客看不到提交必 403 的表单。已实测 A/B:可写+注入
  "删除客户"→ 真删;只读+同款注入 → Agent 无删除工具可调,数据完好。
  本地开发不设该变量 = 完全可写。
- **公网鉴权(实测厘清)**:lume 的 Basic Auth 门是**全局的**——自定义 `/api/*`
  与内置路由同一道前置门(`http.c`/`event.c` 在路由分发前校验),无/错凭据一律
  401(fail-closed)。容器设 `LUME_AUTH_USER` + `LUME_AUTH_PASSWORD`,entrypoint
  现场生成 `$6$` htpasswd 并**导出 `HTPASSWD_FILE`**(`crm.lume` 的
  `env("HTPASSWD_FILE")` 靠它取路径——此前"不挡 /api/*"的结论是误诊,真因是
  entrypoint 忘了 export,鉴权整个静默关闭)。反向代理层仍建议:TLS 必须,
  Basic Auth 可作纵深防御(`deploy/nginx-lume-crm.conf` 模板保留)。
- **哈希格式平台差异(本地调试必读)**:`$5$/$6$` 走系统 libcrypt——Linux 容器
  (glibc)正常;**macOS libcrypt 只有 DES**,`$6$` 条目在 mac 本地永远拒绝
  (lume 启动时会打警告)。macOS 本地测试请用 bcrypt:`htpasswd -bnB user pass`
  (lume 自带可移植 bcrypt 校验器,全平台一致)。
- **`.env` 配置机制(易踩坑,说清)**:镜像**不含** `.env`
  (`.dockerignore` 排除,Dockerfile 只 `COPY .env.example`),所以 lume 的
  `fopen(".env")` 在容器内找不到文件直接返回,**本地网关 key 不会泄漏进容器**。
  但 lume 框架**内置 `.env` 自动加载器**(`agent-httpd/src/agent/llm.c:287`):启动
  时会 `fopen(".env")` 打开 CWD 的 `.env`(容器 CWD=`/app`),把 `KEY=VALUE` 以
  `setenv(s,val,0)` 注入进程环境——**`override=0`,即不覆盖已存在的进程 env**。
  因此容器内配置优先级为:

  | 配置方式 | 是否生效 | 优先级 |
  |---|---|---|
  | `docker run -e LLM_API_URL=... -e LLM_API_KEY=...` | ✅ 直接进进程 env | **最高**(`.env` 不覆盖) |
  | compose `environment:` | ✅ | 最高 |
  | 挂载文件 `-v ./prod.env:/app/.env`(或 compose `volumes:`) | ✅ lume 自动 `fopen` 加载 | 低于 `-e` |
  | 啥都不传 | ❌ 全靠框架默认 | 聊天=离线演示 |

  - `.env.example` 是**惰性**的:lume 只认字面 `".env"`,不认 `.env.example`,镜像里无害。
  - `LUME_BIND` / `LUME_AUTH_PASSWORD` 同样走 `-e` 或挂载的 `/app/.env`。
  - 想让容器内聊天走真实 LLM:二选一即可——`docker run -e LLM_API_URL=...`
    (优先级更高),或挂一份生产 `.env` 到 `/app/.env`(lume 自己加载)。

## 布局

```
crm.lume          入口:server{} + HTTP 路由 + body 解析糖 + import 领域库
src/db.lume       领域层:SQLite 数据层(建库/种子 + 读写助手 + crm_* 工具)
src/api.ts        前端共享 API 层(types + fetch 封装)
src/crm/app.tsx   SPA shell:history 路由(pushState) + 统一 Nav + 挂载四个视图
src/crm/*.tsx     视图组件(dashboard/customers/chat/examples,均 export,不自行挂载)
www/app.css       手写共享样式(静态源,不走构建)
www/index.html    SPA 壳(spa=true 的回退目标,加载 /app.js)
www/app.js   esbuild 产物(单入口 bundle,已入库;改 src/crm 后须 make ui 重建并一并提交)
.data/crm.db      SQLite 数据(首次运行自动建表 + 注入种子数据;种子为虚构演示数据)
```

## API

| 端点 | 说明 |
|---|---|
| `GET /api/stats` | 仪表盘:客户数 / 商机数 / 开放管道 / 成交率(won/lost/won_amount/win_rate) / 按 stage 汇总 / 客户总表 |
| `GET /api/customers[?q=]` | 客户列表(q 按姓名/公司/邮箱模糊筛,参数化 `LIKE`;`?sort=pipeline` 按管道金额降序) |
| `GET /api/customer?id=N` | 客户全档(基础信息 + 名下商机[含 updated_fmt] + 跟进倒序[最新在前,含系统留痕]) |
| `GET /api/meta` | 业务字典:阶段白名单 / 终态阶段 / 默认阶段 / 跟进类型建议集(前端选项单一事实源) |
| `POST /api/customers` | 新建客户 `{name, company?, email?, phone?}` |
| `POST /api/deals` | 挂商机 `{customer_id, title, stage?, amount?}`(stage 非空必须命中白名单,否则 400;金额不能为负) |
| `POST /api/deals/update` | 推进管道 `{deal_id, stage?, amount?, title?}`(空/零值字段=不改;推进到终态自动记一条系统跟进) |
| `POST /api/activities` | 记跟进 `{customer_id, kind?, note}` |
| `POST /api/customers/update` | 改客户资料 `{customer_id, name?, company?, email?, phone?}`(空串字段=不改) |
| `POST /api/customers/delete` | 删客户 + 级联清其名下商机/跟进 `{customer_id}`(级联三步逐步校验,不可撤销) |
| `POST /api/deals/delete` | 删一条商机 `{deal_id}`(误挂/重复录入的清理) |
| `POST /api/activities/delete` | 删一条跟进 `{activity_id}`(系统自动留痕不建议删,服务端不禁止) |
| `POST /react/api/chat` | Agent SSE(框架原生,`crm_*` 工具已注册) |

## Agent 工具(聊天页可用)

`crm_search_customers` / `crm_get_customer` / `crm_add_customer` /
`crm_update_customer` / `crm_delete_customer`(级联) /
`crm_add_deal` / `crm_update_deal`(推进管道) / `crm_add_activity` /
`crm_delete_deal` / `crm_delete_activity` —— 共 10 个 typed
schema 自动生成,缺键零值兜底(空串/零值字段 = 不改该字段)。
`crm_delete_customer` 会级联清掉该客户名下全部商机/跟进,聊天里慎用。
`.env` 里 `LLM_API_KEY` 留空 = 离线演示引擎;填了才走真实模型。

## 安全边界(照抄 invest 的纪律)

- 服务只绑 `127.0.0.1`;写路径全部持 flock(SQLite C 侧未设 busy_timeout,
  worker 并发写靠应用层串行),`sql_write` 走护栏(单语句、禁 DROP/ALTER/PRAGMA)
- 服务端无鉴权,数据在 `.data/crm.db`——不要把端口暴露给不信任网络
- 值一律 `?` 占位符绑定(参数不进 SQL 文本,杜绝注入);搜索用参数化 `LIKE`

## 数据层设计(为什么要这么写)

- **读免锁**:`sql_query` 物理只读(`SQLITE_OPEN_READONLY`),GET 路径不碰 flock
- **新 id 用 `MAX(id)+1`**:`last_insert_rowid()` 跨连接不可靠(每次 exec 开
  新连接),持锁期间 `MAX` 安全;插入显式带 `id`,AUTOINCREMENT 兜底
- **首跑建库**:`sql_write` 的 open 不带 `CREATE` 标志,库文件不存在打不开 →
  缺失时先 `write_file(db, "")` 造 0 字节空库(只在确实缺失时,原子写会覆盖
  不能每次跑),再 `CREATE TABLE IF NOT EXISTS`
- **写失败可捕获**:`sql_write` 失败置 sticky VM error + 返回 null → 写路径用
  `try(() => sql_write(...))` 包,固定 `{ok,err}` 键
- **聚合下沉 SQL**:客户总表 / 管道统计一条 `SELECT` + 子查询 + `GROUP BY`
  出全,应用层不写循环聚合
- **本地时区**:`strftime` 是 SQL 侧 UTC,本地时间戳用 Lume 内建 `strftime`
  (localtime) 在 DSL 侧补,旧数据兼容
- **业务字典单一事实源**:`deal_stages`(白名单)/ `closed_stages`(终态)/
  `default_stage` 是阶段语义的唯一来源:服务端 `stage_valid` 强制校验、
  `update_deal` 自动留痕、`stats_payload` 开放管道统计、`/api/meta` 下发前端
  选项,全从同一组常量生成——新增/改阶段只动一处,不在各处硬编码阶段名
- **审计留痕**:推进到终态且阶段变化 → 同锁内自动记一条 `kind=系统` 的
  跟进(前端渲染为禁删的「系统」标签,服务端不禁止手删,保持通用);
  级联删除(商机/跟进/客户)逐步校验,任一步失败即 500,不静默吞错
- **展示数据服务端补全**:客户全档里商机带 `updated_fmt`、跟进按 `at DESC`
  倒序(最新在前),前端不再二次排序/换算,减少一份时区与排序逻辑
