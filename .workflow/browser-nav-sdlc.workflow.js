export const meta = {
  name: 'browser-nav-sdlc',
  description: '浏览器导航助手 v3：PRD → 技术方案 → 用例设计 → 对齐评审与基线冻结（跨角色看板）→ 脚本 ∥ 按依赖开发 → TDD 闭环 → 真实安装冒烟 → 人工验收 → 代码冻结 → 提交打包预检',
  whenToUse: '在 题目_1_浏览器导航助手/浏览器导航助手 目录下，从需求到可交付（含真实安装验证与提交预检）',
  phases: [
    { title: '1 需求与PRD', detail: 'PM（nav-req-analysis）→ 校验 + 双评审 → 看板澄清（已通过校验时跳过生成）' },
    { title: '2 技术方案', detail: '前后端架构师并行 → 交叉评审（含测试设计 / 自动化视角）→ 契约定稿 → 模块依赖 → 看板澄清' },
    { title: '3 用例设计', detail: '按模块组并行设计 API / UI / E2E 用例；契约不清就提看板，不猜' },
    { title: '4 对齐与冻结', detail: '可执行性预检 ∥ 四方对齐评审 → 看板路由给负责人修订 → align 确定性校验 → 基线冻结' },
    { title: '5 脚本与开发', detail: '测试基建 + lead 骨架；各模块组脚本就绪后按依赖顺序开发（上游先行）；全局评审 → 锁定' },
    { title: '6 TDD闭环', detail: '门禁（含工具链 / 基线检查）→ 分诊 → 修复；全绿后 UI 探索（真实 popup）∥ 变异检查 → 真实安装冒烟' },
    { title: '7 交付验收', detail: 'README ∥ 质量报告 → 终检 → 交付验收 → 人工验收关卡 → 代码冻结 → 提交打包预检' },
  ],
}

// ============================================================ 配置
// 用法：Workflow({ scriptPath: '.workflow/browser-nav-sdlc.workflow.js', args: { from: 'design' } })
// args：from / to（prd | design | cases | align | build | dev | final；旧名 tests = cases）、engines（'claude' 时全部由 Claude 完成）、
//       testEngine（'worker' 时测试任务走 worker）、digest（续跑时传入测试锁摘要）、manualAccepted（人工验收完成后续跑时传 true）、
//       redoPrd（PRD 已通过校验时仍强制重做）、maxStageRounds、maxDevIterations、stallLimit、devConcurrency、smokeBrowser（chromium | all）
const ROOT = '.' // 项目根目录：请在仓库根目录启动 Workflow（也可改成本机绝对路径）
const V = 'node .workflow/validators/validate.mjs'
const RUN = 'node .agents/skills/nav-case-to-script/scripts/run-cases.mjs'
const A = args || {}
const STAGES = ['prd', 'design', 'cases', 'align', 'build', 'dev', 'final']
const stageIdx = (s) => STAGES.indexOf(s === 'tests' ? 'cases' : s)
const FROM = stageIdx(A.from || 'prd')
const TO = stageIdx(A.to || 'final')
const want = (s) => stageIdx(s) >= FROM && stageIdx(s) <= TO
const EXTERNAL = A.engines !== 'claude'
const MAX_ROUNDS = A.maxStageRounds || 3
const MAX_DEV_ITERS = A.maxDevIterations || 8
const STALL_LIMIT = A.stallLimit || 3
const DEV_CONCURRENCY = A.devConcurrency || 12
const SMOKE_BROWSER = A.smokeBrowser || 'chromium'
const P1 = '1 需求与PRD', P2 = '2 技术方案', P3 = '3 用例设计', P4 = '4 对齐与冻结', P5 = '5 脚本与开发', P6 = '6 TDD闭环', P7 = '7 交付验收'
const GROUPS_DEFAULT = [['SYNC'], ['RULE'], ['CTX'], ['RANK'], ['REC'], ['CLEAN'], ['DIAG'], ['PRIV'], ['INCR'], ['CACHE'], ['PERF'], ['MENU'], ['PERSIST'], ['DEMO']]
const ROLES = ['PM', 'BE', 'FE', 'ARCH', 'TEST', 'AUTO', 'DEV-BE', 'DEV-FE', 'HUMAN']

// ============================================================ Schema
const STR_ARR = { type: 'array', items: { type: 'string' } }
const S_PRODUCE = { type: 'object', properties: { summary: { type: 'string' }, files: STR_ARR, openQuestions: STR_ARR }, required: ['summary', 'files'] }
const S_CHECK = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' }, digest: { type: 'string' }, tampered: { type: 'boolean' },
    errors: STR_ARR, warnings: STR_ARR, modules: STR_ARR,
    run: { type: 'object', properties: {
      total: { type: 'number' }, passed: { type: 'number' }, failed: { type: 'number' },
      casesTotal: { type: 'number' }, casesPassed: { type: 'number' }, globalErrors: STR_ARR,
      failing: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, project: { type: 'string' } }, required: ['caseId', 'project'] } },
    } },
  },
  required: ['pass', 'errors', 'warnings'],
}
const S_REVIEW = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' }, summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, owner: { type: 'string' },
      target: { type: 'string' }, problem: { type: 'string' }, suggestion: { type: 'string' },
    }, required: ['severity', 'owner', 'target', 'problem', 'suggestion'] } },
  },
  required: ['pass', 'summary', 'issues'],
}
const S_WORK = {
  type: 'object',
  properties: {
    engine: { type: 'string' }, sessionId: { type: 'string' }, summary: { type: 'string' }, changedFiles: STR_ARR,
    selfTest: { type: 'object', properties: { command: { type: 'string' }, passed: { type: 'number' }, failed: { type: 'number' } } },
    testDisputes: { type: 'array', items: { type: 'object', properties: { caseId: { type: 'string' }, reason: { type: 'string' }, evidence: { type: 'string' } }, required: ['caseId', 'reason'] } },
    blockedBy: STR_ARR, openQuestions: STR_ARR, boardItems: STR_ARR,
  },
  required: ['engine', 'summary', 'changedFiles'],
}
const S_TRIAGE = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: {
    caseId: { type: 'string' }, module: { type: 'string' },
    owner: { type: 'string', enum: ['BE', 'FE', 'BE_CORE', 'FE_CORE', 'UI_SCRIPT_SUSPECT', 'API_TEST_SUSPECT'] },
    rootCause: { type: 'string' }, fixHint: { type: 'string' },
  }, required: ['caseId', 'module', 'owner', 'rootCause', 'fixHint'] } } },
  required: ['items'],
}
const S_EXPLORE = {
  type: 'object',
  properties: {
    results: { type: 'array', items: { type: 'object', properties: {
      caseId: { type: 'string' }, verdict: { type: 'string', enum: ['pass', 'product_bug', 'script_stale'] },
      observed: { type: 'string' }, solidified: { type: 'boolean' }, bugReport: { type: 'string' },
    }, required: ['caseId', 'verdict', 'observed', 'solidified'] } },
    notes: { type: 'string' },
  },
  required: ['results'],
}
const S_INTEGRITY = {
  type: 'object',
  properties: { approved: { type: 'boolean' }, violations: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, caseIds: STR_ARR, reason: { type: 'string' } }, required: ['file', 'reason'] } }, notes: { type: 'string' } },
  required: ['approved', 'violations'],
}
const S_ARBITER = {
  type: 'object',
  properties: { decisions: { type: 'array', items: { type: 'object', properties: {
    caseId: { type: 'string' }, verdict: { type: 'string', enum: ['test_wrong', 'code_wrong', 'doc_conflict'] },
    owner: { type: 'string' }, fixHint: { type: 'string' }, changedFiles: STR_ARR,
  }, required: ['caseId', 'verdict', 'fixHint'] } } },
  required: ['decisions'],
}
const S_BOARD = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' }, errors: STR_ARR,
    open: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' }, to: { type: 'string' }, from: { type: 'string' }, blocking: { type: 'boolean' },
      stage: { type: 'string' }, type: { type: 'string' }, target: { type: 'string' }, question: { type: 'string' },
    }, required: ['id', 'to', 'blocking'] } },
  },
  required: ['pass', 'open', 'errors'],
}
const S_MODULES = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' }, errors: STR_ARR,
    modules: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, dependsOn: STR_ARR }, required: ['id', 'dependsOn'] } },
    layers: { type: 'array', items: STR_ARR },
  },
  required: ['pass', 'modules', 'errors'],
}

// ============================================================ 公共片段
const PRE = `【项目根目录】${ROOT}（所有相对路径都相对它；执行命令前先 cd 到这里）
【必读】AGENTS.md、.workflow/CONVENTIONS.md（重点 §2 追溯规则、§5 测试配方、§6 TDD 纪律、§7 上下文管理、§9 端口、§10 跨角色看板）。
【真相源】PROBLEM.md、resource.json（只读）。
【禁止】修改 .workflow/ 下除 .workflow/context/** 以外的任何文件；修改 .agents/skills/**、specs/**（工具链已锁定，改动会被还原并记为违规）；可以运行 ${V} <stage> 自检。
【跨角色沟通】需要其他角色澄清或修改时（接口字段 / 错误码不清、契约与方案冲突、testId 缺失、AC 有歧义、上游模块未实现……），不要猜，也不要只写在 journal 或 openQuestions 里：在 docs/trace/board/ 新建一条看板记录 B-<你的任务键>-<两位序号>.json（格式见 docs/trace/board/README.md），写清 to、target、refs、question、blocking。分配给你的看板记录处理完后，把 status 改为 answered / accepted / rejected / wontfix，并填写 resolution、resolvedBy、changedFiles。
【上下文纪律】先读任务指定的上下文包 .workflow/context/packs/<MOD>.md；需要原文时用 ${V} q <ID> 或按行号区间读取；测试输出只看摘要，细节去 evidence/<CaseID>/ 看。
【语言】文档用中文，代码标识符用英文。`

const REVIEW_TAIL = `
输出要求：issues 每条包含 severity（blocker / major / minor）、owner、target（文件 / ID / 章节）、problem、suggestion。只报告真实存在、可以直接据此修改的问题，不要凑数。没有 blocker 和 major 时 pass=true。`

const bullet = (arr) => (arr || []).map((x) => `- ${x}`).join('\n')
const fmtIssues = (issues) => (issues || []).map((i) => `- [${i.severity}][${i.owner || '-'}] ${i.target}：${i.problem} → 建议：${i.suggestion}`).join('\n')
function fmtFeedback(fb) {
  if (!fb) return ''
  return `
【上一轮（第 ${fb.round} 轮）校验未通过。请在现有文件上修订：不要推倒重写，不要改动已通过部分的 ID】
${fb.deterministic.length ? '确定性校验错误（必须全部修复）：\n' + bullet(fb.deterministic.slice(0, 60)) : ''}
${fb.review.length ? '评审问题（blocker / major 必须处理；不同意的写进 openQuestions 并说明理由）：\n' + fmtIssues(fb.review) : ''}
修订后先运行对应的 validator，确认通过再结束。`
}

const summary = { stages: {}, openQuestions: [], warnings: [], engines: {}, needsHuman: [] }
const sessions = {}
let digest = A.digest || ''
let devIter = 0
let GROUPS = GROUPS_DEFAULT
let MODULE_DEPS = new Map()
const LEAD_FIX = { BE: [], FE: [] }

function limiter(n) {
  let active = 0; const queue = []
  const next = () => { if (active >= n || !queue.length) return; active++; const { fn, res, rej } = queue.shift(); fn().then(res, rej).finally(() => { active--; next() }) }
  return (fn) => new Promise((res, rej) => { queue.push({ fn, res, rej }); next() })
}
const devLimit = limiter(DEV_CONCURRENCY)
const gKey = (g) => g.join('+')
const groupOf = (mod) => GROUPS.findIndex((g) => g.includes(mod))

// ============================================================ 校验执行器（确定性）
async function check(cmd, reportName, label, ph, copyTo) {
  const r = await agent(`${PRE}
你是「确定性校验执行器」：只执行命令、如实转录结果。不做主观判断，不修改任何项目文件。
1. 执行（Bash 的 timeout 设为 600000；预计超过 10 分钟就用 run_in_background 运行并等它结束）：
   cd "${ROOT}" && ${cmd}
   退出码非 0 表示校验未通过，属于正常情况。多条命令（用 ; 分隔）时逐条执行。
2. 读取 .workflow/reports/validate-${reportName}.json${copyTo ? `，然后执行 cp .workflow/reports/validate-${reportName}.json ${copyTo}` : ''}；多条命令时还要读取每条命令各自的报告（validate-<该命令的 stage>.json）并合并：任一报告 pass=false 则 pass=false，errors 合并时在每条前加上「[<stage>] 」前缀。
3. 按 schema 原样转录：pass、digest（没有则为空字符串）、tampered（任一报告的 tampered 为 true 时为 true）、modules（报告中 modules 与 sharedModules 的并集）、errors（最多 60 条，每条截断到 300 字）、warnings（最多 10 条）；报告有 run 字段时转录计数、globalErrors，以及 failures 中每条的 { caseId（null 填 "-"）, project } 放进 failing。
命令本身崩溃（不是校验失败）时：pass=false，把崩溃输出放进 errors。`, { label, phase: ph, schema: S_CHECK, effort: 'low' })
  return r || { pass: false, errors: ['校验执行器没有返回结果'], warnings: [] }
}

