#!/bin/sh
# 容器启动入口: 若设了 LUME_AUTH_PASSWORD, 现场生成 htpasswd(bcrypt, 与
# lume load_htpasswd 强哈希要求一致), 再 exec 主程序。无密码=不生成文件
# → server{} 的 env("HTPASSWD_FILE") 取到 null → 认证关闭(本地/离线演示)。
#
# 框架只认 $5$/$6$/bcrypt 强哈希; 明文与弱哈希($1$/$apr1$/DES)加载即失败退出,
# 不会退化成"放行所有"。用 openssl passwd -6 生成 $6$ SHA-512 crypt(与 lume
# 官方 entrypoint 的 busybox cryptpw -m sha512 同格式, 校验最稳); 密码来自
# ENV, 不落命令行。
set -eu

if [ -n "${LUME_AUTH_PASSWORD:-}" ]; then
    user="${LUME_AUTH_USER:-admin}"
    mkdir -p /app/auth
    salt="$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 8)"
    hash="$(openssl passwd -6 -salt "$salt" "$LUME_AUTH_PASSWORD")"
    printf '%s:%s\n' "$user" "$hash" > /app/auth/htpasswd
    chmod 600 /app/auth/htpasswd
fi

exec "$@"
