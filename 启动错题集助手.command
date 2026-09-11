#!/bin/bash
# 错题集助手 —— macOS 双击入口
#
# 双击本文件 = 在「终端」里运行 bash start.sh。
# 本文件只是转发，真正的启动逻辑在 start.sh。
#
# 如果双击提示「无法打开，因为它来自身份不明的开发者」：
#   在 Finder 里右键本文件 →「打开」→ 再点「打开」；
# 如果双击没有任何反应（有些方式下载会丢掉可执行权限）：
#   在「终端」里 cd 到本文件夹，运行  bash start.sh

cd "$(dirname "$0")" || exit 1
exec bash ./start.sh