async function review(prompt, label, ph) {
  return agent(`${PRE}
你是评审员：只读，不修改项目文件（唯一例外：发现需要其他角色处理的阻塞问题时，可以在 docs/trace/board/ 新建看板记录）。
${prompt}
${REVIEW_TAIL}`, { label, phase: ph, schema: S_REVIEW, effort: 'high' })
}

// ============================================================ 外部引擎调度（AGENTS.md：开发 → codex gpt-6.1-sol max；测试 → worker）
function engineSteps(kind, key) {
  const sid = sessions[key] && sessions[key].sessionId
  const eng = sessions[key] && sessions[key].engine
  const prompt = `先完整阅读 .workflow/context/briefs/${key}.md，然后完成其中的任务，按「完成定义」逐条自检后汇报。`
  if (kind === 'dev' || A.testEngine !== 'worker') {
    return `首选 codex（gpt-6.1-sol，推理强度 max）：
   ${sid && eng === 'codex'
    ? `续聊已有会话：codex exec resume ${sid} -c model_reasoning_effort='"max"' --skip-git-repo-check -o .workflow/context/handoff/${key}.md "${prompt}（这是续聊：先读简报里的「本轮任务」）" > .workflow/context/logs/${key}.log 2>&1`
    : `codex exec -m gpt-6.1-sol -c model_reasoning_effort='"max"' --skip-git-repo-check --sandbox danger-full-access -C "${ROOT}" -o .workflow/context/handoff/${key}.md "${prompt}" > .workflow/context/logs/${key}.log 2>&1`}
   会话 id 在日志里：grep -m1 'session id:' .workflow/context/logs/${key}.log。
   备选：traecli exec（模型 GPT-6.1-Sol；先用 traecli exec --help 确认参数）。`
  }
  return `首选 worker（Claude Code CLI 无头模式）：
   /bin/zsh -c 'cd "${ROOT}" && claude -p ${sid && eng === 'worker' ? `--resume ${sid} ` : ''}--output-format json "${prompt}"' > .workflow/context/logs/${key}.json 2> .workflow/context/logs/${key}.err
   stdout 是一个 JSON：result（最终答复）、session_id（续聊用）、is_error。`
}

async function work({ kind, key, brief, label, phase: ph, dod }) {
  const tail = `
【完成定义】
${bullet(dod)}
【收尾】覆盖重写 .workflow/context/journal/${key}.md（≤ 60 行：当前状态 / 关键决策 / 坑 / 待办），下一轮接手的人只看它和上下文包就能继续。需要其他角色处理的事项必须写成看板记录（docs/trace/board/），journal 只记录你自己的状态。`
  let out
  if (!EXTERNAL) {
    out = await agent(`${PRE}\n${brief}\n${tail}\n结构化输出：engine 填 "claude"，以及 summary、changedFiles、selfTest、testDisputes、blockedBy、openQuestions、boardItems（本次新建的看板记录 ID）。`, { label, phase: ph, schema: S_WORK })
  } else {
    out = await agent(`${PRE}
你是「调度与验收者」。${kind === 'dev' || A.testEngine !== 'worker' ? '任务交给 codex（gpt-6.1-sol，max）执行' : '测试任务交给 worker（claude -p）执行'}；你负责派发和验收。除非所有外部引擎都不可用，否则不要亲自写代码、用例或脚本。
任务键：${key}
步骤：
1. 把下面【任务简报】和【完成定义】【收尾】原样写入 .workflow/context/briefs/${key}.md（覆盖写；若是续聊，在文件开头加一节「本轮任务」），并把 PRE 中的【跨角色沟通】【禁止】两条规则一并写进简报。
2. 派发：${engineSteps(kind, key)}
   用 Bash 的 run_in_background 启动；用 Monitor 工具（通过 ToolSearch 加载）等待进程结束，不要前台 sleep 轮询。单次最长 45 分钟。
   【超时切换】日志和目标产物连续 10 分钟没有任何变化，或日志出现中断 / 401 / 429 持续失败：立即 kill 该进程，换下一个引擎（codex → Claude 亲自完成），不要等待自动接力。
3. 验收：亲自逐条执行【完成定义】中的命令，不要只信引擎的自述。不达标时把具体失败信息作为新一轮提示续聊同一会话（最多 3 次）。
4. 引擎不可用（未登录、网络、持续 429、无输出）时按顺序换下一个引擎；全部不可用时由你亲自完成，engine 填 "claude"。
5. 把 { engine, sessionId, turns } 写入 .workflow/context/sessions/${key}.json；确认 journal 已更新（没有就由你补写）。
【任务简报】
${brief}
${tail}
结构化输出：engine（codex / traecli / worker / claude）、sessionId、summary、changedFiles、selfTest、testDisputes、blockedBy、openQuestions、boardItems。`, { label, phase: ph, schema: S_WORK, effort: 'medium' })
  }
  if (out) {
    if (out.sessionId) sessions[key] = { engine: out.engine, sessionId: out.sessionId }
    summary.engines[out.engine || '?'] = (summary.engines[out.engine || '?'] || 0) + 1
    if (out.openQuestions && out.openQuestions.length) summary.openQuestions.push(...out.openQuestions.map((q) => `[${key}] ${q}`))
  }
  return out || { engine: 'none', summary: 'agent 未返回', changedFiles: [], testDisputes: [], blockedBy: [] }
}

// 通用阶段循环：产出 → 确定性校验 →（通过后）多视角评审 → 不通过带反馈重做
async function stageLoop({ key, ph, cmd, report, produce, reviewers }) {
  let fb = null, last = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    await produce(fb, round)
    const det = await check(cmd, report, `校验·${key}#${round}`, ph)
    if (!det.pass) {
      log(`[${key}] 第 ${round} 轮确定性校验未通过：${det.errors.length} 个错误，例如：${(det.errors[0] || '').slice(0, 120)}`)
      fb = { round, deterministic: det.errors, review: [] }
      last = { det, issues: [] }
      continue
    }
    const prev = round > 1 ? ((last && last.issues) || []) : []
    const incr = prev.length ? `\n【增量评审】这是复审。先逐条核实以下上一轮问题是否已解决（未解决的原样再报）；除此之外只报告新的 blocker，以及会直接导致前后端实现冲突或测试无法执行的新 major。\n${fmtIssues(prev)}` : ''
    const revs = (reviewers || []).length ? await parallel(reviewers.map((rv) => () => review(rv.prompt + incr, `${rv.label}#${round}`, ph))) : []
    const issues = revs.filter(Boolean).flatMap((r) => r.issues || [])
    const blocking = issues.filter((i) => i.severity !== 'minor')
    log(`[${key}] 第 ${round} 轮：确定性校验通过；评审 blocker/major ${blocking.length}，minor ${issues.length - blocking.length}`)
    if (!blocking.length) return { pass: true, rounds: round, det, minor: issues }
    fb = { round, deterministic: [], review: blocking }
    last = { det, issues: blocking }
  }
  const blockers = (last && last.issues || []).filter((i) => i.severity === 'blocker')
  if (last && last.det && last.det.pass && !blockers.length) {
    log(`⚠️ [${key}] ${MAX_ROUNDS} 轮后仍有 ${last.issues.length} 个 major；确定性校验已通过，带风险继续`)
    summary.warnings.push(...last.issues.map((i) => `[${key}] ${i.target}：${i.problem}`))
    return { pass: true, degraded: true, rounds: MAX_ROUNDS, det: last.det, residual: last.issues }
  }
  return { pass: false, rounds: MAX_ROUNDS, residual: last }
}

function halt(stage, r, extra) {
  log(`⛔ 阶段 ${stage} 未能通过，流程中止。修复后用 args.from='${stage}' 重跑，或用 resumeFromRunId 续跑。`)
  return { status: 'halted', stage, residual: r && r.residual, ...(extra || {}), needsHuman: summary.needsHuman, summary }
}

// ============================================================ 跨角色看板：路由给负责人，收敛到没有阻塞项
async function boardList(tag, ph, freeze) {
  const r = await agent(`${PRE}
你是「确定性校验执行器」：只执行命令、如实转录，不修改任何文件。
执行：cd "${ROOT}" && ${V} board --list${freeze ? ` --freeze=${freeze}` : ''} --brief（退出码非 0 属于正常情况）
读取 .workflow/reports/validate-board.json，按 schema 转录：pass；errors（最多 40 条，每条截断到 300 字）；open = board.open 原样转录（question 截断到 300 字，最多 80 条）。`, { label: `看板·${tag}`, phase: ph, schema: S_BOARD, effort: 'low' })
  return r || { pass: false, open: [], errors: ['看板执行器没有返回结果'] }
}

const OWNER_SCOPE = {
  PM: `你是 PM（.agents/skills/nav-req-analysis/SKILL.md）。你负责 docs/01-需求理解.md、docs/02-PRD.md、docs/trace/requirements.json、docs/trace/features.json：ID 与已发布的 AC 编号不变，只能追加或修改文字与取值。改完运行 ${V} prd --brief。`,
  BE: `你是后端技术负责人（specs/backend.spec.md）。你负责 docs/03-技术方案-后端.md、docs/trace/api-contract.json、docs/trace/code-points-be.json、docs/trace/modules.json；契约变更写进 docs/03 的「契约变更记录」。改完运行 ${V} design --brief。`,
  FE: `你是前端技术负责人（specs/frontend.spec.md）。你负责 docs/04-技术方案-前端.md、docs/trace/ui-contract.json、docs/trace/code-points-fe.json，并且必须与 api-contract.json 对齐。改完运行 ${V} design --brief。`,
  ARCH: `你是系统架构师。你负责 docs/05-系统架构.md；涉及前后端冲突时按 PROBLEM.md > PRD > 契约 裁决，并给 BE / FE 新建看板记录落实修改。`,
  TEST: `你是测试设计（.agents/skills/nav-test-case-design/SKILL.md）。你负责用例分片 docs/trace/cases/*.json 与 docs/cases/*.md（改完运行 ${V} cases --brief，会自动合并）。用例改动时同步给 AUTO 新建看板记录，说明要改哪些脚本的哪些 [En]。`,
  AUTO: `你是自动化工程师（.agents/skills/nav-case-to-script/SKILL.md）。你负责 tests/{api,e2e,ui}/<CaseID>.spec.mjs；测试已锁定时只能按 CONVENTIONS §6 的允许范围修改，并且会经过完整性审查。`,
  'DEV-BE': `你是后端开发（specs/backend.spec.md），负责 server/、scripts/、resources/。`,
  'DEV-FE': `你是插件前端开发（specs/frontend.spec.md），负责 extension/。`,
}

const OWNER_RULES = `处理要求：
1. 澄清类（clarify）：把问题在你负责的文档里写清楚（字段、取值、错误码、示例、时间基准），再在记录中回答。
2. 变更 / 冲突 / 阻塞类（change / conflict / blocker）：按权威顺序 PROBLEM.md > PRD / features > 契约 > 用例 > 脚本 裁决；接受就修改你负责的文件（status=accepted），不接受写明理由（rejected / wontfix）。
3. 影响分析：你的修改会影响其他角色时（例如契约字段变了 → TEST 与 AUTO；AC 变了 → TEST；ui-contract 变了 → TEST 与 AUTO），为每个受影响的角色新建一条看板记录（type=change，refs 写清变化的 ID），不要替别人改他们的文件。
4. 每条记录都要更新 status、resolution（做了什么、为什么）、resolvedBy（你的角色与任务键）、changedFiles。
5. 只改你负责的文件；完成后运行对应的 validator 自检，并运行 ${V} board --brief 确认记录格式正确。`

async function dispatchOwner(role, items, round, ph, extraErrors) {
  const list = (items || []).map((i) => `- ${i.id}（来自 ${i.from || '?'}，${i.blocking ? '阻塞' : '非阻塞'}，${i.type || '-'}）${i.target || ''}：${i.question || ''}`).join('\n')
  const brief = `${OWNER_SCOPE[role] || ''}
${list ? `以下看板记录分配给你（逐条阅读 docs/trace/board/<ID>.json 原文，以及 refs 指向的文档）：\n${list}` : ''}
${extraErrors && extraErrors.length ? `以下确定性对齐错误属于你负责的文件，请修复（根因在别的角色的文件时，给对方新建看板记录，不要改别人的文件）：\n${bullet(extraErrors.slice(0, 50))}` : ''}
${OWNER_RULES}`
  const label = `看板·${role}#${round}`
  if (role === 'PM' || role === 'BE' || role === 'FE' || role === 'ARCH') {
    return agent(`${PRE}\n${brief}\n结构化输出：summary、files、openQuestions。`, { label, phase: ph, schema: S_PRODUCE })
  }
  const kind = role.startsWith('DEV') ? 'dev' : 'test'
  return work({ kind, key: `board-${role}`, label, phase: ph, brief,
    dod: ['分配给你的看板记录全部不再是 open，并填写了 resolution / resolvedBy / changedFiles', `${V} board --brief 没有格式错误`] })
}

