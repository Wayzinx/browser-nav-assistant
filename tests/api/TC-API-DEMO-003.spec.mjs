// TC-API-DEMO-003 —— 用例来源 docs/trace/cases-api.json（F-DEMO-01 / C-BE-DEMO-01、C-BE-CORE-01、C-BE-CORE-15）
// S1 GET /api/health：确认原服务（webServer 测试后端）正在占用 TEST_PORT，记录 startedAt
// S2 spawn ./scripts/start.sh（PORT=TEST_PORT）  S3 等待子进程退出（≤15s）
// S4 再次 GET /api/health：原服务仍正常，startedAt 不变
// 说明（仲裁）：占用者由「不响应 HTTP 的 net 占位 server」改为「已在运行的后端实例」——这正是端口冲突的真实场景，
// 同时让 S4 成为被测调用并在共享日志中留下 server.log（AGENTS.md 约定 3、CONVENTIONS §5 证据要求）。
import { test, expect } from '../fixtures/api.mjs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test.use({ autoReset: false }); // 本用例不依赖测试后端的数据，只把它当作「占用端口的原服务」

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.TEST_PORT || 4100); // 与 playwright.config.mjs 的 webServer 端口取法一致
const WAIT_EXIT_MS = 15_000;

// 证据留痕：start.sh 若意外拉起后端，其日志也会进入夹具切片用的共享日志（BE-LOG-02）
const sharedLogEnv = () => (process.env.SERVER_LOG_FILE ? { LOG_FILE: process.env.SERVER_LOG_FILE } : {});

test('TC-API-DEMO-003 端口已被占用时 start.sh 以退出码 1 结束并提示换 PORT', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-003-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = { stdoutLog: path.join(logDir, 'start.stdout.log'), stderrLog: path.join(logDir, 'start.stderr.log') };
  const snapshotFile = path.join(logDir, 'snapshot.json'); // 避免写入 data/
  let handle = null;

  try {
    const before = await test.step('S1：GET /api/health（原服务，TEST_PORT），确认端口被占用并记录 startedAt', async () => {
      const r = await api.get('/api/health', { setup: true }); // 前置确认，不参与变异
      expect(r.status, `[ENV] 原服务（测试后端）在 ${PORT} 端口可用`).toBe(200);
      evidence.note(`原服务占用 127.0.0.1:${PORT}，startedAt=${r.body.startedAt}`);
      return r.body;
    });

    await test.step('S2：spawn ./scripts/start.sh，env 追加 PORT=TEST_PORT，收集 stdout + stderr', async () => {
      handle = spawnScript('./scripts/start.sh', [], { PORT: String(PORT), SNAPSHOT_FILE: snapshotFile, ...sharedLogEnv() }, logs);
      evidence.note(`start.sh pid=${handle.child.pid} PORT=${PORT}（被原服务占用）`);
      await delay(100);
      expect(handle.state.spawnError, '[ENV] start.sh 可以启动（排除 ENOENT / 权限错误）').toBeNull();
    });

    const exit = await test.step('S3：等待子进程退出（上限 15 秒）', () => waitForExit(handle, WAIT_EXIT_MS));
    evidence.note(`start.sh 退出 ${JSON.stringify(exit)}`);

    expect(exit, '[E1] S3 中子进程在 15 秒内退出，退出码=1').toMatchObject({ code: 1 });
    const output = handle.state.out + handle.state.err;
    expect(output, '[E2] stdout + stderr 合并文本提示端口已被占用').toContain('已被占用');
    expect(output, '[E2] stdout + stderr 合并文本给出 PORT= 的更换提示').toContain('PORT=');

    await test.step('S4：再次 GET /api/health（同一原服务）', async () => {
      const r = await api.get('/api/health');
      expect(r.status, '[E3] S4 原服务的 health 返回 200').toBe(200);
      expect(r.body, '[E3] S4 body.status="ok"').toMatchObject({ status: 'ok' });
      expect(r.body.startedAt, '[E3] S4 body.startedAt 与 S1 相同（原服务未被替换或中断）').toBe(before.startedAt);
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

/** 超时约束：最多等 timeoutMs；超时返回 null，由调用处的断言给出可读失败 */
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
