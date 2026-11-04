// TC-API-DEMO-005 —— 用例来源 docs/trace/cases-api.json（F-DEMO-02 / C-BE-DEMO-03、C-BE-DEMO-02）
// S1 POST /api/__test__/reset  S2 spawn node scripts/import-sample.mjs（API_BASE=测试后端）等待退出
// S3 GET /api/pages/cleanup-suggestions
// 说明：期望值取自用例 testData（D-01 平移：24.3 天 → ageDays=24，35.9 天 → ageDays=35）。
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
const REASON = (days) => `超过 14 天未访问（已 ${days} 天），且不在当前打开的 tab 中`;

test('TC-API-DEMO-005 样例导入后整理建议 archive 含 issues/100（ageDays=24）和 Google 搜索页（ageDays=35）', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-005-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = { stdoutLog: path.join(logDir, 'import-sample.stdout.log'), stderrLog: path.join(logDir, 'import-sample.stderr.log') };
  let handle = null;

  try {
    await test.step('S1：POST /api/__test__/reset', async () => {
      await api.reset();
    });

    await test.step('S2：spawn node scripts/import-sample.mjs（API_BASE=测试后端），等待退出', async () => {
      handle = spawnScript(process.execPath, ['scripts/import-sample.mjs'], { API_BASE }, logs);
      evidence.note(`import-sample pid=${handle.child.pid} API_BASE=${API_BASE}`);
      await delay(100);
      expect(handle.state.spawnError, '[ENV] scripts/import-sample.mjs 可以启动（排除 ENOENT）').toBeNull();
      const exit = await waitForExit(handle, WAIT_EXIT_MS);
      expect(exit, '[E1] S2 中导入脚本在 15 秒内退出，退出码=0').toMatchObject({ code: 0 });
      evidence.note(`import-sample 退出 ${JSON.stringify(exit)}`);
    });

    await test.step('S3：GET /api/pages/cleanup-suggestions', async () => {
      const r = await api.get('/api/pages/cleanup-suggestions');
      expect(r.status, '[E2] 整理建议接口返回 200').toBe(200);
      expect(r.body.summary, '[E2] summary 严格等于 { archive: 2, merge: 1, keep: 0 }').toEqual({ archive: 2, merge: 1, keep: 0 });
      const archives = r.body.suggestions.filter((s) => s.action === 'archive');
      const issue = archives.find((s) => s.url === ISSUE_URL);
      const google = archives.find((s) => s.url === GOOGLE_URL);
      expect(issue, '[E3] archive 含 issues/100 且 ageDays=24、理由为「已 24 天」').toMatchObject({ ageDays: 24, reason: REASON(24) });
      expect(google, '[E4] archive 含 Google 搜索页且 ageDays=35、理由为「已 35 天」').toMatchObject({ ageDays: 35, reason: REASON(35) });
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