async function resolveBoard(tag, ph, { freeze, maxRounds = MAX_ROUNDS } = {}) {
  for (let round = 1; round <= maxRounds; round++) {
    const b = await boardList(`${tag}#${round}`, ph, null)
    const open = (b.open || []).filter((i) => String(i.to || '').toUpperCase() !== 'HUMAN')
    if (!open.length) break
    const byRole = new Map()
    for (const i of open) {
      const role = ROLES.includes(String(i.to || '').toUpperCase()) ? String(i.to).toUpperCase() : 'ARCH'
      if (!byRole.has(role)) byRole.set(role, [])
      byRole.get(role).push(i)
    }
    log(`看板 ${tag} 第 ${round} 轮：${open.length} 条待处理（${[...byRole.entries()].map(([r, l]) => `${r} ${l.length}`).join('，')}）`)
    await parallel([...byRole.entries()].map(([role, items]) => () => dispatchOwner(role, items, round, ph)))
  }
  const last = await boardList(`${tag}·冻结检查`, ph, freeze)
  const human = (last.open || []).filter((i) => String(i.to || '').toUpperCase() === 'HUMAN')
  for (const i of human) if (!summary.needsHuman.includes(`${i.id}：${i.question || ''}`)) summary.needsHuman.push(`${i.id}：${i.question || ''}`)
  const blocking = (last.open || []).filter((i) => i.blocking)
  if (blocking.length) log(`⚠️ 看板 ${tag}：仍有 ${blocking.length} 条阻塞项未解决（${blocking.slice(0, 5).map((i) => i.id).join(', ')}）`)
  return { pass: last.pass && !blocking.length, blocking, open: last.open || [], errors: last.errors || [] }
}

