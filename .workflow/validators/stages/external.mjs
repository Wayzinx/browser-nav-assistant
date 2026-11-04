// 调用外部门禁脚本，把它们的 { pass, errors[], warnings[] } 并入 validator 报告：
//   smoke       → .agents/skills/nav-case-to-script/scripts/smoke-install.mjs --json（真实安装冒烟：真实 action popup、首次安装）
//   submission  → .workflow/tools/pack-submission.mjs --json（提交打包预算与解包复核）
import { spawnSync } from 'node:child_process';

export const SMOKE_SCRIPT = '.agents/skills/nav-case-to-script/scripts/smoke-install.mjs';
export const PACK_SCRIPT = '.workflow/tools/pack-submission.mjs';

function runJson(ctx, rel, args, timeout) {
  const r = spawnSync(process.execPath, [ctx.abs(rel), ...args], { cwd: ctx.ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout });
  const out = r.stdout || '';
  let j = null;
  const a = out.indexOf('{'); const b = out.lastIndexOf('}');
  if (a >= 0 && b > a) { try { j = JSON.parse(out.slice(a, b + 1)); } catch { j = null; } }
  return { r, j, out };
}

function merge(ctx, label, res) {
  const { r, j, out } = res;
  if (!j) { ctx.err(`${label} 的输出无法解析（exit ${r.status}${r.error ? '，' + r.error.message : ''}）：${ctx.short(ctx.stripAnsi(r.stderr || out), 600)}`); return null; }
  const fmt = (e) => (typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
  for (const e of j.errors || []) ctx.err(fmt(e));
  for (const w of (j.warnings || []).slice(0, 30)) ctx.warn(fmt(w));
  if ((j.pass === false || r.status !== 0) && !(j.errors || []).length) ctx.err(`${label} 未通过（exit ${r.status}），但没有给出错误明细`);
  return j;
}

export function runSmoke(ctx) {
  if (!ctx.exists(SMOKE_SCRIPT)) { ctx.err(`缺少真实安装冒烟脚本 ${SMOKE_SCRIPT}（nav-case-to-script 技能），无法验证插件在真实 action popup 中可用`); ctx.R.smoke = { pass: false, missing: true }; return; }
  const args = ['--json'];
  if (ctx.opts.browser) args.push(`--browser=${ctx.opts.browser}`);
  if (ctx.opts.scenarios) args.push(`--scenarios=${ctx.opts.scenarios}`);
  const j = merge(ctx, '真实安装冒烟', runJson(ctx, SMOKE_SCRIPT, args, Number(ctx.opts.timeout || 900000)));
  if (!j) { ctx.R.smoke = { pass: false }; return; }
  ctx.R.smoke = {
    pass: j.pass === true, generatedAt: j.generatedAt || null, browsers: j.browsers || null,
    results: (j.results || []).map((x) => ({ browser: x.browser, scenario: x.scenario, pass: x.pass, required: x.required, popupSize: x.popupSize, errors: (x.errors || []).length })),
    summary: 'evidence/_smoke/summary.json',
  };
}

export function runSubmission(ctx) {
  if (!ctx.exists(PACK_SCRIPT)) { ctx.err(`缺少提交打包脚本 ${PACK_SCRIPT}，无法校验提交包是否满足平台限制`); ctx.R.submission = { pass: false, missing: true }; return; }
  const args = ['--json'];
  if (ctx.opts['check-upload']) args.push('--check-upload');
  if (ctx.opts.out) args.push(`--out=${ctx.opts.out}`);
  const j = merge(ctx, '提交打包', runJson(ctx, PACK_SCRIPT, args, Number(ctx.opts.timeout || 900000)));
  ctx.R.submission = j ? { pass: j.pass === true, usage: j.usage || null, manifestPath: j.manifestPath || null, stagingDir: j.stagingDir || null } : { pass: false };
}
