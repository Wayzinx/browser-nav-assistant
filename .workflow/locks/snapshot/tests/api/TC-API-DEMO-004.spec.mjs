// TC-API-DEMO-004 —— 用例来源 docs/trace/cases-api.json（F-DEMO-02 / C-BE-DEMO-02、C-BE-DEMO-03）
// S1 POST /api/__test__/reset  S2 读取 resources/sample-history.json 与 resource.json
// S3 spawn node scripts/import-sample.mjs（API_BASE=测试后端）  S4 GET /api/health
// 说明：导入脚本走真实 POST /api/sync；HTTP 一律用 api 夹具（真实请求、自动留痕），不 mock、不改公共夹具。
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

test('TC-API-DEMO-004 执行样例导入脚本后 health.pageCount=10 且样例文件与 resource.json 一致', async ({ api, evidence }) => {
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'demo-004-'));
  fs.mkdirSync(logDir, { recursive: true });
  const logs = { stdoutLog: path.join(logDir, 'import-sample.stdout.log'), stderrLog: path.join(logDir, 'import-sample.stderr.log') };
  let handle = null;

  try {
    await test.step('S1：POST /api/__test__/reset', async () => {
      await api.reset();
    });

    await test.step('S2：读取 resources/sample-history.json 与 resource.json 并 JSON.parse', async () => {
      const samplePath = path.join(ROOT, 'resources/sample-history.json');
      const resourcePath = path.join(ROOT, 'resource.json');
      expect(fs.existsSync(samplePath), '[E1] 样例文件 resources/sample-history.json 已交付').toBe(true);
      const sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
      const resource = JSON.parse(fs.readFileSync(resourcePath, 'utf8'));
      expect(sample, '[E1] sample-history.json 与 resource.json 深度相等').toEqual(resource);
      expect(sample.activeTab, '[E1] activeTab 指向 PR #456').toMatchObject({ url: 'https://github.com/org/repo/pull/456' });
      expect(sample.openTabs, '[E1] openTabs 3 条').toHaveLength(3);
      expect(sample.history, '[E1] history 10 条').toHaveLength(10);
    });

    await test.step('S3：spawn node scripts/import-sample.mjs（API_BASE=测试后端），等待退出', async () => {
      handle = spawnScript(process.execPath, ['scripts/import-sample.mjs'], { API_BASE }, logs);
      evidence.note(`import-sample pid=${handle.child.pid} API_BASE=${API_BASE}`);
      await delay(100);
      expect(handle.state.spawnError, '[ENV] scripts/import-sample.mjs 可以启动（排除 ENOENT）').toBeNull();
      const exit = await waitForExit(handle, WAIT_EXIT_MS);
      expect(exit, '[E2] S3 中导入脚本在 15 秒内退出，退出码=0').toMatchObject({ code: 0 });
      evidence.note(`import-sample 退出 ${JSON.stringify(exit)}`);
    });

    await test.step('S4：GET /api/health', async () => {
      const r = await api.get('/api/health');
      expect(r.status, '[E3] health 返回 200').toBe(200);
      expect(r.body.pageCount, '[E3] 导入后 pageCount=10').toBe(10);
      expect(typeof r.body.lastSyncAt, '[E3] lastSyncAt 为数字（说明走了真实 POST /api/sync）').toBe('number');
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
