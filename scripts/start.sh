#!/usr/bin/env sh
# @code C-BE-DEMO-01
set -eu
cd "$(dirname "$0")/.."
SNAPSHOT_FILE="${SNAPSHOT_FILE-data/snapshot.json}"
export SNAPSHOT_FILE
printf '启动后端；可用 PORT=<端口> ./scripts/start.sh 更换端口。\n'
# 占用时先失败，不向他人的监听进程发送健康检查。
node scripts/print-health.mjs --check-port
# exec 保留启动进程 PID；探针据此在服务退出后自行结束。
node scripts/print-health.mjs "$$" &
exec node server/src/index.js