// 确定性错误按文件归属路由给负责人
function routeErrors(errors) {
  const byRole = new Map()
  const add = (role, e) => { if (!byRole.has(role)) byRole.set(role, []); byRole.get(role).push(e) }
  for (const e of errors || []) {
    if (/api-contract|docs\/03|code-points-be|modules\.json|\[align:contract\]/.test(e)) add('BE', e)
    else if (/ui-contract|docs\/04|code-points-fe|\[align:fe-be\]/.test(e)) add('FE', e)
    else if (/tests\/(?:api|e2e|ui)\//.test(e)) add('AUTO', e)
    else if (/TC-(?:API|E2E|UI)-|docs\/trace\/cases|docs\/cases|cases-(?:api|ui)\.json|\[align:cases/.test(e)) add('TEST', e)
    else if (/features\.json|requirements\.json|docs\/0[12]|\bREQ-\d|#AC\d/.test(e)) add('PM', e)
    else if (/docs\/trace\/board/.test(e)) add('ARCH', e)
    else add('ARCH', e)
  }
  return byRole
}

// 基线冻结之后，上游产物的每处修改都必须有已接受的变更请求；没有就让修改方补登记并通知受影响角色
async function enforceBaseline(tag, ph) {
  for (let round = 1; round <= 2; round++) {
    const bl = await check(`${V} baseline --check --brief`, 'baseline', `基线检查·${tag}#${round}`, ph)
    if (bl.pass) return true
    const byRole = routeErrors(bl.errors)
    log(`基线检查 ${tag}：${bl.errors.length} 处未经变更请求的上游修改，要求修改方补登记`)
    await parallel([...byRole.entries()].map(([role, errs]) => () => dispatchOwner(role, [], `基线${round}`, ph,
      errs.map((e) => `${e} —— 基线冻结后修改上游产物必须有 status=accepted、type=change 的看板记录（refs 覆盖变化的 ID 或文件），并为受影响的角色新建 change 记录；修改不合理就撤回`))))
    await resolveBoard(`${tag}·变更`, ph, { maxRounds: 1 })
  }
  const fin = await check(`${V} baseline --check --brief`, 'baseline', `基线检查·${tag}·终`, ph)
  if (!fin.pass) summary.warnings.push(`[基线] ${tag}：仍有未登记的上游修改：${fin.errors.slice(0, 3).join('；')}`)
  return fin.pass
}

// ============================================================ 启动：锁定工具链（技能、规范、CONVENTIONS、validator、workflow）
if (A.recordToolchain !== false) {
  await check(`${V} toolchain --record --brief`, 'toolchain', '锁定工具链', FROM <= 0 ? P1 : P2)
}

// ============================================================ 测试基建
const INFRA = `你是测试基础设施工程师（nav-case-to-script 技能 §2「第 0 步：测试基建」）。只写下列文件，不写业务代码和用例脚本：
1. 根目录 package.json：type 为 module；devDependencies：@playwright/test 1.64.1、pngjs、gifenc、jpeg-js、c8、istanbul-lib-*；scripts：test、test:api、test:e2e、test:ui、test:case、start。执行 npm install；npx playwright --version；Chromium 不可用时 npx playwright install chromium（本机已缓存 chromium-1248）。
2. 从 .agents/skills/nav-case-to-script/assets/ 原样复制 playwright.config.mjs 到项目根目录，复制 fixtures/*.mjs 到 tests/fixtures/（入口固定为 server/src/index.js，不需要改 webServer.command）。
3. 建目录 tests/api、tests/e2e、tests/ui、tests/smoke、evidence/_runtime；写 scripts/test.sh（可执行：npx playwright test "$@"）和 tests/README.md（分层、端口约定、单独运行方法、真实安装冒烟）。
4. 运行 ${V} infra --brief，直到通过（此时没有用例脚本，0 个测试是正常的）。
结构化输出：summary、files。`

// ============================================================ 阶段 1：PRD
if (want('prd')) {
  phase(P1)
  const pre = A.redoPrd ? { pass: false } : await check(`${V} prd --brief`, 'prd', '预检·PRD', P1)
  if (pre.pass) {
    log('PRD 已通过校验，跳过生成（args.redoPrd=true 可强制重做）')
    summary.stages.prd = { pass: true, skipped: true }
  } else {
    const r = await stageLoop({
      key: 'PRD', ph: P1, cmd: `${V} prd --brief`, report: 'prd',
      produce: async (fb, round) => {
        await agent(`${PRE}\n你是 PM，按 .agents/skills/nav-req-analysis/SKILL.md 产出 / 修订 docs/01、docs/02、docs/trace/requirements.json、docs/trace/features.json。验收标准要写到「下游能直接写出断言」的程度：接口字段、可见文本、数量、顺序、时间基准；PRD 第 5 章写明 popup 的真实尺寸约束和首次安装（storage 为空）时的表现。${fmtFeedback(fb)}\n结构化输出：summary、files、openQuestions。`, { label: `PM·PRD#${round}`, phase: P1, schema: S_PRODUCE })
      },
      reviewers: [
        { label: '评审·需求覆盖', prompt: '对照 PROBLEM.md 逐条检查 docs/02-PRD.md、requirements.json、features.json：必做 1–7、总体约束、验收 1–10、交付物、选定进阶项是否都有 inScope Feature 承接；粒度是否到每个动作；layers 是否正确。owner 填 PM。' },
        { label: '评审·可测试性', prompt: '以测试设计者的身份检查每条 AC 能否直接写成自动化断言（Given/When/Then 与具体值）；第 13 章样例推演能否用 resource.json 复算（可运行 node docs/prototype/engine.js 核对）；首次安装、后端未启动、真实 popup 打开等真实使用路径是否有 AC。owner 填 PM。' },
      ],
    })
    summary.stages.prd = { pass: r.pass, rounds: r.rounds }
    if (!r.pass) return halt('prd', r)
  }
  const bd = await resolveBoard('PRD', P1, { freeze: 'prd' })
  if (!bd.pass) return halt('prd', null, { blocking: bd.blocking })
}

const infraP = want('build') ? agent(`${PRE}\n${INFRA}`, { label: '测试基建', phase: P5, schema: S_PRODUCE }) : Promise.resolve(null)

// ============================================================ 阶段 2：技术方案
const ARCH_COMMON = `代码点规划要求（并行开发依赖它）：
- 按模块所有权规划 files：每个业务模块有自己的文件；多个模块共用的文件（入口、app 组装、路由注册表、config、store、lib、manifest、消息总线、popup 外壳、api client、storage 封装）登记为 module=CORE 的代码点，由 lead 负责。
- 同一个文件不能同时出现在两个业务模块的代码点里（validator 会报 CONFLICT），需要时拆文件或交给 CORE。
- 路由 / 消息处理器采用「注册表 + 每模块一个文件」的结构，lead 预先注册所有模块文件，模块开发者只改自己的文件。
- 接口和界面写到下游能直接用的程度：每个接口给出请求 / 响应示例、全部错误码及对应状态码（同一错误只能有一个状态码）、时间基准覆盖参数；每个可交互或要断言的 UI 元素都有 testId 并说明各状态（加载 / 空 / 错误 / 离线）。写不清楚的地方不要留给下游猜。`

const BE_ARCH = `你是后端技术负责人（后端会话 agent），会话记忆写在 .workflow/context/journal/arch-BE.md（开工先读，结束覆盖重写）。
阅读 docs/02-PRD.md（按章节读）、docs/trace/features.json、specs/backend.spec.md（目录分层 BE-DIR、日志 BE-LOG、运行 BE-RUN 等必须遵守），从后端视角完成技术方案。
技术约束：Node.js v24 ESM，零运行时依赖（BE-DIR-03）；入口 server/src/index.js（BE-DIR-01）；内存存储 + 持久化方案说明。
可测试性（测试夹具依赖）：PORT / HOST；ENABLE_TEST_API=1 时启用 POST /api/__test__/reset 与只读的 GET /api/__test__/state（BE-RUN-02、BE-RUN-07）；LOG_FILE 同步追加 JSON 日志（BE-LOG-02）；回传 x-request-id（BE-LOG-03）；SIGTERM 正常退出（BE-RUN-03）；按 PRD 时间基准决策提供 now 覆盖；CORS 允许 chrome-extension://；持久化文件路径可以用环境变量指定（测试和冒烟不能写开发者正在用的数据文件）；样例导入脚本走真实 /api/sync。
${ARCH_COMMON}
产出：
1. docs/03-技术方案-后端.md：架构分层与目录；模块职责；数据模型与存储；API 设计（请求 / 响应示例、错误码与状态码、Code ID、Feature ID）；算法设计；性能（10 万条下推荐 100ms）；诊断；错误处理与日志；可测试性；文件所有权表；Code ID 清单表；**模块依赖与开发顺序**（哪些模块是关键路径、必须先做）。
2. docs/trace/code-points-be.json（30–60 个，所有 layers 含 BE 的 inScope Feature 至少被 1 个 C-BE 覆盖）。
3. docs/trace/api-contract.json：后端是契约 owner；字段名沿用 PROBLEM.md 的 camelCase，只增不减。
4. docs/trace/modules.json：{ modules: [{ id, sides, dependsOn: [], reason }] }（与前端协商，前端模块的依赖由前端在交叉评审后补充），用于按依赖顺序开发。
前端架构师正在并行设计插件端，稍后交叉评审。完成后运行 ${V} design --brief 自检（只修你负责的部分）。
结构化输出：summary、files、openQuestions。`

const FE_ARCH = `你是浏览器插件 / 前端技术负责人（前端会话 agent），会话记忆写在 .workflow/context/journal/arch-FE.md（开工先读，结束覆盖重写）。
阅读 docs/02-PRD.md（按章节读）、docs/trace/features.json、specs/frontend.spec.md（MV3、MSG、UI、CACHE、TEST 等必须遵守；特别是 FE-UI-07：popup 尺寸用固定 px，禁止视口单位）、docs/prototype/（交互原型），从插件端视角完成技术方案。
技术约束：MV3，原生 JS（ES modules），无构建步骤；popup 只做展示与交互，chrome.tabs / history、后端通信、隐私过滤、同步状态和缓存都在 background；popup ↔ background 走消息协议；状态持久化到 chrome.storage.local；遵守 MV3 CSP。
真实使用形态（必须在方案中写明）：真实 action popup 的视口由内容撑开（不是 tab），写明 popup 的固定尺寸；首次安装时 storage 为空的默认值与引导（后端未启动 / 地址不一致时怎么提示、怎么改地址）；popup 失焦即关闭时的状态保存。
可测试性（FE-TEST）：storage key apiBaseUrl、popup 路径 popup/popup.html；所有可交互 / 需要断言的元素都有 data-testid 并登记到 ui-contract；popup 以 tab 打开时「当前页面」必须排除插件自身页面；后端不可用时展示缓存并标注离线；历史读取显式传 startTime。
${ARCH_COMMON}
产出：
1. docs/04-技术方案-前端.md：插件结构与模块职责；manifest 权限及理由；popup 信息架构（ASCII 线框）与尺寸；首次安装流程；消息协议；background 流程；storage 结构；接口依赖与假设；错误与降级；诊断实现；可测试性；文件所有权表；Code ID 清单表。
2. docs/trace/code-points-fe.json（30–60 个，所有 layers 含 FE 的 inScope Feature 至少被 1 个 C-FE 覆盖）。
3. docs/trace/ui-contract.json（pages / elements / messages / storageKeys）。
后端架构师正在并行编写 api-contract.json：已存在就以它为准，不存在先按 PROBLEM.md 写，交叉评审时对齐。完成后运行 ${V} design --brief 自检（只修你负责的部分）。
结构化输出：summary、files、openQuestions。`

const FE_REVIEWS_BE = `你是前端技术负责人，以「接口消费方」视角评审 docs/03-技术方案-后端.md、api-contract.json、code-points-be.json，并与 docs/04 逐项比对：插件需要的接口和字段是否齐全、路径 / 方法 / 字段名 / 类型是否一致；错误格式；CORS / host_permissions；诊断数据；增量同步游标；隐私过滤责任划分；文件所有权是否支持并行开发；modules.json 的依赖是否合理。owner 填 BE 或 FE。`
const BE_REVIEWS_FE = `你是后端技术负责人，以「接口提供方 + 系统」视角评审 docs/04-技术方案-前端.md、ui-contract.json、code-points-fe.json：调用的接口 / 字段 / 参数是否与 api-contract 一致（逐个路径核对，不能有契约里不存在的路径）；同步请求体是否符合 PROBLEM.md；隐私过滤在发送前完成；离线降级；MV3 要点；可测试性；文件所有权。owner 填 FE 或 BE。`

const REVISE = (side, issues, fb) => `你是${side === 'BE' ? '后端' : '前端'}技术负责人（会话记忆：.workflow/context/journal/arch-${side}.md，开工先读，结束覆盖重写）。
请修订你负责的文件：${side === 'BE' ? 'docs/03-技术方案-后端.md、docs/trace/code-points-be.json、docs/trace/api-contract.json、docs/trace/modules.json（契约变更写进 03 的「契约变更记录」）' : 'docs/04-技术方案-前端.md、docs/trace/code-points-fe.json、docs/trace/ui-contract.json（与最终的 api-contract.json 完全对齐；补充前端模块在 modules.json 中的依赖需求时，给 BE 新建看板记录）'}。不要改对方的文件。
${issues && issues.length ? `交叉评审意见（owner=${side} 的必须处理；不同意的写进 openQuestions）：\n` + fmtIssues(issues) : ''}
${fmtFeedback(fb)}
完成后运行 ${V} design --brief 自检（只看你负责的部分）。
结构化输出：summary、files、openQuestions。`

const ARCH_DOC = (fb) => `你是系统架构师，产出 docs/05-系统架构.md（只写这一个文件；发现前后端冲突时给 BE / FE 新建看板记录）。章节：1 总体架构图（mermaid）；2 模块职责与边界；3 关键时序（同步、排序、推荐、规则解析与保存、整理、诊断、离线降级、首次安装，mermaid sequenceDiagram）；4 数据模型与数据流；5 接口总览（method / path / Code ID / Feature ID）；6 隐私与安全；7 性能设计；8 部署与启动；9 持久化演进；10 可测试性架构（测试分层、端口、重置 / 状态接口、时间基准、evidence 留痕、真实安装冒烟）；11 追溯体系；12 文件所有权、模块依赖与开发顺序。文档中的 ID 必须真实存在。
${fmtFeedback(fb)}
结构化输出：summary、files、openQuestions。`

const DESIGN_REVIEWERS = [
  { label: '评审·架构与契约一致性', prompt: '逐个比对 api-contract.json 与前端方案（docs/04、ui-contract.messages、code-points-fe 的 interfaces）中的每一次后端调用（路径、方法、请求 / 响应字段），列出所有不一致；检查 docs/05 与 03 / 04 是否一致；检查每个 inScope Feature 是否有完整实现路径（FE → 消息 → BE → 数据）；检查 MV3 正确性。owner 填 BE / FE / ARCH。' },
  { label: '评审·可实现性', prompt: '检查 Code 点粒度和遗漏；文件所有权是否真能支持按模块并行开发（CORE 是否覆盖所有共享文件）；modules.json 的依赖与关键路径是否合理；算法口径与 PRD 第 6 章是否一致；是否符合 specs/*.spec.md（特别是 FE-UI-07 popup 尺寸、BE-RUN-07 状态接口）。owner 填 BE / FE / ARCH。' },
  { label: '评审·测试设计视角', prompt: '以测试设计者的身份，逐个 inScope Feature 的每条 AC 检查：能否从契约中找到对应的接口、字段、错误码、状态码和示例来写出具体的 expected；同一错误是否只有一个状态码；时间相关的 AC 能否用覆盖参数固定时间；UI 的 AC 能否落到登记的 testId 与可见文本。写不出具体 expected 的地方列为 major（owner 填 BE / FE / PM）。' },
  { label: '评审·自动化可执行性', prompt: '以自动化工程师的身份检查：每个 UI 交互与断言元素都有 testId，加载 / 空 / 错误 / 离线状态都可断言；后端测试钩子（reset、state、LOG_FILE、x-request-id、时间覆盖、持久化路径可配置）是否都在方案和契约中登记；真实 action popup 的尺寸约束（FE-UI-07）与首次安装路径是否写进 docs/04；数据能否通过 /api/sync 和夹具构造。owner 填 BE / FE。' },
]

if (want('design')) {
  phase(P2)
  const r = await stageLoop({
    key: '技术方案', ph: P2, cmd: `${V} design --brief`, report: 'design', reviewers: DESIGN_REVIEWERS,
    produce: async (fb, round) => {
      const collect = (o) => { if (o && o.openQuestions) summary.openQuestions.push(...o.openQuestions.map((q) => `[技术方案] ${q}`)) }
      const prdIssues = (fb && fb.review || []).filter((i) => /features\.json|PRD|docs\/0[12]|\bD-\d|\bAC\d|PM/.test(`${i.target} ${i.owner}`))
      if (prdIssues.length) collect(await agent(`${PRE}\n${OWNER_SCOPE.PM}\n技术方案评审发现以下需要修订 PRD / features.json / requirements.json 的问题，请就地修订（ID 与 AC 编号不变，只改文字和取值），然后运行 ${V} prd --brief 确认通过：\n${fmtIssues(prdIssues)}\n结构化输出：summary、files、openQuestions。`, { label: `PM·按方案评审修订PRD#${round}`, phase: P2, schema: S_PRODUCE }))
      if (round === 1) {
        const drafts = await parallel([
          () => agent(`${PRE}\n${BE_ARCH}`, { label: '后端架构师·初稿', phase: P2, schema: S_PRODUCE }),
          () => agent(`${PRE}\n${FE_ARCH}`, { label: '前端架构师·初稿', phase: P2, schema: S_PRODUCE }),
        ])
        drafts.forEach(collect)
        const [feOnBe, beOnFe] = await parallel([
          () => review(FE_REVIEWS_BE, '交叉评审·前端看后端', P2),
          () => review(BE_REVIEWS_FE, '交叉评审·后端看前端', P2),
        ])
        const cross = [...((feOnBe && feOnBe.issues) || []), ...((beOnFe && beOnFe.issues) || [])]
        log(`交叉评审 ${cross.length} 条；后端先定稿契约，然后前端对齐 ∥ 架构整合`)
        collect(await agent(`${PRE}\n${REVISE('BE', cross, null)}`, { label: '后端架构师·契约定稿', phase: P2, schema: S_PRODUCE }))
        const outs = await parallel([
          () => agent(`${PRE}\n${REVISE('FE', cross, null)}`, { label: '前端架构师·对齐契约', phase: P2, schema: S_PRODUCE }),
          () => agent(`${PRE}\n${ARCH_DOC(null)}`, { label: '系统架构整合', phase: P2, schema: S_PRODUCE }),
        ])
        outs.forEach(collect)
      } else {
        const outs = await parallel([
          () => agent(`${PRE}\n${REVISE('BE', [], fb)}`, { label: `后端架构师·修订#${round}`, phase: P2, schema: S_PRODUCE }),
          () => agent(`${PRE}\n${ARCH_DOC(fb)}`, { label: `系统架构·修订#${round}`, phase: P2, schema: S_PRODUCE }),
        ])
        outs.forEach(collect)
        collect(await agent(`${PRE}\n${REVISE('FE', [], fb)}`, { label: `前端架构师·修订#${round}`, phase: P2, schema: S_PRODUCE }))
      }
    },
  })
  summary.stages.design = { pass: r.pass, rounds: r.rounds, degraded: !!r.degraded }
  if (!r.pass) return halt('design', r)
  const bd = await resolveBoard('技术方案', P2, { freeze: 'design' })
  const md = await check(`${V} modules --brief ; ${V} design --brief`, 'modules', '模块依赖与方案复核', P2)
  if (!bd.pass || !md.pass) return halt('design', null, { blocking: bd.blocking, errors: md.errors.slice(0, 20) })
}

// 生成上下文包，并按验证器返回的模块列表校正模块组
async function refreshPacks(label, ph, failuresFile) {
  const p = await check(`${V} pack${failuresFile ? ` --failures=${failuresFile}` : ''} --brief`, 'pack', label, ph)
  const mods = (p.modules || []).filter((m) => m !== 'E2E')
  if (mods.length) {
    const known = new Set(GROUPS_DEFAULT.flat())
    const groups = GROUPS_DEFAULT.map((g) => g.filter((m) => mods.includes(m))).filter((g) => g.length)
    for (const m of mods) if (!known.has(m) && m !== 'CORE') groups.push([m])
    GROUPS = groups
  }
  return p
}

// 读取模块依赖（docs/trace/modules.json）
async function loadModuleDeps(ph) {
  const r = await agent(`${PRE}
你是「确定性校验执行器」：只执行命令、如实转录，不修改任何文件。
执行：cd "${ROOT}" && ${V} modules --brief（退出码非 0 属于正常情况）
读取 .workflow/reports/validate-modules.json 与 docs/trace/modules.json，按 schema 转录：pass、errors（最多 20 条）、modules（每个模块的 id 与 dependsOn）、layers（报告 stats.layers 原样转录）。`, { label: '读取模块依赖', phase: ph, schema: S_MODULES, effort: 'low' })
  MODULE_DEPS = new Map(((r && r.modules) || []).map((m) => [m.id, m.dependsOn || []]))
  if (r && r.layers && r.layers.length) log(`模块依赖分层：${r.layers.map((l, i) => `L${i + 1}[${l.join(',')}]`).join(' → ')}`)
  else log('⚠️ 没有读到模块依赖（docs/trace/modules.json），各模块组将不分先后同时开发')
  return r
}
const rawDepGroups = (gi) => [...new Set(GROUPS[gi].flatMap((m) => MODULE_DEPS.get(m) || []).map(groupOf).filter((x) => x >= 0 && x !== gi))]
// 按依赖计算每个模块组的层级；只等待层级更低的上游组，即使依赖数据里有环也不会互相等待（死锁）
function groupLayers() {
  const n = GROUPS.length
  const layer = new Array(n).fill(0)
  for (let iter = 0; iter < n; iter++) {
    let changed = false
    for (let gi = 0; gi < n; gi++) for (const d of rawDepGroups(gi)) if (layer[d] + 1 > layer[gi] && layer[d] + 1 <= n) { layer[gi] = layer[d] + 1; changed = true }
    if (!changed) break
  }
  return layer
}
let LAYER = []
const depGroupsOf = (gi) => rawDepGroups(gi).filter((d) => (LAYER[d] || 0) < (LAYER[gi] || 0))

// ============================================================ 阶段 3：用例设计（按模块组并行；不写脚本、不开发）
const packList = (g) => g.map((m) => `.workflow/context/packs/${m}.md`).join('、')

const CASE_BRIEF = (type, g, fb) => `你是${type === 'UI' ? '插件 UI' : '接口'}测试设计（nav-test-case-design 技能，先读 .agents/skills/nav-test-case-design/SKILL.md）。
本次负责模块：${g.join('、')}；只设计 type=${type} 的用例。上下文包：${packList(g)}（先读；需要原文用 ${V} q <ID>）。
【分片模式】为每个模块各写一组分片：docs/trace/cases/${type}-<MOD>.json（{ "cases": [...], "waivers": [...] }）和 docs/cases/${type}-<MOD>.md。不要直接编辑 cases-api.json / cases-ui.json / docs/06 / docs/07（由 validator 合并生成），也不要写其他模块或其他类型的分片。
要求：本模块每个 inScope Feature${type === 'UI' ? '（layers 含 FE）' : '（layers 含 BE）'}的每条 AC 都被某条用例的 acceptanceRefs 覆盖；本模块每个 ${type === 'UI' ? 'C-FE' : 'C-BE'} 代码点至少被 1 条用例引用；按技能要求覆盖正例 / 反例 / 边界 / 异常；expected 写成「En：」开头、带具体值的可断言描述，steps 写成「Sn：」。
${type === 'UI' ? 'UI 用例必须能用 Playwright 加载插件执行（CONVENTIONS §5）：元素用 ui-contract 登记的 testId；外部站点 route 离线化；history.addUrl 造历史；旧页面通过后端样例导入构造；首次安装（storage 为空）用 presetApiBase=false。' : 'API 用例必须能用真实 HTTP 执行：数据通过 /api/sync 构造，测试之间通过 /api/__test__/reset 隔离；预期值优先使用 resource.json 推演出的具体值（与 PRD 第 13 章一致）。'}
【不要猜】契约或方案没写清楚的地方（字段、错误码、状态码、testId、时间基准），先按最可能的理解写出用例，同时在 docs/trace/board/ 新建一条 blocking 看板记录（to=BE / FE / PM），refs 写清 Case ID 与相关 ID；对齐阶段由负责人确认后再修订。不要因为不确定就删掉用例或降低断言。
${fmtFeedback(fb)}`

const E2E_BRIEF = (fb) => `你是 E2E 测试设计（nav-test-case-design 技能 §3 第 4 步）。设计至少 6 条真实端到端链路用例（type=E2E，模块名 FLOW，ID 形如 TC-E2E-FLOW-001），覆盖 PROBLEM.md 验收流程（同步 → 排序 → 推荐 → 规则解析 → 保存 → 整理建议体现规则 → 删除规则 → 恢复 → health.ruleCount；隐私过滤兜底；增量同步；时间阈值边界等），每条 ≥ 3 步、引用跨 ≥ 2 个模块的 C-BE 代码点，并在步骤之间断言状态传递。
上下文：.workflow/context/packs/ 下各模块包（只读需要的部分）、docs/trace/api-contract.json。契约不清楚的地方提看板，不要猜。
【分片模式】只写 docs/trace/cases/E2E.json 和 docs/cases/E2E.md，不要编辑合并文件。
${fmtFeedback(fb)}`

async function caseLoop(g, type) {
  const key = `case-${type}-${gKey(g)}`
  const mods = type === 'E2E' ? ['E2E'] : g
  const ownOf = (det) => det.errors.filter((e) => type === 'E2E' ? /TC-E2E-/.test(e) : new RegExp(type === 'UI' ? 'TC-UI-|含 FE 层|C-FE-' : 'TC-API-|含 BE 层|C-BE-').test(e))
  const pre = await check(mods.map((m) => `${V} cases --module=${m} --brief`).join(' ; '), `cases-${mods[0]}`, `预检·用例·${type}·${gKey(g)}`, P3)
  if (!ownOf(pre).length && !(type !== 'E2E' && pre.errors.some((e) => /缺少文件|没有任何测试用例/.test(e) && g.some((m) => e.includes(`-${m}-`))))) { log(`用例 ${type}·${gKey(g)} 已达标，跳过`); return true }
  let fb = { round: 0, deterministic: ownOf(pre), review: [] }
  if (!fb.deterministic.length) fb = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    await work({ kind: 'test', key, label: `用例设计·${type}·${gKey(g)}#${round}`, phase: P3,
      brief: type === 'E2E' ? E2E_BRIEF(fb) : CASE_BRIEF(type, g, fb),
      dod: mods.map((m) => `${V} cases --module=${m} --brief 中与 ${type} 用例相关的错误为 0`) })
    const det = await check(mods.map((m) => `${V} cases --module=${m} --brief`).join(' ; '), `cases-${mods[0]}`, `校验·用例·${type}·${gKey(g)}#${round}`, P3)
    const own = ownOf(det)
    if (!own.length) return true
    fb = { round, deterministic: own, review: [] }
  }
  log(`⚠️ 用例设计 ${type}·${gKey(g)} 在 ${MAX_ROUNDS} 轮后仍有错误，交给对齐阶段处理`)
  return false
}

if (want('cases')) {
  phase(P3)
  await refreshPacks('生成上下文包', P3)
  log(`模块组：${GROUPS.map(gKey).join(' | ')}`)
  const res = await pipeline(
    [...GROUPS.map((g) => ({ g, e2e: false })), { g: ['FLOW'], e2e: true }],
    async (it) => {
      if (it.e2e) return { ...it, ok: await caseLoop(it.g, 'E2E') }
      const [api, ui] = await parallel([() => caseLoop(it.g, 'API'), () => caseLoop(it.g, 'UI')])
      return { ...it, ok: api && ui }
    },
  )
  const bad = res.filter((x) => x && !x.ok).map((x) => gKey(x.g))
  summary.stages.cases = { pass: !bad.length, groupsWithErrors: bad }
  log(`用例设计完成：${res.filter(Boolean).length} 组，仍有错误的组：${bad.join('、') || '无'}`)
}

// ============================================================ 阶段 4：对齐与冻结（三方信息对齐之后才写脚本和开发）
const FEASIBILITY_BRIEF = (g, e2e) => `你是自动化工程师（nav-case-to-script），做「可执行性预检」：在写脚本之前，确认用例都能写成真实可执行、断言具体的脚本。
本次负责：${e2e ? '全部 E2E 用例（docs/trace/cases/E2E.json）' : `模块 ${g.join('、')} 的 API 与 UI 用例（分片 docs/trace/cases/{API,UI}-<MOD>.json；上下文包 ${packList(g)}）`}。
逐条检查：
- API / E2E：每个 Sn 都能对应到契约中的接口和请求字段；每个 En 都能落到响应字段、状态码或错误码的具体断言；数据能用 /api/sync 构造；时间边界能用覆盖参数固定。
- UI：每个操作元素和断言元素都有 ui-contract 登记的 testId；各状态可断言；数据能用夹具构造（history.addUrl 的限制、旧页面需要后端导入）；首次安装场景可以用 presetApiBase=false。
把结论写到 .workflow/context/feasibility/${e2e ? 'E2E' : gKey(g)}.md（每条用例一行：可执行 / 有缺口 + 缺口说明）。
每个缺口在 docs/trace/board/ 新建一条 blocking 看板记录：to 填应该补充信息的角色（BE = 契约，FE = ui-contract / 方案，PM = AC，TEST = 用例写法），refs 写清 Case ID 与相关的 F / C ID，question 写清「缺什么、为什么写不出断言」。不要修改用例、契约或代码。`

const ALIGN_REVIEWERS = [
  { label: '对齐评审·产品', prompt: '以 PM 的身份核对：每条 AC 是否真的被用例的 expected 证明（不能只是挂了 acceptanceRefs）；PRD 第 13 章样例推演的具体值与用例 expected 是否一致；决策 D-xx 是否在契约和用例中被正确体现。' },
  { label: '对齐评审·后端', prompt: '以后端负责人的身份核对：api-contract（接口、字段、错误码与状态码、时间基准、测试钩子）与 API / E2E 用例、docs/03 是否一致；契约内部是否有冲突（例如同一错误在不同地方写了不同状态码）；用例里出现但契约没有的接口或字段。' },
  { label: '对齐评审·前端', prompt: '以前端负责人的身份核对：ui-contract（testId、消息、storageKey）与 UI 用例、docs/04 是否一致；前端调用的接口路径和方法是否都在 api-contract 中；popup 真实尺寸约束、首次安装、后端未启动、离线等真实使用路径是否都有用例。' },
  { label: '对齐评审·测试', prompt: '以测试负责人的身份核对：同一个行为在 API 用例和 UI 用例中的期望是否一致；E2E 是否真正传递状态；正例 / 反例 / 边界 / 异常是否齐全；可执行性预检（.workflow/context/feasibility/*.md）列出的缺口是否都已经提了看板。' },
].map((rv) => ({ ...rv, prompt: `${rv.prompt}\n发现的每个阻塞问题都在 docs/trace/board/ 新建一条 blocking 看板记录（to 填负责修改的角色：PM / BE / FE / ARCH / TEST），写清 target、refs 和 question；非阻塞的建议也可以建非阻塞记录。只建看板记录，不要修改文档。` }))

if (want('align')) {
  phase(P4)
  await refreshPacks('刷新上下文包', P4)
  await parallel([
    () => parallel([...GROUPS.map((g) => ({ g, e2e: false })), { g: ['FLOW'], e2e: true }].map((it) => () => work({ kind: 'test', key: `feasibility-${it.e2e ? 'E2E' : gKey(it.g)}`, label: `可执行性预检·${it.e2e ? 'E2E' : gKey(it.g)}`, phase: P4,
      brief: FEASIBILITY_BRIEF(it.g, it.e2e), dod: [`.workflow/context/feasibility/${it.e2e ? 'E2E' : gKey(it.g)}.md 已写好`, `${V} board --brief 没有格式错误`] }))),
    () => parallel(ALIGN_REVIEWERS.map((rv) => () => agent(`${PRE}\n${rv.prompt}\n结构化输出：summary、files（新建的看板记录）、openQuestions。`, { label: rv.label, phase: P4, schema: S_PRODUCE }))),
  ])
  let alignOk = false, lastAlign = null, lastBoard = null
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    lastBoard = await resolveBoard(`对齐#${round}`, P4, { freeze: 'align', maxRounds: 2 })
    lastAlign = await check(`${V} align --brief ; ${V} cases --brief`, 'align', `对齐校验#${round}`, P4)
    if (lastAlign.pass && lastBoard.pass) { alignOk = true; break }
    const routed = routeErrors(lastAlign.errors)
    log(`对齐第 ${round} 轮：确定性错误 ${lastAlign.errors.length} 条（${[...routed.entries()].map(([r, l]) => `${r} ${l.length}`).join('，')}），阻塞看板 ${lastBoard.blocking.length} 条`)
    if (routed.size) await parallel([...routed.entries()].map(([role, errs]) => () => dispatchOwner(role, [], `对齐${round}`, P4, errs)))
  }
  summary.stages.align = { pass: alignOk, errors: lastAlign ? lastAlign.errors.length : null, blocking: lastBoard ? lastBoard.blocking.length : null }
  if (!alignOk) return halt('align', null, { alignErrors: (lastAlign && lastAlign.errors || []).slice(0, 30), blocking: lastBoard && lastBoard.blocking })
  await check(`${V} baseline --record=aligned --brief`, 'baseline', '基线冻结', P4)
  log('🧊 需求、方案、用例三方对齐完成，基线已冻结。之后对上游产物的修改必须走变更请求（看板 type=change 并被接受）')
}

// ============================================================ 阶段 5：脚本与开发（按依赖顺序）
const SCRIPT_BRIEF = (type, g, fb) => `你是${type === 'UI' ? 'UI' : '接口'}自动化工程师（nav-case-to-script 技能，先读 .agents/skills/nav-case-to-script/SKILL.md 和 references/${type === 'UI' ? 'ui-patterns.md' : 'api-e2e-patterns.md'}、assets/templates/${type === 'UI' ? 'ui' : type === 'E2E' ? 'e2e' : 'api'}.spec.mjs）。
本次负责：${type === 'E2E' ? '全部 E2E 用例（docs/trace/cases-api.json 中 type=E2E）' : `模块 ${g.join('、')} 的 type=${type} 用例（上下文包：${packList(g)}；可执行性预检记录：.workflow/context/feasibility/${gKey(g)}.md）`}。
要求：一个 Case ID 一个文件 ${type === 'UI' ? 'tests/ui' : type === 'E2E' ? 'tests/e2e' : 'tests/api'}/<CaseID>.spec.mjs；从 ../fixtures/${type === 'UI' ? 'extension' : 'api'}.mjs 导入 test / expect；标题以 Case ID 开头；每条 En 至少一个以 [En] 开头的断言，每条 Sn 对应 test.step('Sn：…')；${type === 'UI' ? '只用登记的 testId，关键步骤 ext.snap；' : '真实 HTTP，不 mock、不 route；'}禁止 skip / only / fixme、吞异常、恒真断言。只写本次负责用例的脚本文件，不改 tests/fixtures（需要新能力写进 blockedBy）。写的时候发现用例或契约有问题，提看板记录，不要自己改用例或放宽断言。
${type === 'UI' ? '插件还没实现（TDD），脚本按 docs/04 和 ui-contract 写成草稿；插件实现后 AI 探索会核实并固化，所以断言要完整表达 expected。' : '后端还没实现（TDD 红灯阶段），只需脚本能被加载。'}
${fmtFeedback(fb)}`

const DEV_BRIEF = (side, g, items) => `你是${side === 'BE' ? '后端' : '插件前端'}开发工程师（TDD）。必须遵守 specs/${side === 'BE' ? 'backend' : 'frontend'}.spec.md${side === 'FE' ? '（特别是 FE-UI-07：popup 尺寸用固定 px，禁止视口单位；FE-TEST-04：真实 action popup 冒烟）' : ''}。
本次负责模块：${g.join('、')}。上下文包：${packList(g)}（含 Feature + AC、代码点、文件所有权、契约摘录、用例与证据路径）。
${items && items.length ? `【本轮任务】修复以下问题（细节看 evidence/<CaseID>/ 与 .workflow/reports/ 下最新的 gate-iter-*.json）：\n${bullet(items)}` : `【本轮任务】实现本模块组全部 C-${side} 代码点（skeleton 已由 lead 搭好：只改上下文包「文件所有权」中属于本模块的文件；共享文件需要改动时提看板记录给 DEV-${side} lead 或写进 blockedBy）。上游依赖模块已经先行开发；依赖的上游能力还没有时（例如返回 501），提看板记录给对应负责人，不要自己绕开。`}
规则：每个代码点在实现处标注 // @code <ID>（HTML 用 <!-- @code <ID> -->）；实现位置与 code-points 的 files 不一致时更新 files / symbols（不得改 ID 与 features）；tests/ 和 playwright.config.mjs 只读（锁定，改动会被还原并记违规）；禁止为测试特判、硬编码样例数据（BE-RUN-06）；认为测试有错时写 testDisputes（引用文档原文 vs 断言），不要改测试。代码保持简单直白、可讲解。`
const DEV_DOD = (side, g, port, key) => [
  `EVIDENCE_DIR=.workflow/context/evidence/${key} PW_OUTPUT_DIR=.workflow/context/test-results/${key} ${g.map((m) => `${RUN} --module=${m} --type=${side === 'BE' ? 'API' : 'UI'} --port=${port} --no-lint`).join(' && ')} —— 本模块组用例全部通过（因上游未完成而失败的写进 blockedBy，并提看板记录）`,
  `${g.map((m) => `${V} code --module=${m} --side=${side} --brief`).join(' && ')} —— 没有本模块的 @code / 规范 / testId 错误`,
]

async function scriptLoop(g, type) {
  const key = `script-${type}-${gKey(g)}`
  const mods = type === 'E2E' ? ['E2E'] : g
  const re = type === 'E2E' ? /TC-E2E-|tests\/e2e/ : type === 'UI' ? /TC-UI-|tests\/ui/ : /TC-API-|tests\/api/
  const pre = await check(mods.map((m) => `${V} scripts --module=${m} --brief`).join(' ; '), `scripts-${mods[0]}`, `预检·脚本·${type}·${gKey(g)}`, P5)
  const preOwn = pre.errors.filter((e) => re.test(e))
  if (!preOwn.length) { log(`脚本 ${type}·${gKey(g)} 已达标，跳过`); return true }
  let fb = { round: 0, deterministic: preOwn, review: [] }
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    await work({ kind: 'test', key, label: `脚本·${type}·${gKey(g)}#${round}`, phase: P5,
      brief: SCRIPT_BRIEF(type, g, fb),
      dod: mods.map((m) => `${V} scripts --module=${m} --brief 中与 ${type} 脚本相关的错误为 0（${RUN} --module=${m} --lint-only 可看细节）`) })
    const det = await check(mods.map((m) => `${V} scripts --module=${m} --brief`).join(' ; '), `scripts-${mods[0]}`, `校验·脚本·${type}·${gKey(g)}#${round}`, P5)
    const own = det.errors.filter((e) => re.test(e))
    if (!own.length) return true
    fb = { round, deterministic: own, review: [] }
  }
  log(`⚠️ 脚本 ${type}·${gKey(g)} 在 ${MAX_ROUNDS} 轮后仍有错误，交给全局校验处理`)
  return false
}

