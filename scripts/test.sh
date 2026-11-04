#!/usr/bin/env bash
# 统一测试入口：参数原样透传给 playwright，例如 scripts/test.sh --project=api
set -euo pipefail
cd "$(dirname "$0")/.."
exec npx playwright test "$@"
