export const meta = {
  name: 'nav-case-to-script',
  description: '用例转可执行脚本：按批并行编写（一个 Case ID 一个脚本）→ 静态检查 / 加载检查修复循环 →（verify 模式）执行、按分类修复脚本、变异检查补强断言 → 锁定完整性审查',
  whenToUse: '浏览器导航助手项目：把 docs/trace/cases-*.json 中的用例批量转成 tests/<type>/<CaseID>.spec.mjs；或在产品实现之后验证并补强已有脚本',
  phases: [
    { title: '1 准备', detail: '列出目标用例、检查测试基建，缺失时按技能资产补齐' },
    { title: '2 编写', detail: '按 type + module 分批并行编写；每批 lint + 加载检查，不通过就修复（最多 N 轮）' },
    { title: '3 执行验证', detail: 'verify 模式：执行 → 失败分类 → 只修脚本问题，产品缺陷单独列出（最多 N 轮）' },
    { title: '4 断言有效性', detail: 'verify 模式：API / E2E 变异检查 → 补强存活变异对应的断言' },
    { title: '5 完整性与汇总', detail: '测试已锁定时审查修改并重新锁定；输出汇总' },
  ],
}

// 用法（Workflow 工具）：{ scriptPath: '.agents/skills/nav-case-to-script/workflow/case-to-script.workflow.js', args: { mode: 'draft', type: 'API' } }
// args：cases（Case ID 数组）| module | type（API / E2E / UI）| mode（draft 默认 / verify）| rewrite（draft 模式下是否重写已有脚本，默认 false）
//       batchSize（默认 6）| maxFixRounds（默认 3）| port（默认 4160）| minKill（默认 0.8）

// ============================================================ 配置
const ROOT = '.' // 项目根目录：请在仓库根目录启动 Workflow（也可改成本机绝对路径）
const SK = '.agents/skills/nav-case-to-script'
const RUN = `node ${SK}/scripts/run-cases.mjs`
const LINT = `node ${SK}/scripts/lint-scripts.mjs`
const V = 'node .workflow/validators/validate.mjs'
const A = args || {}
const MODE = A.mode === 'verify' ? 'verify' : 'draft'
const BATCH = A.batchSize || 6
const MAX_FIX = A.maxFixRounds || 3
const PORT = A.port || 4160
const MIN_KILL = typeof A.minKill === 'number' ? A.minKill : 0.8
const P1 = '1 准备', P2 = '2 编写', P3 = '3 执行验证', P4 = '4 断言有效性', P5 = '5 完整性与汇总'
const DIR = { API: 'tests/api', E2E: 'tests/e2e', UI: 'tests/ui' }
const REF = { API: 'references/api-e2e-patterns.md', E2E: 'references/api-e2e-patterns.md', UI: 'references/ui-patterns.md' }
const TPL = { API: 'assets/templates/api.spec.mjs', E2E: 'assets/templates/e2e.spec.mjs', UI: 'assets/templates/ui.spec.mjs' }