async function devGroup(g, gi, side, items, tag) {
  const fixing = items && items.length
  const port = (fixing ? (side === 'BE' ? 4240 : 4260) : (side === 'BE' ? 4200 : 4220)) + gi
  const key = `dev-${side}-${gKey(g)}`
  return devLimit(() => work({ kind: 'dev', key, label: `${side === 'BE' ? '后端' : '前端'}开发·${gKey(g)}${tag}`, phase: fixing ? P6 : P5,
    brief: DEV_BRIEF(side, g, items), dod: DEV_DOD(side, g, port, key) }))
}

const LEAD_BRIEF = (side) => `你是${side === 'BE' ? '后端' : '插件前端'} lead（TDD 骨架），必须遵守 specs/${side === 'BE' ? 'backend' : 'frontend'}.spec.md。
上下文：.workflow/context/packs/CORE.md（若存在）、.workflow/context/packs/ownership.json、docs/${side === 'BE' ? '03-技术方案-后端' : '04-技术方案-前端'}.md（按章节读）、docs/trace/${side === 'BE' ? 'api-contract' : 'ui-contract'}.json。
任务：实现所有 module=CORE 的 C-${side} 代码点（标注 @code），并为每个业务模块的文件建好占位（${side === 'BE' ? '路由注册表预先挂好所有模块的路由文件；未实现的处理器返回 501 和统一错误格式' : 'manifest、background 消息总线与按模块的 handler 注册表、popup 外壳与按模块的 section 注册表、api client、storage 封装；所有 ui-contract 中的 testId 先在占位中渲染出来'}）。占位文件不要写业务模块的 @code（由模块开发者实现时标注）。
${side === 'BE' ? '必须做到：PORT / HOST、ENABLE_TEST_API=1 时的 POST /api/__test__/reset 与 GET /api/__test__/state、LOG_FILE（自动创建目录）同步写 JSON 日志、x-request-id 回传、SIGTERM 正常退出、CORS、持久化路径可配置、GET /api/health 可用；scripts/start.sh（可执行）。' : '必须做到：MV3 manifest（tabs / history / storage / activeTab + host_permissions 本地后端）、无内联脚本、storage key apiBaseUrl、popup 尺寸用固定 px（FE-UI-07），popup/popup.html 既能以 tab 打开，也能作为真实 action popup 正常显示（node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs --scenarios=S1 自查）。'}`

