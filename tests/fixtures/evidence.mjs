// 测试留痕（AGENTS.md 约定 3）：每个 Case 的执行证据写入 evidence/<CaseID>/。
// api.mjs 和 extension.mjs 会自动启用本模块，用例脚本不需要手动调用。
//
// evidence/<CaseID>/
//   result.json      执行结果（状态、耗时、失败的 [En]、错误信息、自定义指标）
//   api/NN-*.json    每次 HTTP 调用的请求和响应（API / E2E / UI 中的后端核对调用）
//   server.log       本用例执行期间的后端 JSON 日志切片
//   screenshots/     UI 步骤截图（ext.snap 截取，以及收尾时自动截的 final 图）
//   flow.gif         用截图合成的操作动图
//   extension.log    插件 service worker 和页面的 console 输出
//   state-before.json / state-after.json / state-diff.json
//                    用例前后的后端状态快照（GET /api/__test__/state，BE-RUN-07）及差异；参数化变体追加 -t<n> 后缀
//   explore.json、explore/   由 UI 探索 agent 写入（本模块不会清理这两项）
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const EVIDENCE_DIR = path.resolve(ROOT, process.env.EVIDENCE_DIR || 'evidence');
export const RUN_ID = process.env.EVIDENCE_RUN_ID || 'adhoc';
export const SERVER_LOG_FILE = process.env.SERVER_LOG_FILE || '';
// 断言有效性检查（run-cases.mjs --mutation）时才会设置；正常执行时为空
export const MUTATION_OPS = (process.env.MUTATION_OPS || '').split(',').map((s) => s.trim()).filter(Boolean);

const CASE_RE = /\bTC-(?:API|E2E|UI)-[A-Z]{2,10}-\d{3}\b/;
const AUTO_ITEMS = ['result.json', 'api', 'screenshots', 'flow.gif', 'server.log', 'extension.log'];
const isStateFile = (name) => /^state-(?:before|after|diff)(?:-t\d+)?\.json$/.test(name);
const MAX_BODY_CHARS = 200_000;

