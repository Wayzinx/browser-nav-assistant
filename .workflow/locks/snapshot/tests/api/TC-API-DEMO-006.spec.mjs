// TC-API-DEMO-006 —— 用例来源 docs/trace/cases-api.json（F-DEMO-02 / C-BE-DEMO-03）
// S1 POST /api/__test__/reset  S2 记录 t0 / t1 并执行导入脚本  S3 GET /api/pages/cleanup-suggestions
// 期望：issues/100 与 Google 页的 lastVisitedAt 严格相差 1000000000 ms（平移不改变相对间隔），
//       且 issues/100 落在 [t0 − 2100300000, t1 − 2100300000]（导入时刻 ± 进程耗时窗口）。
import { test, expect } from '../fixtures/api.mjs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_PORT = Number(process.env.TEST_PORT || 4100);
const API_BASE = `http://127.0.0.1:${TEST_PORT}`;
const WAIT_EXIT_MS = 15_000;

const ISSUE_URL = 'https://github.com/org/repo/issues/100';
const GOOGLE_URL = 'https://www.google.com/search?q=chrome+extension+manifest+v3';
const SHIFT_MS = 2_100_300_000; // 5 分钟平移 + issues/100 与最新一条的 2100000000 ms 间隔

test('TC-API-DEMO-006 时间平移保持相对间隔：issues/100 与 Google 页相差 1000000000 ms 且落在导入时刻窗口内', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-006-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = { stdoutLog: path.join(logDir, 'import-sample.stdout.log'), stderrLog: path.join(logDir, 'import-sample.stderr.log') };
  let handle = null;

  try {
    await test.step('S1：POST /api/__test__/reset', async () => {
      await api.reset();
    });

    const window = await test.step('S2：记录 t0=Date.now()，执行导入脚本后记录 t1=Date.now()', async () => {
      const t0 = Date.now();
      handle = spawnScript(process.execPath, ['scripts/import-sample.mjs'], { API_BASE }, logs);
      evidence.note(`t0=${t0} import-sample pid=${handle.child.pid} API_BASE=${API_BASE}`);
      await delay(100);
      expect(handle.state.spawnError, '[ENV] scripts/import-sample.mjs 可以启动（排除 ENOENT）').toBeNull();
      const exit = await waitForExit(handle, WAIT_EXIT_MS);
      assertImported(exit, handle); // 前置：导入成功；本用例的 expected 只约束时间平移（E1 / E2）
      const t1 = Date.now();
      evidence.note(`t1=${t1} import-sample 退出 ${JSON.stringify(exit)}`);
      return { t0, t1 };
    });

    await test.step('S3：GET /api/pages/cleanup-suggestions', async () => {
      const r = await api.get('/api/pages/cleanup-suggestions');
      expect(r.status, '前置：整理建议接口返回 200').toBe(200);
      const archives = r.body.suggestions.filter((s) => s.action === 'archive');
      const issue = archives.find((s) => s.url === ISSUE_URL);
      const google = archives.find((s) => s.url === GOOGLE_URL);
      expect(issue, '前置：archive 中含 issues/100').toMatchObject({ url: ISSUE_URL });
      expect(google, '前置：archive 中含 Google 搜索页').toMatchObject({ url: GOOGLE_URL });
      expect(issue.lastVisitedAt - google.lastVisitedAt, '[E1] issues/100 与 Google 页的 lastVisitedAt 相差 1000000000 ms').toBe(1_000_000_000);
      expect(issue.lastVisitedAt, '[E2] issues/100 的 lastVisitedAt 不早于 t0 − 2100300000').toBeGreaterThanOrEqual(window.t0 - SHIFT_MS);
      expect(issue.lastVisitedAt, '[E2] issues/100 的 lastVisitedAt 不晚于 t1 − 2100300000').toBeLessThanOrEqual(window.t1 - SHIFT_MS);
    });
  } finally {
    await killIfAlive(handle);
    if (!evidence.enabled) fs.rmSync(logDir, { recursive: true, force: true });
  }
});

// ── 本用例专用的子进程编排（公共夹具不提供；只回收自己启动的进程，不 mock、不 route）──────────────────

/** spawn 子进程并收集 stdout / stderr：全量写入 evidence/<CaseID>/，同时保留内存副本供断言使用 */
function spawnScript(command, args, env, { stdoutLog, stderrLog }) {
  const outFd = fs.openSync(stdoutLog, 'a');
  const errFd = fs.openSync(stderrLog, 'a');
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { out: '', err: '', exit: null, spawnError: null };
  child.stdout.on('data', (chunk) => { state.out += chunk.toString(); fs.writeSync(outFd, chunk); });
  child.stderr.on('data', (chunk) => { state.err += chunk.toString(); fs.writeSync(errFd, chunk); });
  child.once('error', (error) => { state.spawnError = error; });
  child.once('close', (code, signal) => { state.exit = { code, signal }; });
  return { child, state, fds: [outFd, errFd] };
}

/** 导入超时约束：最多等 timeoutMs；超时返回 null，由调用处的断言给出可读失败 */
async function waitForExit(handle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (handle.state.exit === null && Date.now() < deadline) await delay(25);
  return handle.state.exit;
}

/** 导入成功是 S3 断言的前置条件（不是本用例的 expected），失败时归到 SETUP 分类 */
function assertImported(exit, handle) {
  const ok = exit !== null && exit.code === 0;
  if (!ok) {
    const output = (handle.state.out + handle.state.err).slice(-800);
    throw new Error(`[setup] 样例导入脚本没有在 15 秒内以退出码 0 结束（exit=${JSON.stringify(exit)}）：\n${output}`);
  }
}

/** 只回收自己启动的进程：活着就先 SIGKILL，再关闭日志 fd（幂等） */
async function killIfAlive(handle) {
  if (handle && !handle.closed) {
    handle.closed = true;
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill('SIGKILL');
      await waitForExit(handle, 2_000);
    }
    for (const fd of handle.fds) fs.closeSync(fd);
  }
}
