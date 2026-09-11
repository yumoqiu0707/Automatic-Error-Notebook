#!/usr/bin/env bash
# 错题集生成与知识点拓展助手 —— macOS / Linux 启动脚本
#
# 用法：
#   macOS：  在「终端」里  bash start.sh      （也可以直接双击 启动错题集助手.command）
#   Linux：  在终端里      bash start.sh
#
# 关掉这个终端窗口（或按 Ctrl+C）就是停止服务 —— 错题集数据已自动保存在 data/db.json。

set -u
cd "$(dirname "$0")" || exit 1

echo ""
echo "  错题集生成与知识点拓展助手"
echo "  ────────────────────────────────────────"

# ---------- 1. 找 node（PATH 优先，其次几个常见安装位置）----------
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
else
  for p in \
    /usr/local/bin/node \
    /opt/homebrew/bin/node \
    /usr/bin/node \
    /snap/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node
  do
    if [ -x "$p" ]; then NODE_BIN="$p"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  echo ""
  echo "  [错误] 没找到 Node.js。"
  echo ""
  echo "  本程序需要 Node.js 18 或更高版本。请先安装："
  echo "      https://nodejs.org"
  echo "  或者（macOS / Linux 用 Homebrew）："
  echo "      brew install node"
  echo ""
  echo "  装好之后，重新运行本脚本即可。"
  echo ""
  exit 1
fi

# ---------- 2. 版本要 >= 18（本项目用了 fetch / FileHandle 等新特性）----------
NODE_VER="$("$NODE_BIN" -v 2>/dev/null || echo unknown)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo ""
  echo "  [错误] Node.js 版本过低：$NODE_VER（需要 18 或更高）"
  echo "  请到 https://nodejs.org 升级后重试。"
  echo ""
  exit 1
fi

echo "  Node：$NODE_VER   ($NODE_BIN)"
echo ""
echo "  正在启动服务…… 浏览器会自动打开。"
echo "  这个窗口不要关 —— 关掉窗口就等于停止服务（错题集已保存，不会丢）。"
echo ""

# ---------- 3. 启动（--open 让浏览器自动打开）----------
#        端口想改就先  PORT=5190 bash start.sh
"$NODE_BIN" server.js --open