export const caseIdOf = (title) => (String(title).match(CASE_RE) || [])[0] || null;
const pad = (n) => String(n).padStart(2, '0');
const slug = (s) => String(s).replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '')
  .replace(/[^a-zA-Z0-9一-龥]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'root';
const stripAnsi = (s) => String(s || '').replace(/\u001b\[[0-9;]*m/g, '');
const sizeOf = (f) => { try { return fs.statSync(f).size; } catch { return 0; } };
const countFiles = (d) => { try { return fs.readdirSync(d).length; } catch { return 0; } };

function clip(value) {
  if (value == null) return value;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= MAX_BODY_CHARS) return value;
  return { truncated: true, totalChars: text.length, preview: text.slice(0, MAX_BODY_CHARS) };
}

export class Evidence {
  constructor(testInfo) {
    this.testInfo = testInfo;
    this.caseId = caseIdOf(testInfo.title);
    this.mutation = MUTATION_OPS.length
      ? (testInfo.repeatEachIndex === 0 ? 'baseline' : MUTATION_OPS[(testInfo.repeatEachIndex - 1) % MUTATION_OPS.length])
      : null;
    this.mutationApplied = false;
    this.enabled = Boolean(this.caseId) && !this.mutation; // 变异检查的运行不写证据，避免覆盖正式结果
    this.dir = this.caseId ? path.join(EVIDENCE_DIR, this.caseId) : null;
    this.apiCalls = [];
    this.screenshots = [];
    this.extLogs = [];
    this.metrics = {};
    this.notes = [];
    this.state = { before: null, after: null };
    this.stateSuffix = '';
    this.lastShotHash = null;
    this.dedupedShots = 0;
    this.startedAt = Date.now();
    this.logOffset = sizeOf(SERVER_LOG_FILE);
  }

  prepare() {
    if (!this.enabled) return;
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(path.join(this.dir, 'result.json'), 'utf8')); } catch { prev = null; }
    const rerun = !prev || prev.runId !== RUN_ID || (prev.tests || []).some((t) => t.testId === this.testInfo.testId);
    if (rerun) {
      for (const item of AUTO_ITEMS) fs.rmSync(path.join(this.dir, item), { recursive: true, force: true });
      for (const name of (fs.existsSync(this.dir) ? fs.readdirSync(this.dir) : []).filter(isStateFile)) fs.rmSync(path.join(this.dir, name), { force: true });
    }
    fs.mkdirSync(this.dir, { recursive: true });
    // 同一个 Case 的第 n 个 test（参数化变体）写 state-*-t<n>.json，不覆盖前面的
    this.stateSuffix = rerun ? '' : `-t${((prev && prev.tests) || []).length + 1}`;
    // 同一个 Case 有多个 test（参数化变体）时，文件序号接着往下排，不互相覆盖
    this.apiSeq = countFiles(path.join(this.dir, 'api'));
    this.shotSeq = countFiles(path.join(this.dir, 'screenshots'));
  }

  recordApi(entry) {
    this.apiCalls.push({ reqId: entry.reqId, method: entry.method, url: entry.url, status: entry.status, ms: entry.ms, setup: entry.setup });
    if (!this.enabled) return;
    fs.mkdirSync(path.join(this.dir, 'api'), { recursive: true });
    const file = path.join(this.dir, 'api', `${pad(++this.apiSeq)}-${entry.method}-${slug(entry.url)}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...entry, requestBody: clip(entry.requestBody), responseBody: clip(entry.responseBody) }, null, 2));
  }

  async screenshot(page, name) {
    if (!this.enabled) return null;
    const buf = await page.screenshot({ fullPage: true });
    // 与上一张内容完全相同（例如断言前后页面没有变化）就不再保存，避免证据看起来很多、信息很少
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    if (hash === this.lastShotHash) { this.dedupedShots++; return null; }
    this.lastShotHash = hash;
    fs.mkdirSync(path.join(this.dir, 'screenshots'), { recursive: true });
    const file = path.join(this.dir, 'screenshots', `${pad(++this.shotSeq)}-${slug(name)}.png`);
    fs.writeFileSync(file, buf);
    this.screenshots.push(path.relative(ROOT, file));
    this.testInfo.attachments.push({ name: `screenshot ${name}`, path: file, contentType: 'image/png' });
    return file;
  }

  extLog(source, msg) {
    this.extLogs.push({ ts: new Date().toISOString(), source, type: msg.type ? msg.type() : 'error', text: msg.text ? msg.text() : String(msg.stack || msg) });
  }

  /** 记录自定义指标（例如性能用例的 p95），质量报告会汇总 */
  metric(name, value, unit = '') { this.metrics[name] = { value, unit }; }

  note(text) { this.notes.push(String(text)); }

  /** 记录用例前（before）/ 后（after）的后端状态快照，由 api 夹具调用 */
  setState(kind, value) { if (this.enabled) this.state[kind] = value; }

  async finalize() {
    if (!this.enabled) return;
    const ti = this.testInfo;
    const endedAt = Date.now();
    let serverLogLines = 0;
    if (SERVER_LOG_FILE && sizeOf(SERVER_LOG_FILE) > this.logOffset) {
      const fd = fs.openSync(SERVER_LOG_FILE, 'r');
      const buf = Buffer.alloc(sizeOf(SERVER_LOG_FILE) - this.logOffset);
      fs.readSync(fd, buf, 0, buf.length, this.logOffset);
      fs.closeSync(fd);
      fs.appendFileSync(path.join(this.dir, 'server.log'), buf);
      serverLogLines = buf.toString('utf8').split('\n').filter(Boolean).length;
    }
    if (this.extLogs.length) {
      fs.appendFileSync(path.join(this.dir, 'extension.log'), this.extLogs.map((l) => JSON.stringify(l)).join('\n') + '\n');
    }
    if (this.screenshots.length) await this.#buildGif();
    let stateDiffSummary = null;
    if (this.state.before || this.state.after) {
      const w = (name, v) => fs.writeFileSync(path.join(this.dir, `${name}${this.stateSuffix}.json`), JSON.stringify(v, null, 2));
      if (this.state.before) w('state-before', this.state.before);
      if (this.state.after) w('state-after', this.state.after);
      if (this.state.before && this.state.after) {
        const diff = diffState(this.state.before, this.state.after);
        w('state-diff', diff);
        stateDiffSummary = diff.summary;
      }
    }

    const errors = (ti.errors || []).map((e) => stripAnsi(e.message || e.value || '').slice(0, 4000));
    const entry = {
      testId: ti.testId,
      title: ti.title,
      project: ti.project.name,
      file: path.relative(ROOT, ti.file),
      repeatEachIndex: ti.repeatEachIndex,
      status: ti.status,
      expectedStatus: ti.expectedStatus,
      durationMs: endedAt - this.startedAt,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      failedExpect: [...new Set(errors.join('\n').match(/\[E\d+\]/g) || [])],
      errors,
      apiCalls: this.apiCalls.length,
      screenshots: this.screenshots,
      serverLogLines,
      metrics: this.metrics,
      stateDiffSummary,
      dedupedShots: this.dedupedShots,
      notes: this.notes,
    };
    const resultFile = path.join(this.dir, 'result.json');
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(resultFile, 'utf8')); } catch { prev = null; }
    const tests = (prev && prev.runId === RUN_ID ? prev.tests || [] : []).filter((t) => t.testId !== ti.testId).concat(entry);
    const status = tests.every((t) => t.status === t.expectedStatus) ? 'passed' : 'failed';
    fs.writeFileSync(resultFile, JSON.stringify({ caseId: this.caseId, runId: RUN_ID, status, updatedAt: new Date(endedAt).toISOString(), tests }, null, 2));
  }

  async #buildGif() {
    let PNG, gifenc;
    try {
      ({ PNG } = await import('pngjs'));
      gifenc = await import('gifenc');
    } catch {
      this.note('未安装 pngjs / gifenc，跳过 flow.gif 生成');
      return;
    }
    const { GIFEncoder, quantize, applyPalette } = gifenc.default || gifenc;
    const shotDir = path.join(this.dir, 'screenshots');
    const frames = fs.readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort()
      .map((f) => PNG.sync.read(fs.readFileSync(path.join(shotDir, f))));
    if (!frames.length) return;
    const width = Math.max(...frames.map((f) => f.width));
    const height = Math.min(Math.max(...frames.map((f) => f.height)), 2000);
    const gif = GIFEncoder();
    for (const frame of frames) {
      const rgba = new Uint8Array(width * height * 4).fill(255); // 尺寸不一致的帧用白色补齐
      for (let y = 0; y < Math.min(frame.height, height); y++) {
        rgba.set(frame.data.subarray(y * frame.width * 4, (y + 1) * frame.width * 4), y * width * 4);
      }
      const palette = quantize(rgba, 256);
      gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay: 900 });
    }
    gif.finish();
    fs.writeFileSync(path.join(this.dir, 'flow.gif'), gif.bytes());
  }
}

/**
 * 后端状态差异：pages 按 normalizedUrl、rules 按 id 对比，给出新增 / 删除 / 字段变化，以及计数和配置的变化。
 * pagesTruncated（超过 2000 页）时只比较 pagesHash。
 * @param {any} before @param {any} after
 */
export function diffState(before, after) {
  const keyed = (list, key) => new Map((list || []).map((x) => [x[key] ?? x.url ?? x.id, x]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const diffList = (b, a, key) => {
    const B = keyed(b, key);
    const A = keyed(a, key);
    const added = [...A.keys()].filter((k) => !B.has(k)).map((k) => A.get(k));
    const removed = [...B.keys()].filter((k) => !A.has(k)).map((k) => B.get(k));
    const changed = [];
    for (const [k, av] of A) {
      if (!B.has(k)) continue;
      const bv = B.get(k);
      const fields = {};
      for (const f of new Set([...Object.keys(bv), ...Object.keys(av)])) if (!same(bv[f], av[f])) fields[f] = { before: bv[f], after: av[f] };
      if (Object.keys(fields).length) changed.push({ key: k, fields });
    }
    return { added, removed, changed };
  };
  const truncated = Boolean(before.pagesTruncated || after.pagesTruncated);
  const pages = truncated ? { hashChanged: before.pagesHash !== after.pagesHash, added: [], removed: [], changed: [] } : diffList(before.pages, after.pages, 'normalizedUrl');
  const rules = diffList(before.rules, after.rules, 'id');
  const counts = {};
  for (const k of new Set([...Object.keys(before.counts || {}), ...Object.keys(after.counts || {})])) {
    const b = (before.counts || {})[k] ?? 0;
    const a = (after.counts || {})[k] ?? 0;
    counts[k] = { before: b, after: a, delta: a - b };
  }
  const config = {};
  for (const k of new Set([...Object.keys(before.config || {}), ...Object.keys(after.config || {})])) {
    if (!same((before.config || {})[k], (after.config || {})[k])) config[k] = { before: (before.config || {})[k], after: (after.config || {})[k] };
  }
  const persistChanged = Boolean(before.persist || after.persist) && !same(before.persist && before.persist.sha256, after.persist && after.persist.sha256);
  return {
    summary: {
      dataVersion: { before: before.dataVersion, after: after.dataVersion },
      pages: truncated ? { truncated: true, hashChanged: pages.hashChanged } : { added: pages.added.length, removed: pages.removed.length, changed: pages.changed.length },
      rules: { added: rules.added.length, removed: rules.removed.length, changed: rules.changed.length },
      counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, v.delta])),
      configChanged: Object.keys(config),
      persistChanged,
    },
    counts, pages, rules, config,
  };
}
