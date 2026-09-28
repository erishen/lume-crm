#!/bin/sh
# 构建前端:SPA 单入口 src/crm/app.tsx → www/app.js(esbuild 分包,共享
# chunk 落 docroot 根)。esbuild 解析顺序:本目录 ./node_modules/.bin/esbuild
# (推荐:npm install 后)→ PATH 上的 esbuild → 兜底 ../lume/frontend/node_modules。
# css 是手写静态源(www/app.css),壳是手写的 www/index.html。
#
# 用法: sh build.sh [watch]   (watch = esbuild --watch --serve=0)
set -e
cd "$(dirname "$0")"

WATCH=""
if [ "${1:-}" = "watch" ]; then
  WATCH="--watch --serve=0"
fi

ESBUILD=./node_modules/.bin/esbuild
[ -x "$ESBUILD" ] || ESBUILD=esbuild
command -v "$ESBUILD" >/dev/null 2>&1 || ESBUILD=../lume/frontend/node_modules/.bin/esbuild
[ -x "$ESBUILD" ] || {
  echo "需要 esbuild(前端构建):在本目录 npm install,或 npm i -g esbuild,或保留 ../lume 源码树"; exit 1;
}

echo "==> esbuild src/crm/app.tsx (SPA) -> www/app.js $WATCH"
"$ESBUILD" src/crm/app.tsx \
  --bundle --minify --format=esm --splitting --jsx=automatic \
  --outdir=www --outbase=src/crm $WATCH

echo "==> done: $(ls www/app.js www/chunk-*.js 2>/dev/null | tr '\n' ' ')"
