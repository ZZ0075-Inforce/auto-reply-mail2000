#!/usr/bin/env python3
"""Build the Mail2000 AI 自動回覆 userscript.

流程：
1. 讀 src-userscript/header.meta.js，把 @version 戳成 1.0.{YYYYMMDDhhmm}
   （確保 Tampermonkey 每次 build 都偵測到升版）。
2. 依序串接 header + BODY_MODULES（目前只有 app.js，未來可再拆模組）。
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

# body 模組串接順序（未來要拆檔，往這個清單加即可，順序即載入順序）
BODY_MODULES = [
    "app.js",
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
    meta = stamp_version(read(SRC / "header.meta.js")).rstrip() + "\n"
    parts = [meta]
    for mod in BODY_MODULES:
        p = SRC / mod
        if not p.exists():
            raise SystemExit(f"缺少模組：{p}")
        parts.append(read(p).rstrip() + "\n")

    out = "\n".join(parts)
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
        "// @namespace    https://github.com/inforce/mail2000-ai-reply\n"
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
