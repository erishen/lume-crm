# Lume CRM — 一键构建与运行(release 版 Lume)
#
#   make          类型检查 + 构建前端 + 起服务(阻塞,Ctrl-C 停) → :8089
#   make dev      同 make(别名,与 lume 主仓 make dev 习惯对齐)
#   make ui       只构建前端(esbuild → www/app.js 单入口 bundle)
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
# 二进制落在 ~/.local/bin/lume;CRM 用到的 DSL 特性需 lume >= v0.5.1,建议固定
# 版本安装:LUME_VERSION=v0.5.1 sh install.sh。可用 LUME 环境变量覆盖。
#
# 前端 esbuild:优先 ./node_modules/.bin/esbuild(CRM 本地 npm install 后),
# 其次 PATH 上的 esbuild,最后兜底 ../lume/frontend/node_modules(过渡用)。

# 运行时二进制 + lume-core 库都来自仓内 vendor/lume-core/(可复现、单独 clone 直接可跑),
# 不再依赖兄弟 checkout 的 ../lume 或 ../lume-core。make bootstrap 可刷新到 pinned 版本。
LUME      ?= vendor/lume/bin/lume
PORT      ?= 8089
DOCKER    ?= /usr/local/bin/docker
IMAGE     ?= lume-crm:latest
CNAME     ?= lume-crm
# docker 宿主侧发布端口(>10000, 避开其它 docker 环境; 且避开 Chrome 受限端口
# 如 10080/6000/6665-6669 等, 否则浏览器 ERR_UNSAFE_PORT 打不开)
DOCKER_PORT ?= 11080

PYTHON ?= python3

default: crm

# ── vendor: 让项目自带解释器 + lume-core 库, 不再依赖兄弟 checkout ──
# 已在场且能 check 就跳过, 缺失/不匹配才重新拉。bin/ 不入库、lib/ 入库。
vendor:
	@bash scripts/vendor_lume.sh --check >/dev/null 2>&1 \
		|| bash scripts/vendor_lume.sh

# 强制刷新(本地 checkout 改了、或想钉到另一个 pinned release 时用):
bootstrap:
	@bash scripts/vendor_lume.sh

# ------------------------------------------------ check: Lume DSL 类型检查
check: vendor
	@$(LUME) --check crm.lume

# 数据一致性: 确认 API / peer / 宿主文件读的是同一份库。
#
# 为什么做成常驻目标而不是一次性修复: 这个问题出现过两次 —— 主服务与 peer
# 各挂不同的位置, 于是"API 看到 8 个客户、peer 看到 6 个", 而 UI 上只表现为
# 数字对不上一点点, 没人会往挂载上想。自动化检查比再写一遍注释可靠。
consistency:
	@"$(PYTHON)" scripts/check_data_consistency.py

# ------------------------------------------------ ui: esbuild 构建前端产物
# 入口 bundle 落 www/app.js(单入口,当前无共享 chunk;若日后拆多入口,
# --splitting 才会产出 www/chunk-*.js)。
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
	@# lume-core/lib 不再从 ../lume-core 复制: Dockerfile 按 LUME_CORE_VERSION
	@# 从 release 下载。复制出来的副本没有版本标记, 会静默停在旧版 ——
	@# 曾经因此报 "module 'peer' has no export 'config_warnings'",
	@# 而报错指向调用点, 指向不到那份旧文件。
	@$(DOCKER) build -t $(IMAGE) .

# ------------------------------------------------ docker-run: 前台起容器(Ctrl-C 停)
# 容器内 bind 0.0.0.0(由 LUME_BIND 控制), 宿主端口映射 $(DOCKER_PORT):8089。
docker-run:
	@$(DOCKER) run --rm --name $(CNAME) -p $(DOCKER_PORT):8089 -e LUME_BIND=0.0.0.0 $(IMAGE)

# ------------------------------------------------ docker-up / down: compose 编排
docker-up:
	@$(DOCKER) compose up -d

# ---- 跨应用共享网络(lume-peer-net) ----
#
# peer 容器不发布宿主端口(compose 里是 expose), 靠这张网按别名被看板等
# 应用访问(crm-peer:18102)。
#
# external 而不是让本 compose 定义: 三个应用各自独立部署, 谁先起都不该
# 决定这张网的生命周期。代价是它可能不存在, 所以 peer 目标先过这个检查。
PEER_NET ?= lume-peer-net

