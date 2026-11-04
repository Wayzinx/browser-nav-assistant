#!/bin/sh
# 还原提交时打包的目录：tests/、docs/trace|cases|quality|prototype/、.workflow/、.agents/、specs/、evidence/ 等。
# 平台上传限制（最多 200 个文件、单个文件不超过 1MB、总计不超过 10MB），所以这些目录以 tar.gz（必要时按 950KB 分卷）提交，
# 由 .workflow/tools/pack-submission.mjs 生成。打包与裁剪记录（去重、转 JPEG、按预算删除的条目）见 bundles/MANIFEST.json；
# 提交包中的截图已转成 JPEG，result.json / explore.json / 文档中的路径已同步改写，解包后引用可以直接打开。
set -e
cd "$(dirname "$0")/.."
[ -d bundles ] || { echo "没有 bundles/ 目录，无需还原"; exit 0; }

# 从 MANIFEST 读取期望的 sha256；没有 MANIFEST 或没有 node 时跳过校验
expected() {
  if [ -f bundles/MANIFEST.json ] && command -v node >/dev/null 2>&1; then
    node -e "const m=require('./bundles/MANIFEST.json');for(const b of m.bundles||[])for(const p of b.parts||[])if(p.file===process.argv[1])console.log(p.sha256)" "bundles/$1"
  fi
}
verify() {
  want=$(expected "$(basename "$1")")
  if [ -n "$want" ] && command -v shasum >/dev/null 2>&1; then
    got=$(shasum -a 256 "$1" | cut -d' ' -f1)
    [ "$got" = "$want" ] || { echo "sha256 校验失败：$1（期望 $want，实际 $got）"; exit 1; }
  fi
}

names=$(ls bundles | sed -n 's/\.tar\.gz\(\.part-..\)\{0,1\}$//p' | sort -u)
for name in $names; do
  if [ -f "bundles/$name.tar.gz" ]; then
    verify "bundles/$name.tar.gz"
    tar xzf "bundles/$name.tar.gz"
  else
    for part in bundles/"$name".tar.gz.part-*; do verify "$part"; done
    cat bundles/"$name".tar.gz.part-* | tar xz
  fi
  echo "已还原 $name"
done
echo "完成。运行测试：npm install && npx playwright install chromium && scripts/test.sh"
