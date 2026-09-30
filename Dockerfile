# syntax=docker/dockerfile:1
# ============================================================================
# lume-crm —— 单镜像 CRM 应用 (lume 静态单二进制 + 预编译前端 + 原生 SQLite)。
#
# 瘦身来源: lume v0.5.1 起提供 *-static 预编译二进制(install.sh 传 LUME_STATIC=1
#   拉取)。该二进制把 libsqlite3 + 全部 libc 烤进自身, **零运行时依赖**, 故基底
#   可换 alpine(而非 debian/ubuntu), 镜像从 120MB 砍到 ~18MB 级(实测: alpine
#   基底 ~8.8MB + lume 静态二进制 ~3.8MB + curl/openssl 依赖)。SQLite 自带,
#   不需要 libsqlite3, 也不要求特定 glibc 版本。
#
# DNS 说明(实测厘清, 修正早期"alpine DNS 坑"的过虑):
#   lume 的 LLM 调用是 fork + execlp 系统里的 curl(agent-httpd/src/agent/agent.c),
#   DNS 由 alpine 自带 musl curl 解析(走 Docker 内嵌 DNS), host.docker.internal
#   等主机名正常可用 —— 同款部署(容器内调 host.docker.internal:<port>
#   的本机 LLM 网关)已实测跑通。lume 本体不解析域名; 只有当 lume 自身需要出域解析时
#   (静态 glibc 二进制缺 libnss_*.so)才需数字 IP 或 debian 基底。
#   curl 是真实 LLM 的硬依赖(alpine 基础镜像不带, 必须显式安装)。
#
# 前端: www/ 是宿主 make ui 产出的纯静态单页, 直接 COPY, 容器里不重编。
# 鉴权: server{} 的 htpasswd = env("HTPASSWD_FILE"); 本地留空=无认证。lume 的
#   Basic Auth 门是全局的——自定义 /api/* 与内置路由同一道前置门,无/错凭据一律
#   401(fail-closed)。entrypoint 设 LUME_AUTH_PASSWORD 会现场生成 $6$ htpasswd
#   并 export HTPASSWD_FILE;不 export 鉴权会静默关闭(踩过的坑,见 README)。
#   公网仍建议反向代理层(nginx/caddy) TLS 必配, Basic Auth 作纵深防御。
# bind: 本地 127.0.0.1; 容器传 LUME_BIND=0.0.0.0 才能被 -p 端口映射命中。
# ============================================================================

# ---- 拉静态二进制(builder, 用完即弃) ----
FROM alpine:3.20 AS fetch
RUN apk add --no-cache ca-certificates curl tar
ARG LUME_VERSION=v0.6.0
RUN curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh \
    | LUME_VERSION=${LUME_VERSION} LUME_STATIC=1 LUME_PREFIX=/usr/local sh

# ---- 运行时(alpine, 极小) ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates curl openssl
COPY --from=fetch /usr/local/bin/lume /usr/local/bin/lume

WORKDIR /app

# 应用源码 + 预构建前端。.env 不拷(含本地网关 key); 鉴权/LLM 等走 OS env。
COPY crm.lume ./
COPY src/ ./src/
COPY www/ ./www/
COPY .env.example ./.env.example
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# 运行时数据(首跑建库 + 种子, 由 src/db.lume 负责); 挂卷持久化。
RUN mkdir -p .data

EXPOSE 8089

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["/usr/local/bin/lume", "crm.lume"]
