#!/usr/bin/env python3
"""全栈浏览器冒烟：8 模块真实数据初始化 + 控制台错误 + 375px 溢出"""
import json
import subprocess
import sys
import time
import urllib.request
from playwright.sync_api import sync_playwright

ROOT = "/Users/chenhuidediannao/Desktop/金创翼\"大学生创新创业大赛草稿/金坛数字文旅平台"
PORT = 8787
BASE = f"http://localhost:{PORT}"


def wait_health(timeout=10):
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            with urllib.request.urlopen(BASE + "/api/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.3)
    return False


import os

server = subprocess.Popen(
    ["node", "server.js"], cwd=ROOT, env={**os.environ, "PORT": str(PORT)},
    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
)
try:
    if not wait_health():
        print("FATAL: server 起不来")
        sys.exit(2)

    findings = {"console": [], "failed_requests": [], "modules": {}, "overflow": None, "fatal": []}

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 900})
        page.on("console", lambda m: findings["console"].append(f"[{m.type}] {m.text[:300]}")
                if m.type in ("error", "warning") else None)
        page.on("response", lambda r: findings.setdefault("notfound", []).append(r.url.replace(BASE, "")) if r.status == 404 else None)
        page.on("requestfailed", lambda r: findings["failed_requests"].append(
            f"{r.url.replace(BASE, '')} — {(r.failure or '')[:120]}"))
        page.on("pageerror", lambda e: findings["fatal"].append(str(e)[:400]))

        page.goto(BASE + "/", wait_until="networkidle", timeout=45000)
        page.wait_for_timeout(2500)

        # 直接初始化的模块
        def count(sel):
            return page.eval_on_selector(sel, "el => el.childElementCount") if page.query_selector(sel) else -1

        def filled(sel, min_children=1):
            n = count(sel)
            return n >= min_children

        checks = {
            "story-acts": lambda: count("#acts") == 5,
            "vision": lambda: count("#visionBody") >= 4,
            "nav": lambda: count("#navLinks") == 6,
            "map-side": lambda: filled("#mapSide"),
            "map-filters": lambda: filled("#mapFilters"),
            "chat-personas": lambda: filled("#chatPersonas", 3),
            "chat-log": lambda: filled("#chatLog"),
            "gene-controls": lambda: filled("#geneControls", 3),
            "gene-meta": lambda: filled("#geneMeta"),
            "human-picks": lambda: filled("#humanPicks", 1),
            "space-side": lambda: filled("#spaceSide"),
            "space-preview": lambda: filled("#spacePreview"),
            "hrd-pane": lambda: count("#paneHrd") >= 1 and page.eval_on_selector("#paneHrd", "el => el.innerText.length") > 20,
        }
        for name, fn in checks.items():
            try:
                findings["modules"][name] = "PASS" if fn() else "EMPTY"
            except Exception as e:
                findings["modules"][name] = f"ERR {e}"

        # 页签切换 → 惰性初始化
        page.click('[data-tab="yaji"]')
        page.wait_for_timeout(1500)
        findings["modules"]["yaji-pane"] = "PASS" if count("#paneYaji") >= 1 else f"EMPTY({count('#paneYaji')})"
        page.click('[data-tab="quiz"]')
        page.wait_for_timeout(1200)
        findings["modules"]["quiz-pane"] = "PASS" if count("#paneQuiz") >= 1 else f"EMPTY({count('#paneQuiz')})"
        # 回华容道再切一次（幂等）
        page.click('[data-tab="hrd"]')
        page.wait_for_timeout(800)
        findings["modules"]["hrd-reinit"] = "PASS" if count("#paneHrd") >= 1 else f"EMPTY({count('#paneHrd')})"

        # 地图交互：点第一个图钉
        try:
            page.click(".leaflet-marker-icon", timeout=4000)
            page.wait_for_timeout(600)
            findings["modules"]["map-pin-click"] = "PASS" if count("#mapSide") >= 2 else "EMPTY侧栏未展开"
        except Exception as e:
            findings["modules"]["map-pin-click"] = f"FAIL {str(e)[:120]}"

        # 对话：发一条（只读确认 SSE 回流）
        try:
            page.fill("#chatText", "三星村怎么挖出来的？")
            page.click('#chatForm button[type="submit"]')
            page.wait_for_timeout(6000)
            n = count("#chatLog")
            findings["modules"]["chat-stream"] = "PASS" if n >= 3 else f"气泡数不足({n})"
        except Exception as e:
            findings["modules"]["chat-stream"] = f"FAIL {str(e)[:120]}"

        # 375px 横向溢出
        page.set_viewport_size({"width": 375, "height": 800})
        page.wait_for_timeout(800)
        findings["overflow"] = page.evaluate(
            "() => { const d=document.documentElement; return {scrollW: d.scrollWidth, clientW: d.clientWidth, over: d.scrollWidth - d.clientWidth}; }"
        )
        browser.close()

    print(json.dumps(findings, ensure_ascii=False, indent=1))
    # 汇总
    bad = [k for k, v in findings["modules"].items() if v != "PASS"]
    fatal = findings["fatal"]
    over = findings["overflow"]["over"] if findings["overflow"] else -1
    print(f"\n== 汇总: modules_fail={bad or '无'} fatal={len(fatal)} console_err/warn={len(findings['console'])} reqfail={len(findings['failed_requests'])} 375溢出={over}px")
    sys.exit(0 if not bad and not fatal and over <= 0 else 1)
finally:
    server.terminate()
    try:
        server.wait(timeout=3)
    except Exception:
        server.kill()
