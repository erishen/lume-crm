#!/bin/sh
# check.sh — lume-crm.erishen.cn 暴露面快速体检
#
# 用法(在 VPS 或本机):
#   sh check.sh [BASE_URL]
#   缺省 BASE_URL=https://lume-crm.erishen.cn
#
# 检查项(全部无认证探测, 不会修改任何数据):
#   1. 401 门是否生效(无 Basic Auth 应全 401, 429/431 除外)
#   2. 安全响应头是否齐全(CSP / HSTS / XFO / nosniff / Referrer)
#   3. 限流是否生效(并发 30 个, 应出现 429)
#   4. 分享页枚举防护(无 token 探测多个 id, 应无 200)
#   5. 常见探针路径(/wp-login /xmlrpc /admin /debug)是否 404/401 而非 200
#   6. PIN/token 是否已从 access log(URL/Referer)打码(人工复查)
#
# 依赖: curl; 可选 jq。无写操作, 可放心对生产跑。

set -u
BASE="${1:-https://lume-crm.erishen.cn}"
BASE="${BASE%/}"
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m⚠\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✘\033[0m %s\n' "$1"; }

echo "=== lume-crm 暴露面体检: $BASE ==="

# ---- 1. 认证门 ----
code=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/")
echo "1) 无认证访问首页"
case "$code" in
  401) ok "401 (Basic Auth 生效)" ;;
  429|431) warn "$code (限流/头过大, 不是认证门失败; 稍后重试)" ;;
  *) fail "$code (期望 401 —— 认证门可能没配上!)" ;;
esac

# ---- 2. 安全响应头(带无效凭据拿 401 响应里的头)----
echo "2) 安全响应头"
hdrs=$(curl -s --max-time 10 -o /dev/null -D - -u x:x "$BASE/")
for h in "Strict-Transport-Security" "Content-Security-Policy" "X-Content-Type-Options" "X-Frame-Options" "Referrer-Policy" "Permissions-Policy"; do
  if printf '%s' "$hdrs" | grep -qi "^$h:"; then ok "$h"; else fail "缺 $h"; fi
done

# ---- 3. 全局限流 ----
echo "3) 限流(30 并发, 应见 429)"
codes=$(for i in $(seq 1 30); do curl -s --max-time 10 -o /dev/null -w '%{http_code} ' "$BASE/" & done; wait)
if printf '%s' "$codes" | tr ' ' '\n' | grep -q '^429$'; then ok "触发 429 限流"; else warn "30 并发未触发 429 —— crm429 zone 可能没被 include"; fi

# 等上一步的 crm429 队列排空,否则下面的 404 会被误判成 429。
sleep 5

# ---- 4. 分享页枚举防护 ----
echo "4) /share/customer 无 token 枚举(应 404/401, 绝不 200)"
sbad=0; schecked=0; slimit=0; sother=0
# crm-share 是 10r/m + burst 5;探测 4 个 id 留余量,避免自己触发 429。
for i in $(seq 1 4); do
  c=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/share/customer?id=$i")
  case "$c" in
    200) sbad=1 ;;
    401|404) schecked=$((schecked + 1)) ;;
    429) slimit=1 ;;
    *) sother=1 ;;
  esac
done
if [ "$sbad" = "1" ]; then
  fail "存在 200 —— share token 校验未生效(可枚举!)"
elif [ "$schecked" -eq 0 ]; then
  fail "全部被限流/异常, 未能验证 token; 等 60s 重跑"
elif [ "$sother" = "1" ]; then
  warn "出现 5xx/000 等异常状态, 结果不完整; 请人工复查"
elif [ "$slimit" = "1" ]; then
  warn "部分请求被 crm-share 限流(429), 已验证的 id 均非 200; 可等 60s 复跑"
else
  ok "全部 404/401 (token 生效)"
fi

# ---- 5. 探针路径 ----
echo "5) 探针路径(应 401/404, 绝不 200)"
for p in wp-login.xml xmlrpc.php admin login debug .env .data/crm.db; do
  c=$(curl -s --max-time 10 -o /dev/null -w '%{http_code}' "$BASE/$p")
  case "$c" in
    401|404|403) ok "/$p -> $c" ;;
    200) fail "/$p -> 200 (有内容裸露!)" ;;
    *) warn "/$p -> $c" ;;
  esac
done

# ---- 6. 提示 ----
echo "6) 人工复查项(脚本无法代替):"
echo "   - access log 的 URL/Referer 是否无明文 pin/token(应无输出):"
echo "     grep -E '(pin|token)=[^*&]' /var/log/nginx/lume-crm.access.log | tail"
echo "   - htpasswd 密码强度: 应 >=20 位随机, 且全站不复用"
echo "   - VPS 端口 8089(本地联调 11080)是否只绑 127.0.0.1: ss -lntp | grep -E '8089|11080'"
echo "   - fail2ban 是否覆盖 401 爆破: fail2ban-client status nginx-auth (若有)"
echo ""
echo "=== 体检完成 ==="
