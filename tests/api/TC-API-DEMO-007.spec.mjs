// TC-API-DEMO-007 —— 用例来源 docs/trace/cases-api.json（F-DEMO-02 / C-BE-DEMO-03）
// S1 POST /api/__test__/reset  S2 spawn node scripts/import-sample.mjs（API_BASE 指向不可达端口）  S3 GET /api/health
// 说明：API_BASE=http://127.0.0.1:9 模拟后端不可达（无服务端口）；导入脚本应在 15 秒内非 0 退出，
//       且不能影响正在运行的测试后端（pageCount=0、health 仍 200）。不 mock、不 route，只回收自己启动的进程。
import { test, expect } from '../fixtures/api.mjs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WAIT_EXIT_MS = 15_000;
const UNREACHABLE_BASE = 'http://127.0.0.1:9'; // 用例 testData：无服务端口，模拟后端不可达

test('TC-API-DEMO-007 后端不可达时导入脚本以非 0 退出码结束，不影响正在运行的后端', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-007-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = { stdoutLog: path.join(logDir, 'import-sample.stdout.log'), stderrLog: path.join(logDir, 'import-sample.stderr.log') };
  let handle = null;

  try {
    await test.step('S1：POST /api/__test__/reset', async () => {
      await api.reset();
    });

    const exit = await test.step('S2：spawn node scripts/import-sample.mjs（API_BASE=http://127.0.0.1:9），等待退出', async () => {
      expect(fs.existsSync(path.join(ROOT, 'scripts/import-sample.mjs')), '[setup] 导入入口必须已交付，避免入口缺失被误判为后端不可达').toBe(true);
      handle = spawnScript(process.execPath, ['scripts/import-sample.mjs'], { API_BASE: UNREACHABLE_BASE }, logs);
      evidence.note(`import-sample pid=${handle.child.pid} API_BASE=${UNREACHABLE_BASE}（不可达）`);
      await delay(100);
      expect(handle.state.spawnError, '[ENV] scripts/import-sample.mjs 可以启动（排除 ENOENT）').toBeNull();
      const result = await waitForExit(handle, WAIT_EXIT_MS);
      evidence.note(`import-sample 退出 ${JSON.stringify(result)}；输出已写入 ${logDir}`);
      return result;
    });

    expect(exit, '[E1] S2 中导入脚本在 15 秒内退出（非超时）').not.toBeNull();
    expect(exit.signal, '[E1] 导入脚本以非 0 退出码结束（不是被信号杀死）').toBeNull();
    expect(exit.code, '[E1] 后端不可达时导入脚本退出码 ≠ 0').not.toBe(0);
    expect(handle.state.out + handle.state.err, '[E1] stdout + stderr 合并文本非空（不能静默失败）').toMatch(/\S/);

    await test.step('S3：GET /api/health（测试后端）', async () => {
      const r = await api.get('/api/health');
      expect(r.status, '[E2] 测试后端仍可用，health 返回 200').toBe(200);
      expect(r.body.pageCount, '[E2] 失败的导入没有写入任何页面，pageCount=0').toBe(0);
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