check-peer-net:
	@if $(DOCKER) network inspect $(PEER_NET) >/dev/null 2>&1; then :; \
	 else \
	  echo "▶ 创建共享网络 $(PEER_NET)"; \
	  $(DOCKER) network create $(PEER_NET) >/dev/null; \
	 fi

peer-net-rm:
	@$(DOCKER) network rm $(PEER_NET) 2>/dev/null && echo "  已删除 $(PEER_NET)" \
	  || echo "  $(PEER_NET) 不存在或仍被容器占用"

docker-down:
	@# --profile peer 显式带上: compose down 只停"当前 profile 里"的服务,
	@# 而一旦把 .env 里的 COMPOSE_PROFILES 注释掉, peer 就不在集合里了 ——
	@# 那个容器会一直留着(实测), 成为"以为停了其实还在跑"的幽灵。
	@$(DOCKER) compose --profile peer down 2>/dev/null || $(DOCKER) compose down

# ------------------------------------------------ peer: 局域网互通节点
# peer 面是独立容器, 是否启用由 **.env 里的 COMPOSE_PROFILES** 决定:
#   COMPOSE_PROFILES=peer   → docker-up / docker-peer-up 都会带上它
#   没有这一行               → 只起主服务
#
# 所以这里不再硬编码 --profile: 命令行给的 profile 会和 .env 的叠加,
# 那样即使 .env 里关掉了, 敲一次 docker-peer-up 也会把它起起来 ——
# 开关就形同虚设了。
docker-peer-up: check-peer-net
	@if ! grep -qE '^COMPOSE_PROFILES=.*peer' .env 2>/dev/null; then \
	  echo "✗ .env 里没有 COMPOSE_PROFILES=peer —— peer 节点未启用"; \
	  echo "  要启用: 在 .env 加一行 COMPOSE_PROFILES=peer"; \
	  echo "  (并确保 PEER_SHARED / PEER_ROOT 已配, 否则对端会拒)"; \
	  exit 1; fi
	@$(DOCKER) compose up -d peer

# 自注册: 写 .data/peers.d/crm.json, 让其它节点能认出本节点。
# 默认目录是 lume-lan/.data/peers.d(所有节点共用一处); 换位置设 PEER_REG_DIR。
PEER_REG_SHARED ?= ../lume-lan/.data/peers.d
peer-register:
	@mkdir -p $(PEER_REG_SHARED)
	@printf '%s\n' '{"node":"crm","port":18102,"registered_at":'$$(date +%s)'}' \
	  > $(PEER_REG_SHARED)/crm.json
	@echo "  已自注册 crm → $(PEER_REG_SHARED)/crm.json"

peer-registry:
	@ls -1 $(PEER_REG_SHARED) 2>/dev/null | sed 's/\.json$$//' | sed 's/^/  /' || echo "  (空)"

docker-peer-down:
	@$(DOCKER) compose stop peer 2>/dev/null || true
	@$(DOCKER) compose rm -f peer 2>/dev/null || true

docker-peer-logs:
	@$(DOCKER) logs -f lume-crm-peer

# ------------------------------------------------ docker-logs: 跟随容器日志
docker-logs:
	@$(DOCKER) logs -f $(CNAME)

.PHONY: peer-serve peer-up peer-register peer-registry peer-down peer-status peer-check  default dev check ui watch crm crm-dev clean \
        docker-build docker-run docker-up docker-down docker-logs

# peer-node-targets
# ---- 本应用的 peer 节点(供其它 lume 应用发现与查询) ----
#
# 谁负责起: **本应用自己**。看板(lume-lan)只负责"探"和"展示", 不该替别的
# 应用管进程生命周期 —— 那会造成版本/配置永久漂移: 改了 peer_node.lume
# 或换了端口, 看板那边不知道, 也不会重启它。
#
# 端口约定(改这里要同时改 lume-lan/.env 的 PEER_TARGETS):
#   lume-blog    → 18321
#   lume-crm     → 18102
#   lume-scanner → 18103
PEER_PORT_RUN ?= 18102
# 绑定地址。默认 127.0.0.1(单机安全基线: 只有本机能连)。
#
# 跨机时必须设 0.0.0.0 —— 但那个决定不该藏在 Makefile 里: 之前这里是硬编码
# 127.0.0.1, 于是 .env 里写 PEER_BIND=0.0.0.0 完全不生效, 而文档却说"配
# PEER_BIND 即可"。这种"配了不生效"比"不支持"更难排查(实测另一台机器
# 连过来只得到连接被拒, 看起来像网络问题)。
#
# 现在: .env 的 PEER_BIND 优先, 没写才用 127.0.0.1。
PEER_BIND_RUN ?= $(shell grep -E '^PEER_BIND=' .env 2>/dev/null | cut -d= -f2- | sed 's/^$$/127.0.0.1/')
PEER_BIND_RUN := $(if $(PEER_BIND_RUN),$(PEER_BIND_RUN),127.0.0.1)
PEER_NAME_RUN ?= crm
PEER_SHARED_RUN ?= $(shell grep -E '^PEER_SHARED=' .env 2>/dev/null | cut -d= -f2-)
PEER_ROOT_RUN ?= $(shell grep -E '^PEER_ROOT=' .env 2>/dev/null | cut -d= -f2-)
PEER_BIN ?= ../lume/bin/lume
SITE_NAME ?= lume-crm

