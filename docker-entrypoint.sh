#!/bin/sh
# 容器启动入口: 若设了 LUME_AUTH_PASSWORD, 现场生成 htpasswd($6$ SHA-512 crypt,
# 与 lume load_htpasswd 强哈希要求一致), **并 export HTPASSWD_FILE** —— server{}
# 的 env("HTPASSWD_FILE") 靠这个 OS env 取到文件路径; 不 export 则 DSL 侧拿到
# null → 认证整个关闭(踩过的坑: 生成文件但没导出, 鉴权静默失效)。
#
# 框架只认 $5$/$6$/bcrypt 强哈希; 明文与弱哈希($1$/$apr1$/DES)加载即失败退出,
# 不会退化成"放行所有"。$6$ 在 Linux 容器(glibc crypt)下校验正常; bcrypt
# ($2y$)走 lume 自带可移植实现, macOS 本地调试 htpasswd 时用 bcrypt 更稳
# (macOS libcrypt 只有 DES, 验不了 $6$ —— lume 启动时会打警告)。
set -eu

if [ -n "${LUME_AUTH_PASSWORD:-}" ]; then
    user="${LUME_AUTH_USER:-admin}"
    mkdir -p /app/auth
    salt="$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 8)"
    hash="$(openssl passwd -6 -salt "$salt" "$LUME_AUTH_PASSWORD")"
    printf '%s:%s\n' "$user" "$hash" > /app/auth/htpasswd
    chmod 600 /app/auth/htpasswd
    # 只在用户没自带 HTPASSWD_FILE 时导出生成物(显式配置优先)
    export HTPASSWD_FILE="${HTPASSWD_FILE:-/app/auth/htpasswd}"
fi

# 只读演示模式: Agent 工具白名单收敛。注意 HARNESS_TOOLS_ALLOW 同时过滤
# 原生内建(read_file/fetch_url/skill-run…)与 DSL tool —— 白名单必须带上
# 只读模式下仍注册的 2 个查询工具, 否则聊天一个工具都没有。
# 效果: 聊天 Agent 无读文件/外联 URL 能力, 注入也拿不到数据外带通道。
if [ "${LUME_CRM_READONLY:-0}" = "1" ]; then
    export HARNESS_TOOLS_ALLOW="crm_search_customers,crm_get_customer,calc,get_time"
fi

exec "$@"
