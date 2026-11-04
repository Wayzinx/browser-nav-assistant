// 代码冻结：终检通过后记录交付代码的摘要；交付前（release / submission）再比较，
// 终检之后任何代码改动都必须重新跑门禁和冒烟（v2 运行中 popup.css 在终检后被改过，测试时的版本已无法追溯）。
//
// 摘要算法（pack-submission.mjs 也按同一算法复算）：
//   files  = { 相对路径(posix): sha256(文件内容) }，范围为 extension/ server/ scripts/ resources/ 下的全部文件，
//            按路径排序，跳过 node_modules、.git、test-results、playwright-report、coverage 目录和 .DS_Store
//   digest = sha256(JSON.stringify(files))
import fs from 'node:fs';

export const FREEZE_FILE = '.workflow/reports/freeze.json';
export const FREEZE_DIRS = ['extension', 'server', 'scripts', 'resources'];

function codeDigest(ctx) {
  const files = {};
  for (const f of FREEZE_DIRS.flatMap((d) => ctx.walk(d)).filter((f) => !f.endsWith('.DS_Store')).sort()) files[f] = ctx.sha(fs.readFileSync(ctx.abs(f)));
  return { digest: ctx.sha(JSON.stringify(files)), files };
}

export function recordFreeze(ctx) {
  const cur = codeDigest(ctx);
  const out = { digest: cur.digest, recordedAt: new Date().toISOString(), dirs: FREEZE_DIRS, algorithm: 'sha256(JSON.stringify({ posixPath: sha256(content) }，按路径排序))', files: cur.files };
  ctx.writeAtomic(FREEZE_FILE, JSON.stringify(out, null, 2));
  ctx.R.freeze = { digest: cur.digest, files: Object.keys(cur.files).length, file: FREEZE_FILE };
}

export function checkFreeze(ctx) {
  const rec = ctx.readJson(FREEZE_FILE, false);
  if (!rec) { ctx.err(`尚未记录代码冻结（${FREEZE_FILE} 不存在）：终检通过后运行 freeze --record`); ctx.R.freeze = { recorded: false }; return; }
  const cur = codeDigest(ctx);
  const changed = Object.keys(cur.files).filter((f) => rec.files?.[f] && rec.files[f] !== cur.files[f]);
  const added = Object.keys(cur.files).filter((f) => !rec.files?.[f]);
  const removed = Object.keys(rec.files || {}).filter((f) => !cur.files[f]);
  if (changed.length + added.length + removed.length) {
    ctx.err(`终检后代码被修改，需要重跑门禁和冒烟（修改 ${changed.length}、新增 ${added.length}、删除 ${removed.length}）`);
    for (const f of [...changed.map((x) => `修改 ${x}`), ...added.map((x) => `新增 ${x}`), ...removed.map((x) => `删除 ${x}`)].slice(0, 40)) ctx.err(`  ${f}`);
  }
  ctx.R.freeze = { recorded: true, recordedAt: rec.recordedAt, digest: cur.digest, frozenDigest: rec.digest, match: cur.digest === rec.digest, changed, added, removed };
}
