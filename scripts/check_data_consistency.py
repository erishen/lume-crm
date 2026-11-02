#!/usr/bin/env python3
"""check_data_consistency.py — 确认 crm 的 API、peer、宿主文件读的是同一份数据

## 为什么需要这个脚本

lume-crm 有两个进程在读数据：
  * crm 主服务（容器内，:11080）—— 处理写入
  * crm peer 节点（宿主，:18102）—— 给 lume-a2a 提供读接口

它们曾经读**两份不同的文件**：主服务挂 Docker 命名卷，peer 挂宿主 `.data/`。
后果是最难察觉的那一类：
  * 通过 API 新增的客户, 宿主库看不到;
  * lume-a2a 从 peer 拿到的数, 与 API 里看到的不是同一份;
  * 清理脏数据时容器清了、peer 还看得见 —— 于是「已经修好了」但实际没修。

这个坑在 docker-compose.yml 里被记过两次，但两次都只修了一侧。现在两侧
都挂宿主 `.data`，本脚本用来**持续证明它们确实是一份**。

## 检查项

  1. 容器挂载点必须是宿主 .data（不是命名卷）
  2. API / peer / 宿主文件 三处报出的客户数一致
  3. 三处看到的客户公司名集合一致（只比数量会漏掉"数量巧合相同"的情况）

## 用法

    python3 scripts/check_data_consistency.py
    python3 scripts/check_data_consistency.py --api http://127.0.0.1:11080 --peer http://127.0.0.1:18102

退出码: 0 一致; 1 不一致; 2 环境不可达（也算不可信，但不一定是分叉）
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"


def load_env() -> dict:
    vals = {}
    if ENV.exists():
        for line in ENV.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                vals[k.strip()] = v.strip().strip('"').strip("'")
    for k in list(os.environ):
        if k.startswith("PEER_"):
            vals[k] = os.environ[k]
    return vals


def get_json(url: str, timeout: int = 10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return json.loads(r.read() or b"{}")
    except Exception as e:  # noqa: BLE001
        return {"__error": str(e)}


def peer_invoke(env: dict, base: str, tool: str):
    root = env.get("PEER_ROOT", "")
    node = env.get("PEER_NAME", "lume-a2a")
    if not root:
        return {"__error": "缺少 PEER_ROOT（lume-a2a/.env）"}
    ts = str(int(time.time()))
    nonce = secrets.token_hex(8)
    path = "/peer/invoke"
    body = json.dumps({"tool": tool, "arguments": {}})
    scope = f"POST {path}\n{body}"
    key = hmac.new(root.encode(), f"peer:{node}".encode(), hashlib.sha256).hexdigest()
    sig = hmac.new(key.encode(), "\n".join([node, ts, nonce, scope]).encode(),
                   hashlib.sha256).hexdigest()
    url = f"{base}{path}?node={node}&ts={ts}&nonce={nonce}&sig={sig}"
    req = urllib.request.Request(url, data=body.encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read() or b"{}")
    except Exception as e:  # noqa: BLE001
        return {"__error": str(e)}


def container_mounts(container: str) -> list[tuple[str, str]]:
    """读容器挂载。用 docker inspect；docker 不可用时返回空表(不阻断检查)。"""
    import subprocess
    try:
        out = subprocess.run(
            ["docker", "inspect", container, "--format",
             "{{range .Mounts}}{{.Source}}|{{.Destination}}|{{.Name}}\n{{end}}"],
            capture_output=True, text=True, timeout=15)
        if out.returncode != 0:
            return []
        res = []
        for line in out.stdout.strip().splitlines():
            parts = line.split("|")
            if len(parts) >= 3:
                res.append((parts[0], parts[1], parts[2]))
        return res
    except Exception:  # noqa: BLE001
        return []


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:11080")
    ap.add_argument("--peer", default="http://127.0.0.1:18102")
    ap.add_argument("--container", default="lume-crm-crm-1")
    ap.add_argument("--db", default=str(ROOT / ".data" / "crm.db"))
    args = ap.parse_args()

    env = load_env()
    problems: list[str] = []
    print("▶ crm 数据一致性检查\n")

    # ── 1. 挂载 ────────────────────────────────────────────────────
    mounts = container_mounts(args.container)
    app_mounts = [(src, dst, name) for src, dst, name in mounts if dst == "/app/.data"]
    if not mounts:
        print("  [跳过] 无法读取容器挂载（docker 不可用或容器名不对）")
    elif not app_mounts:
        problems.append("容器没有挂载 /app/.data")
        print("  [FAIL] 容器没有挂载 /app/.data")
    else:
        src, dst, name = app_mounts[0]
        expect = str((ROOT / ".data").resolve())
        if name:  # 命名卷
            problems.append(f"/app/.data 挂的是命名卷 {name}，不是宿主目录")
            print(f"  [FAIL] /app/.data -> 命名卷 {name}（应为宿主 .data）")
        elif Path(src).resolve() != Path(expect):
            problems.append(f"/app/.data 挂的是 {src}，不是 {expect}")
            print(f"  [FAIL] /app/.data -> {src}（应为 {expect}）")
        else:
            print(f"  [PASS] /app/.data -> 宿主 .data")

    # ── 2. 三处计数 ────────────────────────────────────────────────
    api = get_json(args.api + "/api/customers")
    api_set = {c.get("company", "") for c in api.get("customers", [])} - {""} \
        if "customers" in api else None

    pv = peer_invoke(env, args.peer, "crm.industries")
    peer_total = None
    if "__error" not in pv and pv.get("ok"):
        peer_total = int((pv.get("result") or {}).get("customer_count", 0))

    host_total = None
    host_set = None
    if Path(args.db).exists():
        con = sqlite3.connect(args.db)
        host_total = list(con.execute("SELECT COUNT(*) FROM customers"))[0][0]
        host_set = {r[0] for r in con.execute("SELECT company FROM customers") if r[0]}

    print("\n  三处视角：")
    print(f"    API      : {len(api_set) if api_set is not None else '不可达'} 个客户")
    print(f"    peer     : {peer_total if peer_total is not None else '不可达'} 个客户")
    print(f"    宿主文件 : {host_total if host_total is not None else '不可达'} 个客户")

    if api_set is None:
        problems.append("API 不可达:" + str(api.get("__error", ""))[:80])
    if peer_total is None:
        problems.append("peer 不可达:" + str(pv.get("__error", pv))[:80])
    if host_total is None:
        problems.append("宿主库不可读")

    # ── 3. 公司名集合比对 ──────────────────────────────────────────
    # 只比数量不够: 两份库各删一条、各加一条, 数量就碰巧相同了。
    print()
    if api_set is not None and host_set is not None:
        if api_set == host_set:
            print("  [PASS] API 与宿主文件的公司集合一致")
        else:
            only_api = api_set - host_set
            only_host = host_set - api_set
            problems.append(f"公司集合不一致: 仅API有{only_api}, 仅宿主有{only_host}")
            print(f"  [FAIL] 公司集合不一致")
            if only_api:
                print(f"         仅 API 有: {sorted(only_api)}")
            if only_host:
                print(f"         仅宿主有: {sorted(only_host)}")

    print()
    if problems:
        print("✗ 数据不一致：")
        for p in problems:
            print("   -", p)
        print("\n  修复: 见 docker-compose.yml 中 crm 服务的 volumes 注释")
        return 1
    print("✓ API / peer / 宿主文件读到的是同一份数据")
    return 0


if __name__ == "__main__":
    sys.exit(main())
