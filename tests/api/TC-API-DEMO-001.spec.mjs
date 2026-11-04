// TC-API-DEMO-001 —— 用例来源 docs/trace/cases-api.json（F-DEMO-01 / C-BE-DEMO-01、C-BE-CORE-15、C-BE-CORE-01）
// S1 spawn ./scripts/start.sh（PORT=4120，收集 stdout）  S2 轮询 stdout 中的 health JSON（≤15s）
// S3 GET http://127.0.0.1:4120/api/health               S4 SIGTERM 并等待退出（≤5s）
// 说明：用例要求真实子进程 + 真实 HTTP；公共夹具不提供进程编排能力，编排保留在本文件内，不 import 产品源码。
import { test, expect } from '../fixtures/api.mjs';
import fs from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test.use({ autoReset: false }); // 本用例只访问 4120 上由 start.sh 启动的进程，不依赖测试后端的数据

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = 4120;
const WAIT_OUTPUT_MS = 15_000;
const WAIT_EXIT_MS = 5_000;

test('TC-API-DEMO-001 设置 PORT=4120 执行 start.sh：health 返回 200 且终端打印 status=ok', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-001-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = { stdoutLog: path.join(logDir, 'start.stdout.log'), stderrLog: path.join(logDir, 'start.stderr.log') };
  const snapshotFile = path.join(logDir, 'snapshot.json'); // 用例 testData：避免写入 data/
  let handle = null;

  try {
    await test.step('S1：spawn ./scripts/start.sh，env 追加 PORT=4120，收集 stdout', async () => {
      handle = spawnScript('./scripts/start.sh', [], { PORT: String(PORT), SNAPSHOT_FILE: snapshotFile, ...sharedLogEnv() }, logs);
      evidence.note(`start.sh pid=${handle.child.pid} PORT=${PORT} snapshot=${snapshotFile}`);
      await delay(100);
      expect(handle.state.spawnError, '[ENV] start.sh 可以启动（排除 ENOENT / 权限错误）').toBeNull();
    });

    const health = await test.step('S2：轮询 stdout，直到出现包含 "status" 的 JSON 行或 15 秒超时', () =>
      waitForHealthLine(handle, WAIT_OUTPUT_MS));

    expect(health, '[E1] S2 在 15 秒内出现可 JSON.parse 的 health 输出').toMatchObject({ status: 'ok', version: '1.0.0' });

    await test.step('S3：GET http://127.0.0.1:4120/api/health', async () => {
      const r = await api.get(`http://127.0.0.1:${PORT}/api/health`);
      expect(r.status, '[E2] 4120 端口的 health 返回 200').toBe(200);
      expect(r.body, '[E2] body.status="ok"').toMatchObject({ status: 'ok' });
    });

    await test.step('S4：向子进程发送 SIGTERM，等待退出', async () => {
      handle.child.kill('SIGTERM');
      const exit = await waitForExit(handle, WAIT_EXIT_MS);
      expect(exit === null, '[E3] S4 后子进程在 5 秒内退出').toBe(false);
      const free = await portFree(PORT);
      expect(free, '[E3] 子进程退出后 4120 端口不再响应').toBe(true);
      evidence.note(`start.sh 退出 ${JSON.stringify(exit)}`);
    });
  } finally {
    await killIfAlive(handle);
    if (!evidence.enabled) fs.rmSync(logDir, { recursive: true, force: true });
  }
});

// 证据留痕（CONVENTIONS §5 / AGENTS.md 约定 3）：start.sh 拉起的后端按 BE-LOG-02 把日志追加写入夹具切片用的共享日志，
// 这样 evidence/<CaseID>/server.log 能按 x-request-id 对上 S3 的请求。
const sharedLogEnv = () => (process.env.SERVER_LOG_FILE ? { LOG_FILE: process.env.SERVER_LOG_FILE } : {});

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

const tail = (state) => (state.out + state.err).slice(-800);

const parseJsonLine = (text) => { try { return JSON.parse(text); } catch { return null; } }; // lint-allow-catch: stdout 里混有非 JSON 行，返回 null 供轮询跳过

/** 从 stdout 中取最后一行可解析的 health JSON（以 { 开头且整行含 "status"） */
function healthFromStdout(text) {
  const parsed = text.split('\n').map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.includes('"status"'))
    .map(parseJsonLine).filter((value) => value !== null);
  return parsed.length ? parsed[parsed.length - 1] : null;
}

/** 启动超时约束：轮询 stdout 最多 timeoutMs；子进程启动失败 / 提前退出立即抛错，不干等超时 */
async function waitForHealthLine(handle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let health = healthFromStdout(handle.state.out);
  while (health === null && Date.now() < deadline) {
    if (handle.state.spawnError) throw handle.state.spawnError;
    if (handle.state.exit) throw new Error(`start.sh 在输出 health 前退出（${JSON.stringify(handle.state.exit)}）：\n${tail(handle.state)}`);
    await delay(100);
    health = healthFromStdout(handle.state.out);
  }
  return health;
}

/** TCP 探测：端口当前是否可绑定（true = 空闲 / 已无监听） */
async function portFree(port) {
  const probe = net.createServer();
  const free = await new Promise((resolve) => {
    probe.once('error', () => resolve(false));
    probe.once('listening', () => resolve(true));
    probe.listen(port, '127.0.0.1');
  });
  await new Promise((resolve) => probe.close(() => resolve()));
  return free;
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
