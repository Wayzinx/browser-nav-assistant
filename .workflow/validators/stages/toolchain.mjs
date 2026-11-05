// 工具链锁：workflow 开始时记录技能、规范、约定、validator、workflow 脚本的摘要与快照；
// （冒烟计划 tests/smoke/** 由每个需求的自动化 agent 编写，随测试脚本一起进测试锁 LOCK_SCOPE，不在这里）
// 之后每次 --check 发现改动即报错（运行中任何 agent 都不得修改这些文件），--restore 用快照还原。
// 规则与测试锁（tests.lock.json + snapshot/）一致。
import fs from 'node:fs';
import path from 'node:path';

const LOCK = '.workflow/locks/toolchain.json';
const SNAP = '.workflow/locks/toolchain-snapshot';
const QUARANTINE = '.workflow/locks/toolchain-quarantine';

function scopeFiles(ctx) {
  const out = [
    ...ctx.walk('.agents/skills'), ...ctx.walk('specs'), ...ctx.walk('.workflow/validators'),
    ...(ctx.exists('.workflow/CONVENTIONS.md') ? ['.workflow/CONVENTIONS.md'] : []),
    ...(ctx.exists('.workflow') ? fs.readdirSync(ctx.abs('.workflow')).filter((n) => n.endsWith('.workflow.js')).map((n) => `.workflow/${n}`) : []),
  ];
  return [...new Set(out)].filter((f) => !f.endsWith('.DS_Store')).sort();
}

function current(ctx) {
  const files = {};
  for (const f of scopeFiles(ctx)) files[f] = ctx.sha(fs.readFileSync(ctx.abs(f)));
  return { digest: ctx.sha(JSON.stringify(files)), files };
}

export function recordToolchain(ctx) {
  const cur = current(ctx);
  fs.rmSync(ctx.abs(SNAP), { recursive: true, force: true });
  for (const f of Object.keys(cur.files)) {
    fs.mkdirSync(path.dirname(ctx.abs(path.join(SNAP, f))), { recursive: true });
    fs.copyFileSync(ctx.abs(f), ctx.abs(path.join(SNAP, f)));
  }
  ctx.writeAtomic(LOCK, JSON.stringify({ digest: cur.digest, recordedAt: new Date().toISOString(), files: cur.files }, null, 2));
  ctx.R.toolchain = { digest: cur.digest, files: Object.keys(cur.files).length, snapshot: SNAP };
}

function diff(ctx) {
  const lock = ctx.readJson(LOCK, false);
  const cur = current(ctx);
  if (!lock) return { lock: null, cur, changed: [], added: [], removed: [] };
  return {
    lock, cur,
    changed: Object.keys(cur.files).filter((f) => lock.files[f] && lock.files[f] !== cur.files[f]),
    added: Object.keys(cur.files).filter((f) => !lock.files[f]),
    removed: Object.keys(lock.files).filter((f) => !cur.files[f]),
  };
}

/**
 * @param {object} ctx
 * @param {{ missingIsWarning?: boolean }} [o] final 阶段中未记录工具链锁只报 warning
 */
export function checkToolchain(ctx, { missingIsWarning = false } = {}) {
  const d = diff(ctx);
  if (!d.lock) {
    (missingIsWarning ? ctx.warn : ctx.err)(`工具链尚未锁定（${LOCK} 不存在）：workflow 开始时运行 toolchain --record`);
    ctx.R.toolchain = { recorded: false, changed: [], added: [], removed: [] };
    ctx.R.tampered = false;
    return;
  }
  for (const f of d.changed) ctx.err(`工具链文件在锁定后被修改：${f}`);
  for (const f of d.added) ctx.err(`工具链锁定后新增了文件：${f}`);
  for (const f of d.removed) ctx.err(`工具链锁定后删除了文件：${f}`);
  ctx.R.toolchain = { recorded: true, recordedAt: d.lock.recordedAt, digest: d.cur.digest, lockDigest: d.lock.digest, changed: d.changed, added: d.added, removed: d.removed };
  ctx.R.tampered = d.changed.length + d.added.length + d.removed.length > 0;
}

export function restoreToolchain(ctx) {
  const d = diff(ctx);
  if (!d.lock) { ctx.err(`没有工具链锁（${LOCK}），无法还原`); return; }
  const only = ctx.opts.file ? new Set(String(ctx.opts.file).split(',')) : null;
  const restored = [];
  for (const f of [...d.changed, ...d.removed]) {
    if (only && !only.has(f)) continue;
    const src = ctx.abs(path.join(SNAP, f));
    if (!fs.existsSync(src)) { ctx.err(`快照中缺少 ${f}，无法还原`); continue; }
    fs.mkdirSync(path.dirname(ctx.abs(f)), { recursive: true });
    fs.copyFileSync(src, ctx.abs(f));
    restored.push(f);
  }
  for (const f of d.added) {
    if (only && !only.has(f)) continue;
    const q = path.join(QUARANTINE, f);
    fs.mkdirSync(path.dirname(ctx.abs(q)), { recursive: true });
    fs.renameSync(ctx.abs(f), ctx.abs(q));
    restored.push(`${f}（已移至 ${q}）`);
  }
  ctx.R.toolchain = { restored };
  ctx.R.stats.restored = restored;
}