let scriptsOk = true
if (want('build')) {
  phase(P5)
  await refreshPacks('生成上下文包', P5)
  await loadModuleDeps(P5)
  LAYER = groupLayers()
  log(`模块组（层级）：${GROUPS.map((g, gi) => `${gKey(g)}@L${LAYER[gi] + 1}`).join(' | ')}`)
  // 开发骨架与脚本编写并行（TDD：只搭基础设施和占位，不写业务逻辑）
  const leadP = want('dev') || want('build') ? (async () => {
    const leads = await parallel(['BE', 'FE'].map((side) => () => (async () => {
      const pre = await check(`${V} skeleton --side=${side} --brief`, 'skeleton', `预检·骨架·${side}`, P5)
      if (pre.pass) return true
      LEAD_FIX[side] = pre.errors
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        await work({ kind: 'dev', key: `lead-${side}`, label: `${side} lead·骨架#${round}`, phase: P5, brief: LEAD_BRIEF(side) + (LEAD_FIX[side].length ? `\n【本轮任务】上一轮骨架校验未通过，修复：\n${bullet(LEAD_FIX[side])}` : ''),
          dod: [`${V} skeleton --side=${side} --brief 通过`] })
        const sk = await check(`${V} skeleton --side=${side} --brief`, 'skeleton', `校验·骨架·${side}#${round}`, P5)
        if (sk.pass) return true
        LEAD_FIX[side] = sk.errors
      }
      return false
    })()))
    return leads.every(Boolean)
  })() : Promise.resolve(true)

  // 每个模块组一个「开发完成」信号：下游模块组要等上游模块组开发完才开工（避免 v2 中下游全部被上游 501 卡住）
  const devGate = new Map()
  GROUPS.forEach((g, gi) => { let resolve; const p = new Promise((r) => { resolve = r }); devGate.set(gi, { p, resolve }) })
  const pipe = await pipeline(
    [...GROUPS.map((g, gi) => ({ g, gi, e2e: false })), { g: ['FLOW'], gi: GROUPS.length, e2e: true }],
    async (it) => {
      await infraP
      try {
        if (it.e2e) return { ...it, scripts: await scriptLoop(it.g, 'E2E') }
        const [api, ui] = await parallel([() => scriptLoop(it.g, 'API'), () => scriptLoop(it.g, 'UI')])
        return { ...it, scripts: api && ui }
      } catch (e) {
        return { ...it, scripts: false, error: String((e && e.message) || e) }
      }
    },
    async (it) => {
      if (it.e2e) return it
      try {
        if (!want('build')) return it
        const deps = depGroupsOf(it.gi)
        if (deps.length) {
          log(`模块组 ${gKey(it.g)} 等待上游 ${deps.map((d) => gKey(GROUPS[d])).join('、')} 开发完成`)
          await Promise.all(deps.map((d) => devGate.get(d).p))
        }
        await leadP
        const [be, fe] = await parallel([() => devGroup(it.g, it.gi, 'BE', null, ''), () => devGroup(it.g, it.gi, 'FE', null, '')])
        return { ...it, dev: { be: be && be.selfTest, fe: fe && fe.selfTest } }
      } finally {
        devGate.get(it.gi).resolve()
      }
    },
  )
  for (const [, gate] of devGate) gate.resolve()
  const leadsOk = await leadP
  log(`流水线完成：${pipe.filter(Boolean).map((x) => `${gKey(x.g)}(脚本${x.scripts ? '✓' : '✗'})`).join('，')}；骨架 ${leadsOk ? '✓' : '✗'}`)

  // 全局屏障：合并后的全量校验 + 两路评审，问题按模块组并行返工；脚本阶段产生的看板项在锁定前处理掉
  const GLOBAL_REVIEWERS = [
    { label: '评审·用例覆盖度', prompt: '基于合并后的 docs/trace/cases-api.json / cases-ui.json 与 features.json：逐个 inScope Feature 核对每条 AC 是否被 acceptanceRefs 覆盖、expected 是否具体可断言、预期值是否与 PRD 第 13 章 / resource.json 一致、跨模块场景是否遗漏。owner 填用例所属模块名（例如 SYNC）或 E2E。' },
    { label: '评审·脚本完整性', prompt: '抽查 tests/api、tests/e2e、tests/ui 中每个模块至少 3 个脚本：断言是否覆盖对应用例的全部 [En]、是否真实 HTTP / 未拦截后端、E2E 是否传递状态、UI 是否只用登记 testId、有无恒真断言 / 吞异常 / 条件跳过。owner 填用例所属模块名或 E2E。' },
  ]
  for (let round = 1; round <= 2; round++) {
    await resolveBoard(`脚本#${round}`, P5, { maxRounds: 1 })
    await enforceBaseline(`脚本#${round}`, P5)
    const det = await check(`${V} scripts --brief ; ${V} align --brief`, 'scripts', `全局校验·用例与脚本#${round}`, P5)
    const revs = det.pass ? (await parallel(GLOBAL_REVIEWERS.map((rv) => () => review(rv.prompt, `${rv.label}#${round}`, P5)))).filter(Boolean) : []
    const issues = revs.flatMap((r) => r.issues || []).filter((i) => i.severity !== 'minor')
    if (det.pass && !issues.length) { scriptsOk = true; break }
    scriptsOk = false
    if (round === 2) break
    const byGroup = new Map()
    const route = (mod, msg) => { const gi = mod === 'E2E' || mod === 'FLOW' ? GROUPS.length : groupOf(mod); if (gi < 0) return; if (!byGroup.has(gi)) byGroup.set(gi, []); byGroup.get(gi).push(msg) }
    for (const e of det.errors) { const m = (/-(?:API|UI|E2E)-([A-Z]+)-\d{3}/.exec(e) || /\bF-([A-Z]+)-\d{2}/.exec(e) || /\bC-(?:FE|BE)-([A-Z]+)-\d{2}/.exec(e) || [])[1]; if (m) route(/TC-E2E-/.test(e) ? 'E2E' : m, e) }
    for (const i of issues) route(String(i.owner || '').toUpperCase(), `[${i.severity}] ${i.target}：${i.problem} → ${i.suggestion}`)
    log(`全局校验第 ${round} 轮：确定性错误 ${det.errors.length}，评审问题 ${issues.length}，分派到 ${byGroup.size} 个模块组返工`)
    await parallel([...byGroup.entries()].map(([gi, msgs]) => () => {
      const e2e = gi === GROUPS.length
      const g = e2e ? ['FLOW'] : GROUPS[gi]
      return work({ kind: 'test', key: `rework-${gKey(g)}`, label: `用例/脚本返工·${gKey(g)}`, phase: P5,
        brief: `你是测试设计兼自动化（nav-test-case-design + nav-case-to-script）。修复全局校验与评审指出的、属于${e2e ? ' E2E 用例（分片 docs/trace/cases/E2E.json、tests/e2e）' : `模块 ${g.join('、')}（分片 docs/trace/cases/{API,UI}-<MOD>.json 与 docs/cases/、tests/api|ui 中这些模块的脚本）`}的问题：\n${bullet(msgs.slice(0, 50))}\n用例与脚本要保持一致：改了用例的 expected / steps，同步修改对应脚本的 [En] 断言与 Sn 步骤；用例改动属于基线变更，要给自己建一条 type=change 的看板记录并标为 accepted（写清原因与受影响的 ID）。只改你负责的文件。`,
        dod: (e2e ? ['E2E'] : g).map((m) => `${V} scripts --module=${m} --brief 没有错误`) })
    }))
  }
  summary.stages.build = { pass: scriptsOk, groups: GROUPS.map(gKey) }
  if (!scriptsOk) log('⚠️ 用例 / 脚本全局校验仍有问题，带着问题锁定并进入 TDD 闭环（门禁会继续暴露它们）')
  const lk = await check(`${V} lock --brief`, 'lock', '锁定测试脚本', P5)
  digest = lk.digest || digest
  log(`🔒 测试脚本已锁定（${String(digest).slice(0, 12)}）`)
}