// ============================================================ Schema
const STR_ARR = { type: 'array', items: { type: 'string' } }
const S_INVENTORY = {
  type: 'object',
  properties: {
    cases: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, type: { type: 'string' }, module: { type: 'string' }, hasScript: { type: 'boolean' } }, required: ['id', 'type', 'module', 'hasScript'] } },
    infra: { type: 'object', properties: { config: { type: 'boolean' }, missingFixtures: STR_ARR, playwright: { type: 'boolean' } }, required: ['config', 'missingFixtures', 'playwright'] },
    error: { type: 'string' },
  },
  required: ['cases', 'infra'],
}
const S_AUTHOR = {
  type: 'object',
  properties: {
    written: STR_ARR,
    disputes: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, reason: { type: 'string' } }, required: ['caseId', 'reason'] } },
    fixtureRequests: STR_ARR,
    notes: { type: 'string' },
  },
  required: ['written', 'disputes'],
}
const S_LINTRUN = { type: 'object', properties: { pass: { type: 'boolean' }, lintErrors: STR_ARR, listErrors: STR_ARR, warnings: STR_ARR }, required: ['pass', 'lintErrors', 'listErrors'] }
const S_EXEC = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    globalErrors: STR_ARR,
    cases: { type: 'array', items: { type: 'object', properties: {
      caseId: { type: 'string' }, status: { type: 'string' }, category: { type: 'string' }, tags: STR_ARR,
      hint: { type: 'string' }, error: { type: 'string' }, evidenceMissing: STR_ARR,
    }, required: ['caseId', 'status'] } },
  },
  required: ['pass', 'cases'],
}
const S_FIX = {
  type: 'object',
  properties: { results: { type: 'array', items: { type: 'object', properties: {
    caseId: { type: 'string' },
    verdict: { type: 'string', enum: ['script_fixed', 'product_bug', 'dispute', 'env', 'no_change'] },
    note: { type: 'string' }, evidence: { type: 'string' },
  }, required: ['caseId', 'verdict', 'note'] } } },
  required: ['results'],
}
const S_MUT = {
  type: 'object',
  properties: {
    killRate: { type: 'number' }, killed: { type: 'number' }, applicable: { type: 'number' },
    rows: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, baseline: { type: 'string' }, killRate: { type: 'number' }, survived: STR_ARR }, required: ['caseId', 'baseline', 'survived'] } },
    error: { type: 'string' },
  },
  required: ['rows'],
}
const S_STRENGTHEN = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, added: { type: 'number' }, ignored: STR_ARR, note: { type: 'string' } }, required: ['caseId', 'note'] } } }, required: ['results'] }
const S_DIGEST = { type: 'object', properties: { hasLock: { type: 'boolean' }, pass: { type: 'boolean' }, digest: { type: 'string' }, changed: STR_ARR, added: STR_ARR, removed: STR_ARR }, required: ['hasLock', 'pass'] }
const S_INTEGRITY = { type: 'object', properties: { approved: { type: 'boolean' }, violations: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, caseIds: STR_ARR, reason: { type: 'string' } }, required: ['file', 'reason'] } } }, required: ['approved', 'violations'] }

// ============================================================ 公共片段
const PRE = `【项目根目录】${ROOT}（所有相对路径都相对它；执行命令前先 cd 到这里）
【必读】${SK}/SKILL.md（硬性规则、映射方法、流水线、失败处理）、AGENTS.md、.workflow/CONVENTIONS.md §5–§6。
【真相源】PROBLEM.md、resource.json、docs/trace/*.json（只读）。
【禁止】修改 .workflow/、docs/、server/、extension/、tests/fixtures/；删除或放宽任何 [En] 断言；skip / only / waitForTimeout / try-catch 吞异常。
【语言】说明用中文，代码标识符用英文。`

const bullet = (arr) => (arr || []).map((x) => `- ${x}`).join('\n')
const short = (s, n = 400) => String(s || '').slice(0, n)
const fileOf = (c) => `${DIR[c.type]}/${c.id}.spec.mjs`
const ids = (cs) => cs.map((c) => c.id).join(' ')

