# syntax=docker/dockerfile:1
# ============================================================================
# lume-crm —— 单镜像 CRM 应用 (lume 静态单二进制 + 预编译前端 + 原生 SQLite)。
#
# 瘦身来源: lume v0.5.1 起提供 *-static 预编译二进制(install.sh 传 LUME_STATIC=1
#   拉取)。该二进制把 libsqlite3 + 全部 libc 烤进自身, **零运行时依赖**, 故基底
#   可换 alpine(而非 debian/ubuntu), 镜像从 120MB 砍到 ~10MB 级。SQLite 自带,
#   不需要 libsqlite3, 也不要求特定 glibc 版本。
#
# ⚠️ DNS 警告(仅影响聊天出域, CRM 核心不受影响):
#   lume 是 C 写的, 静态 glibc 二进制的 DNS 解析靠运行时 dlopen libnss_*.so,
#   alpine(musl) 不提供这些文件 → /react/api/chat 调外部 LLM 网关(如
#   host.docker.internal 这类主机名)会 "Temporary failure in name resolution"。
#   规避二选一:(a) 网关用数字 IP(如 http://172.17.0.1:<port>), 无需 DNS 解析;
#   (b) 把 FROM 换成 debian:bookworm-slim(自带 glibc NSS, DNS 正常, 但镜像回 ~80MB)。
#   CRM 核心(SQLite + SPA + REST API)完全本地、不解析域名, 不受此影响;
#   LLM_API_URL 留空(离线演示引擎)亦不受影响。
#
# 前端: www/ 是宿主 make ui 产出的纯静态单页, 直接 COPY, 容器里不重编。
# 鉴权: server{} 的 htpasswd = env("HTPASSWD_FILE"); 本地留空=无认证。公网部署
#   必须在反向代理层(nginx/caddy)做 Basic Auth + TLS —— lume 发布版只对内置路由
#   强制鉴权, 自定义 /api/* 不挡。容器内仍可用 LUME_AUTH_PASSWORD 生成 $6$ 哈希
#   作纵深防御。
# bind: 本地 127.0.0.1; 容器传 LUME_BIND=0.0.0.0 才能被 -p 端口映射命中。
# ============================================================================

# ---- 拉静态二进制(builder, 用完即弃) ----
FROM alpine:3.20 AS fetch
RUN apk add --no-cache ca-certificates curl tar
ARG LUME_VERSION=v0.5.1
RUN curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh \
    | LUME_VERSION=${LUME_VERSION} LUME_STATIC=1 LUME_PREFIX=/usr/local sh

# ---- 运行时(alpine, 极小) ----
FROM alpine:3.20
RUN apk add --no-cache ca-certificates openssl
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