// ============================================================ 阶段 6：TDD 闭环
const TRIAGE = (it, disputes, blocked) => `你是测试失败分诊专家：只读，不修改任何文件。阅读 .workflow/reports/gate-iter-${it}.json（完整错误），按需查看 evidence/<CaseID>/（api/ 请求与响应、server.log、state-diff.json、screenshots/、extension.log）、测试脚本、用例、契约和源码；失败分类规则见 .agents/skills/nav-case-to-script/references/failure-triage.md。
为每个失败定位根因并分派：BE / FE（某业务模块的缺陷，module 填该模块）；BE_CORE / FE_CORE（共享文件 / 骨架问题，module 填 CORE）；UI_SCRIPT_SUSPECT（UI 脚本疑似与真实 UI 不符，需要 AI 探索确认）；API_TEST_SUSPECT（API / E2E 测试疑似与文档矛盾，需要仲裁）。
【按根因归属】失败的根因在上游模块（例如上游接口仍返回 501 / NOT_IMPLEMENTED、上游数据没写入）时，分派给上游模块（module 填上游模块名），不要分派给下游。code / 规范类错误按文件路径归属到模块。webServer 启动失败等全局错误归 BE_CORE。工具链 / 基线类错误不在你的分派范围内（由流程处理），跳过。
开发提交的 testDisputes：${JSON.stringify(disputes).slice(0, 4000)}
开发报告的 blockedBy：${JSON.stringify(blocked).slice(0, 3000)}
每条给出 caseId（code 类填 "-"；同一根因的多个失败用逗号合并）、module、owner、rootCause、fixHint（具体到文件和函数，引用规范规则 ID）。`

const EXPLORE = (ids, port, withFlow) => `你是 UI 探索测试工程师（AI 探索 + 脚本固化，nav-case-to-script §6 与 CONVENTIONS §6.4）。本次负责 UI 用例：${ids.join(', ')}（定义用 ${V} q <CaseID> 查看）。
方法：
1. 在后台启动后端：PORT=${port} HOST=127.0.0.1 ENABLE_TEST_API=1 LOG_FILE=evidence/_runtime/explore-${port}.log node server/src/index.js（结束前关闭；持久化路径按 docs/03 指到临时目录）。
2. 在 tests/explore/tmp/ 写临时脚本（node 直接运行），逐步操作真实插件：
   - 用例级探索：可以按 CONVENTIONS §5 配方 headless 加载 extension/，以 tab 方式打开 popup（apiBaseUrl 指向 http://127.0.0.1:${port}）；
   - 但**每个模块至少用一次真实 action popup**：import .agents/skills/nav-case-to-script/scripts/lib/real-popup.mjs，用 openRealPopup() 打开真实弹窗并截图，确认尺寸不小于 360×400、内容不是空白（真实 popup 与 tab 的视口不同，tab 正常不代表真实使用正常）。
   关键步骤截图到 evidence/<CaseID>/explore/<n>.png，并输出 aria 快照或关键 DOM 文本。
3. 用 Read 查看截图，结合 DOM 判断是否满足每条 [En]；必要时调整步骤继续探索。
4. 结论：pass → 若 tests/ui/<CaseID>.spec.mjs 失败或过弱，按真实流程固化（只能改选择器（登记的 testId）、等待、前置步骤和顺序；不得删除或放宽 [En] 断言，可以新增），并用 TEST_PORT=${port} npx playwright test tests/ui/<CaseID>.spec.mjs 确认通过，solidified=true；product_bug → bugReport 写清复现步骤、期望与实际、截图路径，不改产品代码；脚本没捕获该缺陷时补强断言；script_stale → 产品正确、脚本已按规则修正并通过。
   **在真实浏览器 / 真实 popup 中加载或打开插件失败，一律判为 product_bug**，不能写成「不算证据」放过。
5. 每条写入 evidence/<CaseID>/explore.json（结构见 CONVENTIONS §4）。
${withFlow ? '6. 另外以「首次安装」状态完整走一遍 PROBLEM.md 验收流程第 3–9 步：全新 profile、storage 为空、用 real-popup.mjs 打开真实 action popup（不要以 tab 打开，不要预写 apiBaseUrl；后端地址按产品自己的引导配置），每一步截图，写入 evidence/ACCEPTANCE-FLOW/explore.md；发现的问题以 caseId="ACCEPTANCE" 的 product_bug 报告。' : ''}
不得修改 extension/、server/、docs/，不得改其他用例的脚本。`

const INTEGRITY = `你是测试完整性审查员：只读，不修改任何文件。锁定后的测试被探索 / 仲裁 / 补强 agent 改过。运行 ${V} digest 查看变更列表，对每个文件执行 diff -u .workflow/locks/snapshot/<file> <file>（新增文件读全文）。
允许：改选择器（必须是 ui-contract 登记的 testId）、等待、前置步骤与顺序；新增断言；按仲裁结论把断言改到与权威文档（PROBLEM.md > PRD > api-contract > 用例）一致；为存活变异补强断言；带理由的 mutation-ignore。
不允许：删除 / 放宽 / 弱化与 [En] 对应的断言；条件跳过；吞异常；skip。
输出：approved、violations（文件、caseIds、原因）。`

const ARBITER = (items) => `你是测试仲裁者。以下 API / E2E 用例有争议：\n${bullet(items)}
按权威顺序 PROBLEM.md > PRD / features.json > api-contract.json > 用例 > 脚本 逐条裁决：test_wrong → 修正脚本（必要时同步修正 docs/trace/cases/ 中的分片并运行 ${V} merge-cases；用例改动属于基线变更，要建一条 type=change、status=accepted 的看板记录写清原因），只改到与文档一致，并用 TEST_PORT=4103 npx playwright test <脚本> 确认测试逻辑正确（被测代码缺陷导致失败是允许的）；code_wrong → 不改，给开发修复提示（owner 填 BE 或 FE，并写明模块）；doc_conflict → 以 PROBLEM.md 为准裁决：需要修改上游文档时给对应负责人建看板记录，然后按前两种处理。`

const uiModOf = (id) => { const m = /^TC-UI-([A-Z]+)-/.exec(id); return m ? m[1] : null }
function chunk(arr, n) {
  const k = Math.max(1, Math.min(n, arr.length))
  const out = Array.from({ length: k }, () => [])
  arr.forEach((x, i) => out[i % k].push(x))
  return out.filter((g) => g.length)
}

async function guardTestChanges(tag) {
  const d = await check(`${V} digest --expect-digest=${digest} --brief`, 'digest', `测试变更检测·${tag}`, P6)
  if (d.pass) return { changed: false, violations: [] }
  const rv = await agent(`${PRE}\n${INTEGRITY}`, { label: `测试完整性审查·${tag}`, phase: P6, schema: S_INTEGRITY, effort: 'high' })
  const violations = (rv && rv.violations) || []
  if (violations.length) {
    log(`⚠️ ${tag}：${violations.length} 处测试修改不合规，已还原：${violations.map((v) => v.file).join(', ')}`)
    await check(`${V} restore --file=${violations.map((v) => v.file).join(',')} --brief`, 'restore', `还原违规修改·${tag}`, P6)
  }
  const lk = await check(`${V} lock --brief`, 'lock', `重新锁定·${tag}`, P6)
  digest = lk.digest || digest
  return { changed: true, violations }
}

async function exploreUi(ids, tag, acceptance) {
  const byMod = new Map()
  for (const id of ids) { const m = uiModOf(id); if (!byMod.has(m)) byMod.set(m, []); byMod.get(m).push(id) }
  const groups = chunk([...byMod.values()], 6).map((gs) => gs.flat())
  const outs = await parallel(groups.map((g, gi) => () => agent(`${PRE}\n${EXPLORE(g, 4180 + gi, acceptance && gi === 0)}`, { label: `UI探索·${[...new Set(g.map(uiModOf))].join('+')}·${tag}`, phase: P6, schema: S_EXPLORE })))
  const results = outs.filter(Boolean).flatMap((o) => o.results || [])
  const guard = await guardTestChanges(`探索${tag}`)
  const violated = new Set(guard.violations.flatMap((v) => v.caseIds || []))
  const bugs = results.filter((r) => r.verdict === 'product_bug' || violated.has(r.caseId))
  log(`UI 探索 ${tag}：${results.length} 条，pass ${results.filter((r) => r.verdict === 'pass').length}，固化 ${results.filter((r) => r.solidified).length}，产品缺陷 ${bugs.length}`)
  return { bugs, testsChanged: guard.changed }
}

async function fixAll(items, it) {
  const tasks = []
  for (const side of ['BE', 'FE']) {
    if (items[`${side}_CORE`].length) tasks.push(() => work({ kind: 'dev', key: `lead-${side}`, label: `${side} lead·修复#${it}`, phase: P6,
      brief: `${LEAD_BRIEF(side)}\n【本轮任务】修复以下共享 / 骨架问题（细节见 .workflow/reports/gate-iter-${it}.json、evidence/ 与 evidence/_smoke/）：\n${bullet(items[`${side}_CORE`])}`,
      dod: [`${V} skeleton --side=${side} --brief 通过`, `相关用例：TEST_PORT=${side === 'BE' ? 4101 : 4102} npx playwright test <受影响脚本> 通过`, ...(side === 'FE' ? ['node .agents/skills/nav-case-to-script/scripts/smoke-install.mjs 通过（涉及 popup / 首次安装时）'] : [])] }))
    const byGroup = new Map()
    for (const x of items[side]) { const gi = Math.max(0, groupOf(x.module)); if (!byGroup.has(gi)) byGroup.set(gi, []); byGroup.get(gi).push(x.text) }
    for (const [gi, list] of byGroup) tasks.push(() => devGroup(GROUPS[gi], gi, side, list, `·修复#${it}`))
  }
  return (await parallel(tasks)).filter(Boolean)
}