function runner(cmd, transcribe, schema, label, ph) {
  return agent(`${PRE}
你是「确定性执行器」：只执行命令、如实转录结果，不做任何判断，不修改任何文件。
1. 执行（Bash 的 timeout 设为 600000；预计超过 10 分钟就用后台方式运行并等它结束）：
   cd "${ROOT}" && ${cmd}
   退出码非 0 表示有未通过项，属于正常情况，照常转录。
2. ${transcribe}
如果命令本身崩溃（不是检查未通过），按 schema 填写 pass=false（或 error 字段），并把崩溃输出的前 600 字放进第一个错误字段。`, { label, phase: ph, schema, effort: 'low' })
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function batchesOf(cases) {
  const groups = new Map()
  for (const c of cases) {
    const k = `${c.type}-${c.module}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(c)
  }
  return [...groups.entries()].flatMap(([k, cs]) => chunk(cs, BATCH).map((part, i) => ({ key: `${k}${i ? '#' + (i + 1) : ''}`, type: cs[0].type, cases: part })))
}

const summary = { mode: MODE, cases: 0, written: [], disputes: [], fixtureRequests: [], lint: { pass: [], fail: [] }, productBugs: [], envIssues: [], run: null, mutation: null, digest: null, notes: [] }

// ============================================================ 阶段 1：准备
phase(P1)
const SEL = [...(A.cases || []), A.module ? `--module=${A.module}` : '', A.type ? `--type=${A.type}` : ''].filter(Boolean).join(' ')
const INVENTORY_CMD = `${RUN} --inventory ${SEL}`
const inventory = () => runner(INVENTORY_CMD, '命令会输出 JSON，按 schema 原样转录 cases 和 infra（不要增删条目）。', S_INVENTORY, '盘点用例与基建', P1)

let inv = await inventory()
if (!inv || inv.error) return { status: 'halted', reason: `盘点失败：${inv && inv.error}`, summary }
if (!inv.infra.config || inv.infra.missingFixtures.length || !inv.infra.playwright) {
  log(`测试基建不完整（config=${inv.infra.config}，缺少夹具 ${inv.infra.missingFixtures.join(',') || '无'}，playwright=${inv.infra.playwright}），按技能资产补齐`)
  await agent(`${PRE}
你是测试基础设施工程师。按 ${SK}/SKILL.md 第 2 节补齐测试基建：只复制缺失的文件（已经存在的文件不要覆盖），把 ${SK}/assets/fixtures/*.mjs 复制到 tests/fixtures/，把 ${SK}/assets/playwright.config.mjs 复制为根目录的 playwright.config.mjs；package.json 不存在时创建（type: module，scripts 包含 test、test:api、test:e2e、test:ui、test:case），并安装 SKILL.md 中列出的 devDependencies。
核对后端技术方案（docs/03-技术方案-后端.md）中的入口文件是否为 server/src/index.js，以及 ui-contract.json 中 storage key 和 popup 路径是否与夹具中的常量一致；不一致时只修改那一行，并在 notes 中说明。
完成后运行 npx playwright test --list，确认配置能加载（后端不存在导致 webServer 起不来属于正常）。
（本次例外：允许写 tests/fixtures/、playwright.config.mjs、package.json。）`, { label: '补齐测试基建', phase: P1, schema: S_AUTHOR })
  inv = await inventory()
  if (!inv.infra.config || inv.infra.missingFixtures.length || !inv.infra.playwright) return { status: 'halted', reason: '测试基建仍然不完整', infra: inv.infra, summary }
}
summary.cases = inv.cases.length
if (!inv.cases.length) return { status: 'halted', reason: '没有匹配到用例（检查 docs/trace/cases-*.json 和筛选参数）', summary }
const toWrite = inv.cases.filter((c) => A.rewrite || !c.hasScript)
log(`目标用例 ${inv.cases.length} 条（已有脚本 ${inv.cases.filter((c) => c.hasScript).length} 条），本次需要编写 ${toWrite.length} 条；模式 ${MODE}`)

// ============================================================ 阶段 2：编写 + 静态检查修复循环
const AUTHOR = (b) => `${PRE}
你是${b.type === 'UI' ? '插件 UI' : '接口'}自动化工程师。按 ${SK}/SKILL.md，把下面每条用例各写成一个脚本文件（一个 Case ID 对应一个文件）：
${b.cases.map((c) => `- ${c.id}（${c.type}）→ ${fileOf(c)}`).join('\n')}
必读：${SK}/SKILL.md 第 1–5 节；${SK}/${REF[b.type]}；${SK}/references/assertion-cookbook.md；模板 ${SK}/${TPL[b.type]}；docs/trace/cases-${b.type === 'UI' ? 'ui' : 'api'}.json 中这些用例的完整定义；docs/trace/api-contract.json${b.type === 'UI' ? '、docs/trace/ui-contract.json（testId、storageKeys）' : ''}；docs/02-PRD.md 第 13 节（样例推演的具体值）。
做法：
1. 先为每条用例做「用例 → 脚本」映射（SKILL.md 第 3 节）：每个 Sn 对应一个 test.step；每个 En 至少对应一个 expect(实际值, '[En] …').<强匹配器>；期望值来自用例、契约和样例推算，不要凭空写。
2. 只写上面列出的文件。需要新的夹具能力时不要改 tests/fixtures/，写进 fixtureRequests。
3. 用例无法自动化，或者与契约冲突时，不要硬写，写进 disputes（附上用例原文和契约原文）。
4. 写完后运行 ${LINT} ${ids(b.cases)}，修到 0 error（warning 尽量清零）；再运行 ${RUN} ${ids(b.cases)} --lint-only，确认 Playwright 能加载。不要执行用例（执行由后续阶段统一进行）。
结构化输出：written（写好的文件）、disputes、fixtureRequests、notes。`

const FIX_LINT = (b, det) => `${PRE}
你是自动化工程师。下面这些脚本没有通过静态检查 / 加载检查，请修复：
${b.cases.map((c) => `- ${c.id} → ${fileOf(c)}`).join('\n')}
错误：
${bullet(det.lintErrors.concat(det.listErrors).slice(0, 40))}
规则见 ${SK}/SKILL.md 第 1 节（lint 规则编号 L01–L21 的含义也在那里）。只改上面列出的文件；缺少 [En] 断言时补上断言，不要删掉 expected 对应的断言来凑数。
修完后运行 ${RUN} ${ids(b.cases)} --lint-only，直到通过。
结构化输出：written（修改过的文件）、disputes、fixtureRequests、notes。`

const lintCheck = (b, round) => runner(`${RUN} ${ids(b.cases)} --lint-only --json`,
  '命令会输出 summary JSON。转录：pass = steps.lint.pass && steps.list.pass（缺少哪个就当作 false）；lintErrors = steps.lint.errors（最多 40 条，每条截断到 300 字）；listErrors = steps.list.errors（最多 20 条）；warnings = steps.lint.warnings（最多 15 条）。',
  S_LINTRUN, `静态检查·${b.key}#${round}`, P2)

async function authorAndLint(b) {
  const out = await agent(AUTHOR(b), { label: `编写·${b.key}`, phase: P2, schema: S_AUTHOR })
  if (out) {
    summary.written.push(...(out.written || []))
    summary.disputes.push(...(out.disputes || []))
    summary.fixtureRequests.push(...(out.fixtureRequests || []))
  }
  for (let round = 1; round <= MAX_FIX; round++) {
    const det = await lintCheck(b, round)
    if (det && det.pass) return { key: b.key, pass: true, rounds: round, warnings: det.warnings || [] }
    if (round === MAX_FIX) return { key: b.key, pass: false, rounds: round, errors: det ? det.lintErrors.concat(det.listErrors) : ['执行器没有返回结果'] }
    await agent(FIX_LINT(b, det || { lintErrors: ['执行器没有返回结果，请自行运行 lint'], listErrors: [] }), { label: `修复静态问题·${b.key}#${round}`, phase: P2, schema: S_AUTHOR })
  }
}

if (toWrite.length) {
  phase(P2)
  const batches = batchesOf(toWrite)
  log(`分成 ${batches.length} 批并行编写（每批最多 ${BATCH} 条）：${batches.map((b) => `${b.key}(${b.cases.length})`).join('，')}`)
  const lintResults = (await pipeline(batches, (b) => authorAndLint(b))).filter(Boolean)
  summary.lint.pass = lintResults.filter((r) => r.pass).map((r) => r.key)
  summary.lint.fail = lintResults.filter((r) => !r.pass).map((r) => ({ batch: r.key, errors: (r.errors || []).slice(0, 10) }))
  log(`静态检查：通过 ${summary.lint.pass.length} 批，未通过 ${summary.lint.fail.length} 批`)
}

if (MODE === 'draft') {
  phase(P5)
  return { status: summary.lint.fail.length ? 'incomplete' : 'success', summary }
}

// ============================================================ 阶段 3：执行验证（verify）
phase(P3)
const EXEC_TRANSCRIBE = '命令会输出 summary JSON。转录：pass = steps.run.pass（没有 steps.run 时为 false，并把 steps.lint.errors / steps.list.errors 的前 10 条放进 globalErrors）；globalErrors = steps.run.globalErrors（每条截断到 400 字）；cases = steps.run.cases 中的每一项：caseId、status、category / tags / hint / error 取 failures[0] 的同名字段（error 截断到 400 字；没有失败时留空），evidenceMissing = evidence.missing。'
const FIX_RUN = (cs, fails) => `${PRE}
你是自动化工程师兼分诊员。下面这些用例在真实产品上执行失败。逐条判断失败原因，**只修脚本自身的问题**：
${fails.map((f) => `- ${f.caseId}（${fileOf(cs.find((c) => c.id === f.caseId))}）[${f.category || '?'}] ${(f.tags || []).join(' ')}：${short(f.error, 300)}\n  提示：${short(f.hint, 200)}`).join('\n')}
方法（${SK}/references/failure-triage.md）：先看 evidence/<CaseID>/ 下的 api/*.json、server.log、screenshots/、extension.log、result.json，再对照用例 expected、api-contract / ui-contract 和脚本。按权威顺序 PROBLEM.md > PRD > 契约 > 用例 > 脚本 裁决：
- script_fixed：脚本写错了（取值路径、选择器、等待方式、流程顺序、前置数据）→ 修改脚本，然后运行 ${RUN} <CaseID> --port=${PORT} 确认通过；
- product_bug：产品不符合契约或用例 → 不改脚本，在 note 中写清楚 [En]、期望值、实际值，evidence 中写证据路径；
- dispute：用例与契约 / PRD 冲突 → 不改脚本，在 note 中引用双方原文；
- env：环境问题（端口、后端没起来）→ 不改脚本，说明原因。
禁止为了通过而删除或放宽断言、修改期望值、加 skip。只改上面列出的文件。
结构化输出：results（每条用例一项）。`

let execTargets = inv.cases.map((c) => c.id)
const bugIds = new Set()
const status = new Map() // caseId → 最近一次执行结果
for (let round = 1; round <= MAX_FIX && execTargets.length; round++) {
  const ex = await runner(`${RUN} ${execTargets.join(' ')} --port=${PORT} --json`, EXEC_TRANSCRIBE, S_EXEC, `执行#${round}`, P3)
  if (!ex) { summary.notes.push(`第 ${round} 轮执行器没有返回结果`); break }
  for (const c of ex.cases) status.set(c.caseId, c.status)
  const fails = ex.cases.filter((c) => c.status !== 'pass' && !bugIds.has(c.caseId))
  log(`第 ${round} 轮执行：${ex.cases.length - fails.length}/${ex.cases.length} 通过${(ex.globalErrors || []).length ? `；全局错误：${short(ex.globalErrors[0], 160)}` : ''}`)
  const envFails = fails.filter((f) => f.category === 'ENV')
  if (envFails.length && envFails.length === fails.length) { summary.envIssues.push(...envFails.map((f) => `${f.caseId}：${short(f.error, 200)}`), ...(ex.globalErrors || [])); log('⛔ 全部失败都是环境问题，停止修复（先修环境，再重新运行 verify）'); break }
  if (!fails.length) break
  const byBatch = batchesOf(inv.cases.filter((c) => fails.some((f) => f.caseId === c.id)))
  const fixOuts = (await parallel(byBatch.map((b) => () => agent(FIX_RUN(b.cases, fails.filter((f) => b.cases.some((c) => c.id === f.caseId))), { label: `分诊修复·${b.key}#${round}`, phase: P3, schema: S_FIX })))).filter(Boolean)
  const results = fixOuts.flatMap((o) => o.results || [])
  for (const r of results) {
    if (r.verdict === 'product_bug') { bugIds.add(r.caseId); summary.productBugs.push({ caseId: r.caseId, note: r.note, evidence: r.evidence || '' }) }
    if (r.verdict === 'dispute') summary.disputes.push({ caseId: r.caseId, reason: r.note })
    if (r.verdict === 'env') summary.envIssues.push(`${r.caseId}：${r.note}`)
  }
  execTargets = results.filter((r) => r.verdict === 'script_fixed').map((r) => r.caseId)
  log(`第 ${round} 轮分诊：修复脚本 ${execTargets.length} 条，产品缺陷 ${results.filter((r) => r.verdict === 'product_bug').length} 条，争议 ${results.filter((r) => r.verdict === 'dispute').length} 条`)
}

summary.run = { total: status.size, passed: [...status.values()].filter((x) => x === 'pass').length, failing: [...status.entries()].filter(([, x]) => x !== 'pass').map(([id]) => id) }

// ============================================================ 阶段 4：断言有效性（verify）
phase(P4)
const MUT_TRANSCRIBE = '命令会输出 summary JSON。转录 steps.mutation：killRate（为 null 时填 -1）、killed、applicable；rows 中的每一项：caseId、baseline、killRate（为 null 时填 -1）、survived。没有 steps.mutation 或者其中只有 skipped 字段时，rows 为空数组，并把 skipped 的内容放进 error。'
const STRENGTHEN = (cs, rows) => `${PRE}
你是自动化工程师。下面这些用例的断言没能杀死部分响应变异（说明断言没有约束住对应的属性）。请补强断言：
${rows.map((r) => `- ${r.caseId}（${fileOf(cs.find((c) => c.id === r.caseId))}）存活的算子：${r.survived.join(', ')}`).join('\n')}
算子含义与补强方式见 ${SK}/references/assertion-cookbook.md §4，以及 ${SK}/assets/fixtures/mutation.mjs 中的 OP_DESC。
规则：补充的断言必须挂到对应的 [En] 上（这个属性确实属于该条 expected 的范围）；只有当这个属性不在本用例任何一条 expected 的范围内、并且由其他用例负责时，才写 // mutation-ignore: <算子> —— 理由（理由中写明由哪个用例负责）。不要修改期望值，不要删除断言。
补强后运行 ${RUN} <这些 Case ID> --mutation --port=${PORT}，确认存活的算子已经被杀死或者已经合理豁免，并且用例在正常执行下仍然通过。
结构化输出：results（每条用例一项：caseId、added = 新增断言数、ignored = 豁免的算子、note）。`

const passing = inv.cases.filter((c) => c.type !== 'UI' && status.get(c.id) === 'pass')
if (passing.length) {
  let targets = passing
  for (let round = 1; round <= MAX_FIX && targets.length; round++) {
    const mt = await runner(`${RUN} ${ids(targets)} --mutation --min-kill=${MIN_KILL} --port=${PORT} --json`, MUT_TRANSCRIBE, S_MUT, `变异检查#${round}`, P4)
    if (!mt) break
    if (round === 1) summary.mutation = { killRate: mt.killRate, killed: mt.killed, applicable: mt.applicable }
    const weak = (mt.rows || []).filter((r) => r.baseline === 'pass' && r.survived.length)
    log(`第 ${round} 轮变异检查：杀死率 ${mt.killRate < 0 ? '-' : (mt.killRate * 100).toFixed(1) + '%'}，有存活变异的用例 ${weak.length} 条`)
    summary.mutation.last = { round, killRate: mt.killRate, weak: weak.map((r) => `${r.caseId}：${r.survived.join(',')}`) }
    if (!weak.length) break
    if (round === MAX_FIX) break
    const byBatch = batchesOf(inv.cases.filter((c) => weak.some((r) => r.caseId === c.id)))
    await parallel(byBatch.map((b) => () => agent(STRENGTHEN(b.cases, weak.filter((r) => b.cases.some((c) => c.id === r.caseId))), { label: `补强断言·${b.key}#${round}`, phase: P4, schema: S_STRENGTHEN })))
    targets = inv.cases.filter((c) => weak.some((r) => r.caseId === c.id))
  }
} else {
  log('没有可做变异检查的 API / E2E 用例（UI 用例不参与变异检查）')
}

// ============================================================ 阶段 5：锁定完整性与汇总
phase(P5)
const dg = await runner(`${V} digest`, '读取 .workflow/reports/validate-digest.json：hasLock = warnings 中没有出现「测试尚未锁定」；pass、digest 原样转录；changed / added / removed 取 stats.tamper 中的同名数组（没有就填空数组）。', S_DIGEST, '测试锁检查', P5)
if (dg && dg.hasLock && !dg.pass) {
  const rv = await agent(`${PRE}
你是测试完整性审查员：只读，不修改任何文件。锁定后的测试脚本在本次 workflow 中被修改过。变更列表：changed=${JSON.stringify(dg.changed || [])}，added=${JSON.stringify(dg.added || [])}，removed=${JSON.stringify(dg.removed || [])}。对每个变更文件执行 diff -u .workflow/locks/snapshot/<file> <file>（新增文件直接阅读全文）。
允许的修改：选择器（必须是 ui-contract 中登记的 testId）、等待方式、前置步骤、流程顺序、新增断言、带理由的 mutation-ignore、新增 [En] 标签。
不允许：删除、放宽或弱化与用例 expected 对应的断言；修改期望值去迎合实现；条件跳过；吞掉异常；skip。
输出：approved（全部合规时为 true）；violations（不合规的文件、涉及的 caseIds、原因）。`, { label: '测试完整性审查', phase: P5, schema: S_INTEGRITY, effort: 'high' })
  const violations = (rv && rv.violations) || []
  if (violations.length) {
    log(`⚠️ ${violations.length} 处测试修改不合规，已还原：${violations.map((v) => v.file).join(', ')}`)
    await runner(`${V} restore --file=${violations.map((v) => v.file).join(',')}`, '读取 .workflow/reports/validate-restore.json：hasLock=true，pass 原样转录，changed / added / removed 填空数组。', S_DIGEST, '还原违规修改', P5)
    summary.notes.push(...violations.map((v) => `已还原 ${v.file}：${v.reason}`))
  }
  const lk = await runner(`${V} lock`, '读取 .workflow/reports/validate-lock.json：hasLock=true，pass、digest 原样转录，changed / added / removed 填空数组。', S_DIGEST, '重新锁定', P5)
  summary.digest = lk && lk.digest
  log(`🔒 测试已重新锁定（${String(summary.digest || '').slice(0, 12)}）。继续运行大 workflow 时，请把新的 digest 作为 args.digest 传入`)
} else if (dg && dg.hasLock) {
  summary.digest = dg.digest
}

const ok = !summary.lint.fail.length && !summary.envIssues.length && (!summary.mutation || !summary.mutation.last || summary.mutation.last.killRate < 0 || summary.mutation.last.killRate >= MIN_KILL)
return { status: ok ? (summary.productBugs.length ? 'success_with_product_bugs' : 'success') : 'incomplete', summary }
