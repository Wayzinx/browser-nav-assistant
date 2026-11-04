// TC-API-DEMO-008 —— 用例来源 docs/trace/cases-api.json（F-DEMO-02 / C-BE-DEMO-03、C-BE-DEMO-02）
// S1 POST /api/__test__/reset  S2 第一次 spawn 导入脚本  S3 第二次 spawn 导入脚本  S4 GET /api/health
// 说明：两次导入同一份 resources/sample-history.json（URL 集合相同），页面数必须稳定在 10，
//       重复导入不新增页面。导入脚本走真实 POST /api/sync；只回收自己启动的进程，不 mock、不 route。
import { test, expect } from '../fixtures/api.mjs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TEST_PORT = Number(process.env.TEST_PORT || 4100);
const API_BASE = `http://127.0.0.1:${TEST_PORT}`; // 导入脚本按用例通过 API_BASE 指向测试后端
const WAIT_EXIT_MS = 15_000;

test('TC-API-DEMO-008 连续执行两次样例导入：页面数保持 10', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-008-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = [
    { stdoutLog: path.join(logDir, 'import-1.stdout.log'), stderrLog: path.join(logDir, 'import-1.stderr.log') },
    { stdoutLog: path.join(logDir, 'import-2.stdout.log'), stderrLog: path.join(logDir, 'import-2.stderr.log') },
  ];
  const handles = [];

  try {
    await test.step('S1：POST /api/__test__/reset', async () => {
      await api.reset();
    });

    const firstExit = await test.step('S2：spawn node scripts/import-sample.mjs（API_BASE=测试后端），等待退出', () =>
      runImport(handles, logs[0], evidence, 1));

    const secondExit = await test.step('S3：再次 spawn node scripts/import-sample.mjs，等待退出', () =>
      runImport(handles, logs[1], evidence, 2));

    expect(firstExit, '[E1] S2 中第一次导入在 15 秒内退出，退出码=0').toMatchObject({ code: 0 });
    expect(secondExit, '[E1] S3 中第二次导入在 15 秒内退出，退出码=0').toMatchObject({ code: 0 });

    await test.step('S4：GET /api/health', async () => {
      const r = await api.get('/api/health');
      expect(r.status, '[E2] health 返回 200').toBe(200);
      expect(r.body.pageCount, '[E2] 两次导入后 pageCount=10（重复导入不新增页面）').toBe(10);
    });
  } finally {
    for (const handle of handles) await killIfAlive(handle);
    if (!evidence.enabled) fs.rmSync(logDir, { recursive: true, force: true });
  }
});

/** 启动一次导入并等待退出（超时上限 15 秒）；stdout / stderr 全量写入 evidence/<CaseID>/ */
async function runImport(handles, logFiles, evidence, seq) {
  const handle = spawnScript(process.execPath, ['scripts/import-sample.mjs'], { API_BASE }, logFiles);
  handles.push(handle);
  evidence.note(`第 ${seq} 次 import-sample pid=${handle.child.pid} API_BASE=${API_BASE}`);
  await delay(100);
  expect(handle.state.spawnError, '[ENV] scripts/import-sample.mjs 可以启动（排除 ENOENT）').toBeNull();
  const exit = await waitForExit(handle, WAIT_EXIT_MS);
  evidence.note(`第 ${seq} 次 import-sample 退出 ${JSON.stringify(exit)}`);
  return exit;
}

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