// 冒烟失败按内容归属：插件端（popup、扩展加载、页面）→ FE_CORE；后端（启动、接口）→ BE_CORE
function routeSmoke(errors) {
  const out = { BE: [], FE: [], BE_CORE: [], FE_CORE: [] }
  for (const e of errors || []) (/server|后端|backend|health|api\//i.test(e) && !/popup|extension|插件/.test(e) ? out.BE_CORE : out.FE_CORE).push(`真实安装冒烟：${e}（证据见 evidence/_smoke/）`)
  return out
}

async function tddLoop() {
  let pending = { BE: [], FE: [], BE_CORE: [], FE_CORE: [] }
  let best = Infinity, stall = 0, explorationClean = false, lastGate = null, disputes = [], blocked = []
  while (devIter < MAX_DEV_ITERS) {
    devIter++
    const it = devIter
    const anyFix = Object.values(pending).some((l) => l.length)
    if (anyFix) {
      await refreshPacks(`刷新上下文包#${it}`, P6, `.workflow/reports/gate-iter-${it - 1}.json`)
      const outs = await fixAll(pending, it)
      disputes = outs.flatMap((d) => d.testDisputes || [])
      blocked = outs.flatMap((d) => d.blockedBy || [])
      explorationClean = false
      await resolveBoard(`开发#${it}`, P6, { maxRounds: 1 })
    }
    // 工具链被改动：直接还原并记违规（技能、规范、validator、workflow 在运行中只读）
    const tc = await check(`${V} toolchain --check --brief`, 'toolchain', `工具链检查#${it}`, P6)
    let tamper = []
    if (!tc.pass) {
      log(`⚠️ 第 ${it} 轮：工具链（技能 / 规范 / validator / workflow）被改动，已还原`)
      await check(`${V} toolchain --restore --brief`, 'toolchain', `还原工具链#${it}`, P6)
      tamper.push(`[违规] 修改了已锁定的工具链文件（${tc.errors.slice(0, 3).join('；')}），已被还原。技能、规范、validator 只读；有问题请提看板记录给 HUMAN。`)
    }
    await enforceBaseline(`开发#${it}`, P6)
    const gateCmd = `${V} gate --expect-digest=${digest} --brief`
    let gate = await check(gateCmd, 'gate', `门禁#${it}`, P6, `.workflow/reports/gate-iter-${it}.json`)
    if (gate.tampered) {
      log(`⚠️ 第 ${it} 轮：锁定的测试被改动，已自动还原并重跑门禁`)
      tamper.push('[违规] 修改了已锁定的测试脚本，已被还原。不要改测试；有异议请提交 testDisputes。')
      await check(`${V} restore --brief`, 'restore', `还原测试#${it}`, P6)
      gate = await check(gateCmd, 'gate', `门禁(还原后)#${it}`, P6, `.workflow/reports/gate-iter-${it}.json`)
    }
    lastGate = gate
    const run = gate.run || {}
    log(`第 ${it} 轮门禁：${gate.pass ? '✅ 全绿' : `❌ 测试 ${run.passed || 0}/${run.total || 0}；用例 ${run.casesPassed || 0}/${run.casesTotal || '?'}；错误 ${gate.errors.length}`}`)

    if (gate.pass && !disputes.length) {
      if (explorationClean) return { pass: true, gate, iterations: it }
      // 全绿：UI 探索（含真实 popup 与首次安装验收流程）∥ 断言变异检查
      const [ex, mut] = await parallel([
        async () => {
          const ids = await agent(`${PRE}\n只读：输出 docs/trace/cases-ui.json 中全部 UI 用例的 id 列表。`, { label: `列出 UI 用例#${it}`, phase: P6, schema: { type: 'object', properties: { ids: STR_ARR }, required: ['ids'] }, effort: 'low' })
          return exploreUi((ids && ids.ids) || [], `#${it}`, true)
        },
        () => check(`${V} mutation --brief`, 'mutation', `断言变异检查#${it}`, P6),
      ])
      const bugs = (ex && ex.bugs) || []
      let strengthened = false
      if (mut && !mut.pass) {
        const byMod = new Map()
        for (const e of mut.errors) { const m = (/TC-(?:API|E2E)-([A-Z]+)-\d{3}/.exec(e) || [])[1]; if (!m) continue; const gi = /TC-E2E-/.test(e) ? GROUPS.length : Math.max(0, groupOf(m)); if (!byMod.has(gi)) byMod.set(gi, []); byMod.get(gi).push(e) }
        log(`变异检查未达标：${mut.errors.length} 条，按模块组补强断言`)
        await parallel([...byMod.entries()].map(([gi, msgs]) => () => {
          const g = gi === GROUPS.length ? ['FLOW'] : GROUPS[gi]
          return work({ kind: 'test', key: `strengthen-${gKey(g)}`, label: `补强断言·${gKey(g)}#${it}`, phase: P6,
            brief: `你是接口自动化工程师（nav-case-to-script §6 断言有效性）。为以下存活变异补强对应 [En] 断言（只新增 / 收紧断言，不放宽；确实超出 expected 范围时才写 // mutation-ignore: <算子> —— 理由）：\n${bullet(msgs)}`,
            dod: [`${RUN} <这些 CaseID> --mutation --port=4105 杀死率达标（达不到就不要报完成，继续补强或说明原因）`] })
        }))
        await guardTestChanges(`补强#${it}`)
        strengthened = true
      }
      if (bugs.length) {
        pending = { BE: [], FE: bugs.map((b) => ({ module: uiModOf(b.caseId) || 'CTX', text: `${b.caseId} | 探索发现缺陷：${b.observed} | ${b.bugReport || ''}` })), BE_CORE: [], FE_CORE: [] }
        continue
      }
      // 真实安装冒烟：全新 profile、storage 为空、真实 action popup、主流程（tab 方式的 UI 用例不能代替）
      const sm = await check(`${V} smoke ${SMOKE_BROWSER === 'all' ? '--browser=all ' : ''}--brief`, 'smoke', `真实安装冒烟#${it}`, P6)
      if (!sm.pass) {
        log(`❌ 真实安装冒烟未通过：${sm.errors.length} 条（例如 ${(sm.errors[0] || '').slice(0, 120)}），退回开发`)
        pending = routeSmoke(sm.errors)
        explorationClean = false
        continue
      }
      const exv = await check(`${V} explore --brief`, 'explore', `探索记录校验#${it}`, P6)
      if (!exv.pass) log(`探索记录不完整：${exv.errors.slice(0, 3).join('；')}（下一轮补录）`)
      explorationClean = exv.pass
      pending = { BE: [], FE: [], BE_CORE: [...tamper], FE_CORE: [...tamper] }
      if (explorationClean && !ex.testsChanged && !strengthened && !tamper.length) return { pass: true, gate, iterations: it }
      continue
    }

    const metric = (run.failed || 0) + gate.errors.length + ((run.globalErrors || []).length ? 1000 : 0)
    if (metric < best) { best = metric; stall = 0 } else stall++
    if (stall >= STALL_LIMIT) { log(`⛔ 连续 ${STALL_LIMIT} 轮没有改善，停止 TDD 闭环，等待人工介入`); return { pass: false, gate, iterations: it, reason: 'stalled' } }

    const tri = await agent(`${PRE}\n${TRIAGE(it, disputes, blocked)}`, { label: `失败分诊#${it}`, phase: P6, schema: S_TRIAGE, effort: 'high' })
    const tItems = (tri && tri.items) || []
    const next = { BE: [], FE: [], BE_CORE: [...tamper], FE_CORE: [...tamper] }
    for (const x of tItems) {
      const text = `${x.caseId} | ${x.rootCause} | 修复提示：${x.fixHint}`
      if (x.owner === 'BE' || x.owner === 'FE') next[x.owner].push({ module: x.module, text })
      else if (x.owner === 'BE_CORE' || x.owner === 'FE_CORE') next[x.owner].push(text)
    }
    const uiSuspects = tItems.filter((x) => x.owner === 'UI_SCRIPT_SUSPECT').flatMap((x) => x.caseId.split(/[,，\s]+/)).filter((id) => /^TC-UI-/.test(id))
    const apiSuspects = tItems.filter((x) => x.owner === 'API_TEST_SUSPECT')
    await parallel([
      async () => {
        if (!uiSuspects.length) return
        const ex = await exploreUi(uiSuspects, `核实#${it}`, false)
        next.FE.push(...ex.bugs.map((b) => ({ module: uiModOf(b.caseId) || 'CTX', text: `${b.caseId} | 探索确认的产品缺陷：${b.observed} | ${b.bugReport || ''}` })))
      },
      async () => {
        if (!apiSuspects.length) return
        const arb = await agent(`${PRE}\n${ARBITER(apiSuspects.map((x) => `${x.caseId}（${x.module}）：${x.rootCause}（${x.fixHint}）`))}`, { label: `测试仲裁#${it}`, phase: P6, schema: S_ARBITER, effort: 'high' })
        for (const d of (arb && arb.decisions) || []) {
          if (d.verdict === 'test_wrong') continue
          const mod = (/-(?:API|E2E|UI)-([A-Z]+)-/.exec(d.caseId) || [])[1] || 'CORE'
          next[d.owner === 'FE' ? 'FE' : 'BE'].push({ module: mod, text: `${d.caseId} | 仲裁：测试正确，代码需修复 | ${d.fixHint}` })
        }
      },
    ])
    if (uiSuspects.length || apiSuspects.length) await guardTestChanges(`核实与仲裁#${it}`)
    pending = next
    log(`第 ${it} 轮分诊：后端 ${next.BE.length}+CORE ${next.BE_CORE.length}，前端 ${next.FE.length}+CORE ${next.FE_CORE.length}，UI 核实 ${uiSuspects.length}，API 仲裁 ${apiSuspects.length}`)
  }
  log(`⛔ 已达到最大迭代次数 ${MAX_DEV_ITERS}`)
  return { pass: false, gate: lastGate, iterations: devIter, reason: 'max_iterations' }
}

let devResult = null, finalResult = null
if (want('dev') || want('final')) {
  if (!digest) {
    const d = await check(`${V} digest --brief`, 'digest', '读取测试锁摘要', P6)
    digest = d.digest || ''
    if (!digest) return { status: 'halted', stage: 'dev', reason: '没有找到测试锁，请先完成 build 阶段', summary }
  }
  if (!want('build')) { await refreshPacks('生成上下文包', P6); await loadModuleDeps(P6) }
}
if (want('dev')) {
  phase(P6)
  devResult = await tddLoop()
  summary.stages.dev = { pass: devResult.pass, iterations: devIter, reason: devResult.reason || '' }
}

// ============================================================ 阶段 7：交付验收
const CRITIC = `你是交付验收官。依据 PROBLEM.md 的验收流程 1–10 与交付物清单、docs/trace/matrix.md、.workflow/reports/validate-final.json、evidence/（含 explore.json、ACCEPTANCE-FLOW、_smoke/summary.json 与真实 popup 截图），检查：每个验收步骤是否有通过的用例、探索记录或冒烟记录作证；验收流程截图是否来自真实 action popup 与首次安装状态（不是 tab）；P0 Feature 是否全部「✅ 已验证」；README 的安装与启动步骤是否与冒烟实际执行的一致；实际执行 PORT=4120 scripts/start.sh（后台）后 curl http://127.0.0.1:4120/api/health，再关闭进程（只读验证）。owner 填 BE / FE / DOC / TEST。`

const runCmd = (cmd, label, ph) => agent(`${PRE}\n你是「确定性执行器」：执行 cd "${ROOT}" && ${cmd}，如实转录。结构化输出：summary（关键输出）、files（生成或修改的文件）。`, { label, phase: ph, schema: S_PRODUCE, effort: 'low' })

if (want('final') && (!devResult || devResult.pass)) {
  phase(P7)
  await parallel([
    () => agent(`${PRE}\n你是技术文档工程师，只写 README.md：项目简介；目录结构；快速开始（环境、scripts/start.sh、Chrome 开发者模式加载 extension/、首次打开插件时如何配置后端地址、导入样例）；架构说明（链接 docs/05）；API 列表；数据模型；评分策略说明；规则解析说明（支持 / 不支持的句式）；诊断说明（含义与排查）；测试说明（分层、scripts/test.sh、evidence/ 留痕、真实安装冒烟、追溯矩阵、测试报告）；需求追溯；演示脚本（验收 1–10 步）；面试追问要点。以实际代码为准，先读 server/ 与 extension/ 再写；安装和启动步骤要与 evidence/_smoke 的实际执行一致。\n结构化输出：summary、files。`, { label: '交付文档 README', phase: P7, schema: S_PRODUCE }),
    () => check(`${V} final --expect-digest=${digest} --brief`, 'final', '终检·全量执行', P7),
  ])
  const fin = await check(`${V} final --expect-digest=${digest} --brief ; ${V} trace --brief`, 'final', '终检（含 README、冒烟、对齐、看板、工具链）', P7)
  const [, critic] = await parallel([
    () => work({ kind: 'test', key: 'quality-report', label: '质量报告', phase: P7,
      brief: `你是测试负责人，按 .agents/skills/nav-quality-report/SKILL.md 产出 docs/08-测试报告.md（含 METRICS 自动区块、覆盖率、变异杀死率、证据完整率、状态快照覆盖率、真实安装冒烟（H8）、看板与基线变更记录、TDD 过程：共 ${devIter} 轮，每轮结果见 .workflow/reports/gate-iter-*.json）。「代表性证据」一节必须引用 evidence/_smoke/ 中真实 action popup 的截图。`,
      dod: ['按技能「自检」一节逐项通过'] }),
    () => review(CRITIC, '交付验收', P7),
  ])
  const blocking = ((critic && critic.issues) || []).filter((i) => i.severity !== 'minor')
  finalResult = { pass: fin.pass && !blocking.length, finalCheck: { pass: fin.pass, errors: fin.errors.slice(0, 20), run: fin.run }, critic: critic && { summary: critic.summary, issues: blocking } }
  log(`终检：validator ${fin.pass ? '✅' : `❌ ${fin.errors.length} 个错误`}；交付验收 blocker/major ${blocking.length} 条`)
  summary.stages.final = { pass: finalResult.pass }

  if (finalResult.pass) {
    // 人工验收关卡：真实的人在自己的浏览器里装插件、点图标、走一遍验收流程
    await runCmd(`test -f evidence/_manual/checklist.md || ${V} manual --init --brief`, '生成人工验收清单', P7)
    if (!A.manualAccepted) {
      log('⏸ 自动化验收全部通过，等待人工验收：按 evidence/_manual/checklist.md 在自己的 Chrome 中安装并走完验收流程，填写结论和截图后续跑')
      return {
        status: 'awaiting_manual_acceptance',
        checklist: 'evidence/_manual/checklist.md',
        resume: { from: 'final', manualAccepted: true, digest },
        stages: summary.stages, devIterations: devIter, testsDigest: digest, final: finalResult,
        warnings: summary.warnings.slice(0, 30), needsHuman: summary.needsHuman, openQuestions: summary.openQuestions.slice(0, 40),
      }
    }
    const man = await check(`${V} manual --check --brief`, 'manual', '人工验收核对', P7)
    if (!man.pass) return { status: 'manual_acceptance_incomplete', errors: man.errors.slice(0, 20), checklist: 'evidence/_manual/checklist.md', resume: { from: 'final', manualAccepted: true, digest }, summary }
    // 代码冻结：之后任何代码改动都要重跑门禁和冒烟；然后做提交打包预检（只预检，不改动目录结构）
    await check(`${V} freeze --record --brief`, 'freeze', '代码冻结', P7)
    await runCmd('node .agents/skills/nav-quality-report/scripts/collect-metrics.mjs --inject', '质量报告刷新（含人工验收结论）', P7)
    const sub = await check(`${V} release --brief`, 'release', '交付前最后一关（冻结核对 + 人工验收 + 提交打包预检）', P7)
    finalResult.release = { pass: sub.pass, errors: sub.errors.slice(0, 20) }
    finalResult.pass = finalResult.pass && sub.pass
    log(`交付前检查：${sub.pass ? '✅ 可以提交（执行 node .workflow/tools/pack-submission.mjs --apply --yes 前请先确认备份位置）' : `❌ ${sub.errors.length} 个问题`}`)
  }
}

const ok = (!want('dev') || (devResult && devResult.pass)) && (!want('final') || (finalResult && finalResult.pass))
return {
  status: ok ? 'success' : 'incomplete',
  stages: summary.stages,
  devIterations: devIter,
  testsDigest: digest,
  engines: summary.engines,
  sessions,
  lastGate: devResult && devResult.gate ? { pass: devResult.gate.pass, run: devResult.gate.run && { total: devResult.gate.run.total, passed: devResult.gate.run.passed, failed: devResult.gate.run.failed, casesPassed: devResult.gate.run.casesPassed, casesTotal: devResult.gate.run.casesTotal }, errors: (devResult.gate.errors || []).slice(0, 15) } : null,
  final: finalResult,
  warnings: summary.warnings.slice(0, 30),
  needsHuman: summary.needsHuman,
  openQuestions: summary.openQuestions.slice(0, 40),
}
