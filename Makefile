# Lume CRM — 一键构建与运行(release 版 Lume)
#
#   make          类型检查 + 构建前端 + 起服务(阻塞,Ctrl-C 停) → :8089
#   make dev      同 make(别名,与 lume 主仓 make dev 习惯对齐)
#   make ui       只构建前端(esbuild → www/app.js + 共享 chunk)
#   make check    只跑 Lume 类型检查(crm.lume + src/db.lume)
#   make watch    前端 esbuild --watch(另开终端跑 make 或 lume)
#   make crm-dev  check + 起服务 + 前端 watch 联动(Ctrl-C 全停)
#   make clean    清构建产物与运行数据
#
#   make docker-build  构建镜像 lume-crm:latest(顺手清 buildx 活动目录避坑)
#   make docker-run    起容器(前台,Ctrl-C 停)→ 映射 :8089, bind 0.0.0.0
#   make docker-up     docker compose up -d
#   make docker-down   docker compose down
#   make docker-logs   docker logs -f lume-crm
#
# Lume:用 release 版本(不再依赖源码树 ../lume)。安装:
#   curl -sSfL https://raw.githubusercontent.com/erishen/lume/main/install.sh | sh
# 二进制落在 ~/.local/bin/lume;CRM 用到的 DSL 特性需 lume >= v0.5.0,建议固定
# 版本安装:LUME_VERSION=v0.5.0 sh install.sh。可用 LUME 环境变量覆盖。
#
# 前端 esbuild:优先 ./node_modules/.bin/esbuild(CRM 本地 npm install 后),
# 其次 PATH 上的 esbuild,最后兜底 ../lume/frontend/node_modules(过渡用)。

LUME      ?= $(HOME)/.local/bin/lume
PORT      ?= 8089
DOCKER    ?= /usr/local/bin/docker
IMAGE     ?= lume-crm:latest
CNAME     ?= lume-crm
# docker 宿主侧发布端口(>10000, 避开其它 docker 环境; 且避开 Chrome 受限端口
# 如 10080/6000/6665-6669 等, 否则浏览器 ERR_UNSAFE_PORT 打不开)
DOCKER_PORT ?= 11080

default: crm

# ------------------------------------------------ check: Lume DSL 类型检查
check:
	@$(LUME) --check crm.lume

# ------------------------------------------------ ui: esbuild 构建前端产物
# 共享 React chunk 落 docroot 根(www/chunk-*.js),入口 bundle 落 www/app.js。
# 实际构建交给 build.sh(集中处理 esbuild 解析与 watch 参数)。
ui:
	@sh build.sh

watch:
	@sh build.sh watch

# ------------------------------------------------ dev: 默认目标的别名(与 lume 主仓 make dev 习惯对齐)
dev: crm

# ------------------------------------------------ crm: 检查 + 构建 + 起服务
# 起服务前清掉 8089 上的旧实例(与 lume Makefile KILL_SERVER 同款思路,简版)。
crm: check ui
	@{ lsof -ti tcp:$(PORT) 2>/dev/null; pgrep -f "crm\.lume" 2>/dev/null; } \
	  | sort -u | xargs kill -9 2>/dev/null || true; \
	 sleep 0.3; \
	 echo "==> Lume CRM on http://127.0.0.1:$(PORT) (/  /customers  /chat, Ctrl-C 停)"; \
	 $(LUME) crm.lume

# check + 前端 watch + 起服务:改 .tsx 即刷新页面,改 .lume 重启生效。
crm-dev: check
	@{ sh build.sh watch \
	      & EB_PID=$$!; \
	  { lsof -ti tcp:$(PORT) 2>/dev/null; pgrep -f "crm\.lume" 2>/dev/null; } \
	    | sort -u | xargs kill -9 2>/dev/null || true; \
	  sleep 0.3; \
	  echo "==> Lume CRM on http://127.0.0.1:$(PORT)(前端热更新,Ctrl-C 全停)"; \
	  trap "kill $$EB_PID 2>/dev/null" INT TERM; \
	  $(LUME) crm.lume; }

# ------------------------------------------------ clean
clean:
	rm -rf www/chunk-*.js www/app.js .data logs .data-lume.log

# ------------------------------------------------ docker-build: 构建镜像
# OrbStack 下 docker build 偶发 buildx 活动目录权限错, 先清掉再 build。
docker-build:
	@rm -rf $(HOME)/.docker/buildx/activity 2>/dev/null || true
	@$(DOCKER) build -t $(IMAGE) .

# ------------------------------------------------ docker-run: 前台起容器(Ctrl-C 停)
# 容器内 bind 0.0.0.0(由 LUME_BIND 控制), 宿主端口映射 $(DOCKER_PORT):8089。
docker-run:
	@$(DOCKER) run --rm --name $(CNAME) -p $(DOCKER_PORT):8089 -e LUME_BIND=0.0.0.0 $(IMAGE)

# ------------------------------------------------ docker-up / down: compose 编排
docker-up:
	@$(DOCKER) compose up -d

docker-down:
	@$(DOCKER) compose down

# ------------------------------------------------ docker-logs: 跟随容器日志
docker-logs:
	@$(DOCKER) logs -f $(CNAME)

.PHONY: default dev check ui watch crm crm-dev clean \
        docker-build docker-run docker-up docker-down docker-logs
