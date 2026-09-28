# syntax=docker/dockerfile:1
# ============================================================================
# lume-crm —— 单镜像 CRM 应用 (lume 单二进制 + 预编译前端 + 原生 SQLite)。
#
# 为什么不从源码重编 lume:
#   官方 install.sh 直接拉对应平台的预编译二进制(release 通道, 与本地开发
#   同一份 v0.5.0), 省掉 agent-httpd 静态链那套重活。发布版 lume 动态链
#   libsqlite3 —— 镜像里必须装 libsqlite3-0, 否则原生 SQLite
#   (sql_query/sql_write) 在容器里起不来。
#
# 基础镜像: 发布版二进制在 CI(ubuntu-latest)上编出, 要求 GLIBC_2.38;
#   debian:bookworm 只有 glibc 2.36 会启动即崩。debian:trixie-slim 提供
#   glibc 2.41(≥2.38 满足), 且基底比 ubuntu:24.04 瘦约一半, 故用它。
#
# 前端: www/ 是 esbuild 产出的纯静态单页(平台无关), 直接 COPY 宿主已构建的
#   www/(make ui 产出), 容器里不重编前端。
#
# 鉴权: server{} 的 htpasswd = env("HTPASSWD_FILE"); 本地留空=无认证。公网
#   部署必须在 compose/docker run 里注入 LUME_AUTH_PASSWORD(容器启动由
#   docker-entrypoint.sh 现场生成 /app/auth/htpasswd 的 bcrypt 强哈希)并设
#   HTPASSWD_FILE=/app/auth/htpasswd。无凭据=认证关闭 —— 切勿裸暴露公网。
#
# bind: 本地 127.0.0.1; 容器传 LUME_BIND=0.0.0.0 才能被 -p 端口映射命中。
# ============================================================================

FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl libsqlite3-0 openssl \
    && rm -rf /var/lib/apt/lists/*

# 官方安装器: 拉 Linux 预编译 lume 到 /usr/local/bin/lume(并带 www/examples/
# docs 到 /usr/local/share/lume, 本应用用不到但无害)。固定版本与本地一致。
RUN curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh \
    | LUME_VERSION=v0.5.0 LUME_PREFIX=/usr/local sh

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