# 前台起(调试时看得见日志)。Ctrl-C 停。
peer-serve:
	@if [ ! -x "$(PEER_BIN)" ]; then \
	  echo "✗ 找不到 $(PEER_BIN) —— 先 cd ../lume && make" >&2; exit 1; fi
	@if [ -z "$(PEER_SHARED_RUN)$(PEER_ROOT_RUN)" ]; then \
	  echo "✗ .env 里 PEER_SHARED / PEER_ROOT 都是空的 —— 对端会拒绝所有请求" >&2; exit 1; fi
	@echo "▶ $(PEER_NAME_RUN) peer :$(PEER_PORT_RUN)"
	@PEER_NAME=$(PEER_NAME_RUN) PEER_PORT=$(PEER_PORT_RUN) PEER_BIND=$(PEER_BIND_RUN) \
	  PEER_SHARED="$(PEER_SHARED_RUN)" PEER_ROOT="$(PEER_ROOT_RUN)" \
	  PEER_SITE_NAME=$(SITE_NAME) \
	  $(PEER_BIN) peer_node.lume

# 后台常驻。日志落 .runtime-peer.log。
# 起本节点的 peer。顺带把自己的名字写进共享自注册目录 ——
# 别的节点靠扫那个目录认人, 所以"多了一个应用"不需要改它们的白名单。
peer-up: peer-register
	@if [ -x "$(PEER_BIN)" ]; then :; else \
	  echo "✗ 找不到 $(PEER_BIN) —— 先 cd ../lume && make" >&2; exit 1; fi
	@if lsof -nP -iTCP:$(PEER_PORT_RUN) -sTCP:LISTEN >/dev/null 2>&1; then \
	  echo "  $(PEER_NAME_RUN) :$(PEER_PORT_RUN) 已在监听"; \
	 else \
	  PEER_NAME=$(PEER_NAME_RUN) PEER_PORT=$(PEER_PORT_RUN) PEER_BIND=$(PEER_BIND_RUN) \
	  PEER_SHARED="$(PEER_SHARED_RUN)" PEER_ROOT="$(PEER_ROOT_RUN)" \
	  PEER_SITE_NAME=$(SITE_NAME) \
	  PEER_REG_DIR=$(PEER_REG_SHARED) \
	    nohup $(PEER_BIN) peer_node.lume < /dev/null > .runtime-peer.log 2>&1 & \
	  echo $! > .runtime-peer.pid; \
	  sleep 1; \
	  echo "  已启动 $(PEER_NAME_RUN) :$(PEER_PORT_RUN) → .runtime-peer.log"; fi

peer-down:
	@if [ -f .runtime-peer.pid ]; then \
	  kill $$(cat .runtime-peer.pid) 2>/dev/null && echo "  已停 $(PEER_NAME_RUN)" || true; \
	  rm -f .runtime-peer.pid; \
	 else echo "  $(PEER_NAME_RUN) 未在运行(或不是本仓库起的)"; fi

peer-status:
	@n=$$(lsof -nP -iTCP:$(PEER_PORT_RUN) -sTCP:LISTEN 2>/dev/null | wc -l | tr -d ' '); \
	 if [ "$$n" -gt 0 ]; then echo "  $(PEER_NAME_RUN) :$(PEER_PORT_RUN) 在监听"; \
	 else echo "  $(PEER_NAME_RUN) :$(PEER_PORT_RUN) 未运行"; fi

# 语法检查(用仓库里的 lume, 不用 ~/.local/bin 的旧版)
peer-check:
	@$(PEER_BIN) --check peer_node.lume
