#!/bin/sh
# 一键运行:类型检查 + 构建前端(若缺)+ 起 Lume 服务。
# Lume 用 release 版本(默认 ~/.local/bin/lume;可用 LUME 环境变量覆盖)。
# docroot 相对 CWD,所以必须在本目录跑。
set -e
cd "$(dirname "$0")"

LUME="${LUME:-$HOME/.local/bin/lume}"
command -v "$LUME" >/dev/null 2>&1 || {
  echo "先安装 Lume release:curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh | sh"; exit 1;
}

PORT=${PORT:-8089}

# 前端产物缺了就构建(SPA 单入口 www/app.js)
if [ ! -f www/app.js ]; then
  echo "==> 前端未构建,先 build"; sh build.sh
fi

# 清掉占用端口的旧进程(与 lume KILL_SERVER 同思路,简版)
{ lsof -ti tcp:"$PORT" 2>/dev/null; pgrep -f "$LUME.*crm.lume" 2>/dev/null; } \
  | sort -nu | xargs kill -9 2>/dev/null || true
sleep 0.3

echo "==> Lume CRM on http://127.0.0.1:$PORT (bind 127.0.0.1)"
echo "    / 仪表盘 · /customers 客户 · /chat Agent(Ctrl-C 停)"
exec "$LUME" crm.lume
