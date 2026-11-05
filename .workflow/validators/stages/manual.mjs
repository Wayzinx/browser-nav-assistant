// 人工验收关卡：自动化全部通过之后，由人（或真实浏览器中的 agent）在用户真实使用的 Chrome 里
// 按 PROBLEM.md 验收第 1–10 步操作并截图、签字。--init 生成清单，--check 校验是否已完成且结论为通过。
export const MANUAL_DIR = 'evidence/_manual';
export const CHECKLIST = `${MANUAL_DIR}/checklist.md`;
const STEP_LINE = /^- \[( |x|X)\] \*\*步骤 (\d{2})\*\*\s*(.*)$/;
const NO_SHOT = '不适用';

function acceptanceSteps(ctx) {
  const t = ctx.readText('PROBLEM.md', false) || '';
  const sec = t.split(/^# 验收要求\s*$/m)[1] || '';
  const body = sec.split(/^# /m)[0];
  const steps = [...body.matchAll(/^(\d+)\.\s+(.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2].trim() }));
  return steps.length ? steps : Array.from({ length: 10 }, (_, i) => ({ n: i + 1, text: `PROBLEM.md 验收第 ${i + 1} 步` }));
}

export function initManual(ctx) {
  if (ctx.exists(CHECKLIST) && !ctx.opts.force) {
    ctx.warn(`${CHECKLIST} 已存在，没有覆盖（需要重新生成请加 --force）`);
    ctx.R.manual = { checklist: CHECKLIST, created: false };
    return;
  }
  const steps = acceptanceSteps(ctx);
  const pad = (n) => String(n).padStart(2, '0');
  const lines = [
    '# 人工验收清单', '',
    '> 由 `node .workflow/validators/validate.mjs manual --init` 生成。自动化测试和真实安装冒烟都通过之后，由验收人在**自己日常使用的 Chrome** 中逐步操作。',
    '> 每一步：完成后把 `[ ]` 改成 `[x]`，截图保存到对应路径，把「结论」改成「通过」或「不通过」，必要时写备注。`manual --check` 会逐项校验。', '',
    '## 安装步骤', '',
    '1. 按 README「快速开始」启动后端：`scripts/start.sh`（默认 http://127.0.0.1:3000），确认 `curl http://127.0.0.1:3000/api/health` 返回 `status=ok`。',
    '2. 打开 `chrome://extensions`，开启右上角「开发者模式」，点「加载已解压的扩展程序」，选择项目中的 `extension/` 目录；确认卡片上没有「错误」按钮。',
    '3. 把「浏览器导航助手」固定到工具栏，**点击工具栏图标**打开 popup（不要用新标签页打开 popup.html），确认 popup 完整显示、不是空白小框。',
    '4. 首次安装时不要预先修改任何配置，先按默认配置走一遍；需要修改 API 地址时，在诊断页里修改。', '',
    '## 验收步骤（PROBLEM.md「验收要求」第 1–10 步）', '',
    ...steps.map((s) => `- [ ] **步骤 ${pad(s.n)}** ${s.text} ｜ 截图：\`${s.n === 10 ? NO_SHOT : `${MANUAL_DIR}/step-${pad(s.n)}.png`}\` ｜ 结论：待填 ｜ 备注：`),
    '', '## 签字', '',
    '- 验收人：',
    '- 时间：',
    '- 浏览器版本：',
    '- 结论：（通过 / 不通过）', '',
  ];
  ctx.writeAtomic(CHECKLIST, lines.join('\n'));
  ctx.R.manual = { checklist: CHECKLIST, created: true, steps: steps.length };
}

export function checkManual(ctx) {
  const t = ctx.readText(CHECKLIST, false);
  if (t == null) { ctx.err(`缺少人工验收清单 ${CHECKLIST}：先运行 manual --init，由验收人完成后再运行 manual --check`); ctx.R.manual = { checklist: CHECKLIST, exists: false }; return; }
  const expected = acceptanceSteps(ctx).map((s) => s.n);
  const rows = [];
  for (const line of t.split('\n')) {
    const m = STEP_LINE.exec(line.trim());
    if (!m) continue;
    const parts = m[3].split('｜').map((x) => x.trim());
    const title = parts[0] || '';
    const shot = (/截图：`?([^`]*)`?/.exec(parts.find((p) => p.startsWith('截图')) || '') || [])[1]?.trim() || '';
    const verdict = (/结论：(.*)$/.exec(parts.find((p) => p.startsWith('结论')) || '') || [])[1]?.trim() || '';
    rows.push({ n: Number(m[2]), checked: m[1].toLowerCase() === 'x', title, shot, verdict });
  }
  const pad = (n) => String(n).padStart(2, '0');
  for (const n of expected) {
    const r = rows.find((x) => x.n === n);
    const name = `步骤 ${pad(n)}`;
    if (!r) { ctx.err(`${name}：清单中找不到这一步（不要删除或改写步骤行的格式）`); continue; }
    const label = `${name}（${ctx.short(r.title, 30)}）`;
    if (!r.checked) ctx.err(`${label}：未勾选完成`);
    if (!r.shot) ctx.err(`${label}：没有填写截图路径`);
    else if (r.shot !== NO_SHOT && !ctx.exists(r.shot)) ctx.err(`${label}：截图不存在 ${r.shot}`);
    if (!r.verdict || r.verdict === '待填') ctx.err(`${label}：结论未填写`);
    else if (/不通过/.test(r.verdict) || !/通过/.test(r.verdict)) ctx.err(`${label}：结论为「${r.verdict}」，不是「通过」`);
  }
  const field = (k) => (new RegExp(`^- ${k}：(.*)$`, 'm').exec(t) || [])[1]?.trim() || '';
  if (!field('验收人')) ctx.err('签字：验收人未填写');
  if (!field('时间')) ctx.err('签字：时间未填写');
  const final = field('结论');
  if (!final || /（通过 \/ 不通过）/.test(final)) ctx.err('签字：总结论未填写');
  else if (/不通过/.test(final) || !/通过/.test(final)) ctx.err(`签字：总结论为「${final}」，不是「通过」`);
  ctx.R.manual = { checklist: CHECKLIST, exists: true, steps: rows.length, checked: rows.filter((r) => r.checked).length, passed: rows.filter((r) => r.verdict === '通过').length, signer: field('验收人') || null, verdict: final || null };
}
