#!/data/data/com.termux/files/usr/bin/bash
# 错题集生成与知识点拓展助手 —— 安卓手机（Termux）独立运行脚本
#
# 作用：手机不需要电脑，自己当服务器自己用。
#   - 首次运行自动安装 Node.js（Termux 里不需要编译，几分钟装好）
#   - 强制只监听本机（127.0.0.1），同 Wi-Fi 的其他人访问不到
#   - 启动后自动打开浏览器；建议「添加到主屏幕」当 App 用
#
# 用法（在 Termux 里，进入项目目录后）：
#   bash start-termux.sh            启动（停止：音量减键 + C，即 Ctrl+C）
#   bash start-termux.sh backup     把错题数据备份一份到手机「下载」目录
#
# Termux 只能从 F-Droid 或 GitHub Releases 安装（应用商店里的版本已废弃，装了会出各种怪问题）。

set -u
cd "$(dirname "$0")" || exit 1

GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; OFF='\033[0m'
line='  ────────────────────────────────────────'

# ---------- 备份子命令 ----------
if [ "${1:-}" = "backup" ]; then
  if [ ! -f data/db.json ]; then
    echo -e "${RED}还没有错题数据（data/db.json 不存在），无需备份。${OFF}"
    exit 1
  fi
  termux-setup-storage 2>/dev/null || true
  if [ ! -d "$HOME/storage/downloads" ]; then
    echo -e "${RED}没有存储权限。请先手动执行一次 termux-setup-storage 并点「允许」。${OFF}"
    exit 1
  fi
  dest="$HOME/storage/downloads/cuotiji-backup-$(date +%Y%m%d-%H%M).json"
  cp data/db.json "$dest" \
    && echo -e "${GREEN}已备份到手机「下载」目录：${OFF}$dest" \
    || echo -e "${RED}备份失败：$?${OFF}"
  exit 0
fi

# ---------- 1. Node.js：没有就装 ----------
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo -e "${YELLOW}未检测到 Node.js，正在安装（首次需要几分钟）……${OFF}"
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y nodejs-lts || pkg install -y nodejs || {
    echo ""
    echo -e "${RED}Node.js 安装失败。请手动执行：pkg install nodejs-lts${OFF}"
    exit 1
  }
fi

NODE_BIN="$(command -v node)"
NODE_VER="$("$NODE_BIN" -v 2>/dev/null || echo unknown)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) NODE_MAJOR=0 ;;
esac
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo ""
  echo -e "${RED}Node.js 版本过低：$NODE_VER（需要 18 或更高）。${OFF}"
  echo -e "  请执行：${DIM}pkg install nodejs-lts${OFF} 升级后重试。"
  exit 1
fi

# ---------- 2. 配置 ----------
# 首次运行生成最小配置；API Key 打开页面后在右上角「模型设置」里填，
# 也可以直接把电脑上已配好的 config.json（内含 Key）拷到本目录，最省事。
if [ ! -f config.json ]; then
  printf '{\n  "host": "127.0.0.1"\n}\n' > config.json
  echo -e "${YELLOW}已生成 config.json —— 打开页面后在「模型设置」里填 API Key 即可。${OFF}"
fi

# 手机单机使用：只监听本机，避免同 Wi-Fi 下被他人访问（环境变量优先级高于 config）
export HOST=127.0.0.1
export PORT="${PORT:-5178}"

# ---------- 3. 启动 ----------
# 防休眠：减少切到后台时被系统杀掉的概率（不是百分百，被杀了重跑本脚本即可，数据不丢）
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock 2>/dev/null

echo ""
echo "  错题集生成与知识点拓展助手 · 手机版"
echo "$line"
echo -e "  Node：$NODE_VER"
echo -e "  启动后浏览器会自动打开，也可手动访问：${GREEN}http://127.0.0.1:${PORT}${OFF}"
echo -e "  建议：Chrome 菜单 →「添加到主屏幕」，之后点图标即用。"
echo -e "  停止：回到 Termux 按 ${DIM}Ctrl+C（音量减键 + C）${OFF}；数据自动保存，不会丢。"
echo "$line"
echo ""

"$NODE_BIN" server.js --no-open &
SRV=$!
trap 'kill $SRV 2>/dev/null; wait $SRV 2>/dev/null; exit 0' INT TERM

# 服务就绪后自动打开浏览器（termux-open-url 属于 termux-tools，一般自带）
for _ in $(seq 1 40); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/api/status" 2>/dev/null; then
    command -v termux-open-url >/dev/null 2>&1 && \
      termux-open-url "http://127.0.0.1:${PORT}" 2>/dev/null
    break
  fi
  sleep 0.5
done

wait $SRV
