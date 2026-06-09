#!/usr/bin/env python3
"""Build the Mail2000 AI 自動回覆 userscript.

流程：
1. 讀 src-userscript/header.meta.js，把 @version 戳成 1.0.{YYYYMMDDhhmm}
   （確保 Tampermonkey 每次 build 都偵測到升版）。
2. 在 header 後注入共享 IIFE 包裹，依 BODY_MODULES 順序串接各裸宣告模組
   （全部模組共享同一個函式 scope；boot.js 末行的 boot() 在所有宣告後啟動）。
3. 輸出 dist/mail2000-ai-reply.user.js。
4. 順帶產出 dist/dev-loader.user.js（@require file:// 本機 dist，供開發熱重載；
   已列入 .gitignore，含本機絕對路徑、不 commit）。

用法：
    python build-userscript.py            # build 一次
    python build-userscript.py --watch    # 監看 src 變動自動重 build
"""
from __future__ import annotations

import argparse
import datetime
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src-userscript"
DIST = ROOT / "dist"
OUT_NAME = "mail2000-ai-reply.user.js"

# body 模組串接順序（順序即載入順序；boot.js 必須最後，因含 boot() 啟動呼叫）。
# 全部模組為裸宣告（無各自 IIFE），由 build() 注入單一共享 IIFE 包裹後串接。
BODY_MODULES = [
    "constants.js",      # 常數：STORAGE_KEY / PROVIDERS / DEFAULT_CONFIG
    "config-store.js",   # 設定儲存：loadConfig / saveConfig
    "utils.js",          # 工具：log / escapeHtml / textToHtml / stripRePrefix / topDoc / toast
    "frame-utils.js",    # Frame 存取：getM2k / getMsgWin / getComposeWin / isComposeFrame
    "mail-extract.js",   # 擷取原信：extractOriginalMail
    "rules.js",          # 主旨規則：pickRule / pickSystemPrompt
    "llm-adapter.js",    # LLM 呼叫：shortErr / buildRequestSpec / callLLM（三家可切換）
    "insert-reply.js",   # 寫入編輯器：insertReply
    "generate.js",       # 生成流程：generateReply
    "settings-style.js", # 設定面板樣式：m2kai- CSS（稍後新增的模組）
    "settings-ui.js",    # 設定面板：openSettings 等
    "button-injector.js",# 按鈕注入：makeToolbarButton / injectComposeButtons
    "boot.js",           # 啟動：boot()（末行呼叫 boot()）
]

# build 會監看這些檔案（--watch 模式）
WATCH_FILES = [SRC / "header.meta.js"] + [SRC / m for m in BODY_MODULES] + [Path(__file__)]


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def stamp_version(meta: str) -> str:
    """把 @version 行換成 1.0.{YYYYMMDDhhmm}。"""
    stamp = datetime.datetime.now().strftime("1.0.%Y%m%d%H%M")
    new, n = re.subn(
        r"(//\s*@version\s+)\S+",
        lambda m: m.group(1) + stamp,
        meta,
        count=1,
    )
    if n == 0:
        raise SystemExit("header.meta.js 找不到 @version 行")
    return new


def build() -> Path:
    meta = stamp_version(read(SRC / "header.meta.js")).rstrip()
    # bundle 結構：metadata header → 共享 IIFE 包裹 → 各模組裸宣告依序串接。
    # eslint-disable 註解須在 bundle 頂層才能涵蓋整檔的 GM_* 與跨模組符號。
    pieces = [
        meta,
        "",
        "/* eslint-disable no-undef */",
        "(function () {",
        "  'use strict';",
        "",
    ]
    for mod in BODY_MODULES:
        p = SRC / mod
        if not p.exists():
            raise SystemExit(f"缺少模組：{p}")
        pieces.append(read(p).rstrip())
        pieces.append("")            # 模組間空行分隔，避免黏太緊
    pieces.append("})();")
    pieces.append("")

    out = "\n".join(pieces)
    DIST.mkdir(exist_ok=True)
    out_path = DIST / OUT_NAME
    out_path.write_text(out, encoding="utf-8")

    write_dev_loader()

    ver = re.search(r"@version\s+(\S+)", meta).group(1)
    print(f"[OK] {out_path}  (version {ver}, {len(out)} bytes)")
    return out_path


def write_dev_loader() -> None:
    """產生 dev-loader：只有 metadata，@require 本機 dist 檔。"""
    dist_uri = (DIST / OUT_NAME).resolve().as_uri()
    loader = (
        "// ==UserScript==\n"
        "// @name         Mail2000 AI 自動回覆 (DEV loader)\n"
        "// @namespace    https://github.com/ZZ0075-Inforce/auto-reply-mail2000\n"
        "// @version      0.0.0-dev\n"
        "// @description  本機開發 loader：實際邏輯由 @require 的 dist/mail2000-ai-reply.user.js 提供\n"
        "// @match        https://mail.inforce.com.tw/*\n"
        "// @run-at       document-idle\n"
        "// @grant        GM_xmlhttpRequest\n"
        "// @grant        GM_setValue\n"
        "// @grant        GM_getValue\n"
        "// @grant        GM_registerMenuCommand\n"
        "// @connect      api.openai.com\n"
        "// @connect      api.anthropic.com\n"
        "// @connect      generativelanguage.googleapis.com\n"
        "// @connect      localhost\n"
        "// @connect      127.0.0.1\n"
        f"// @require      {dist_uri}\n"
        "// ==/UserScript==\n"
        "\n"
        "// loader：本檔不含邏輯，實際程式由上方 @require 的本機 dist 檔提供。\n"
    )
    (DIST / "dev-loader.user.js").write_text(loader, encoding="utf-8")


def watch() -> None:
    print("[watch] 監看 src-userscript 變動，Ctrl+C 結束…")
    mtimes = {}
    try:
        while True:
            changed = False
            for f in WATCH_FILES:
                try:
                    m = f.stat().st_mtime
                except FileNotFoundError:
                    continue
                if mtimes.get(f) != m:
                    mtimes[f] = m
                    changed = True
            if changed:
                try:
                    build()
                except SystemExit as e:
                    print("[error]", e, file=sys.stderr)
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[watch] 結束")


def main() -> None:
    ap = argparse.ArgumentParser(description="Build Mail2000 AI 自動回覆 userscript")
    ap.add_argument("--watch", action="store_true", help="監看 src 變動自動重 build")
    args = ap.parse_args()
    if args.watch:
        build()
        watch()
    else:
        build()


if __name__ == "__main__":
    main()
