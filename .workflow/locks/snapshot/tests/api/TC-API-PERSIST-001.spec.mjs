import { test, expect, samplePayload, HOUR } from '../fixtures/api.mjs';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

// 独立进程不提供 reset；所有 HTTP 仍走 api 夹具，使用绝对 URL 指向该进程。
test.use({ autoReset: false });

const RULES = [
  { rawText: '把 7 天没访问过的 GitHub issue 建议归档', type: 'archive_candidate', domain: 'github.com', urlPattern: '/issues/', inactiveDays: 7, action: 'suggest_archive' },
  { rawText: 'docs.internal.com 的页面永远不要归档', type: 'never_archive', domain: 'docs.internal.com', action: 'keep' },
];

test('TC-API-PERSIST-001 防抖落盘后强杀重启恢复页面和规则', async ({ api, evidence }) => {
  const now = Date.now();
  await withBackend(api, evidence, async backend => {
    const firstURL = await test.step('S1：启动独立后端 A 并读取 health', async () => {
      const url = await backend.start();
      const r = await api.get(url + '/api/health');
      expect(r.status, '[E1] 独立后端 A 返回 200').toBe(200);
      expect(r.body, '[E1] 启用快照且初始为空').toMatchObject({ persistence: 'snapshot', pageCount: 0 });
      return url;
    });
    await test.step('S2：向 A 同步平移后的样例', async () => {
      const r = await api.post(firstURL + '/api/sync', samplePayload({ now }), { setup: true });
      expect(r.status, '[E3] 重启前真实同步成功').toBe(200);
      expect(r.body.pageCount, '[E3] 重启前有十个页面').toBe(10);
    });
    const savedIds = await test.step('S3：向 A 保存两条规则并记录 id', async () => {
      const r = await api.post(firstURL + '/api/rules', { rules: RULES }, { setup: true });
      expect(r.status, '[E4] 两条规则真实保存成功').toBe(201);
      expect(r.body.rules, '[E4] 返回两条规则').toHaveLength(2);
      const ids = r.body.rules.map(rule => rule.id);
      for (const id of ids) expect(id, '[E4] 规则 id 由后端生成且非空').toMatch(/\S/);
      expect(new Set(ids).size, '[E4] 两个 id 不重复').toBe(2);
      return ids;
    });
    await test.step('S4：等待 2000 ms 后读取防抖产生的快照', async () => {
      // 2 秒是用例规定的防抖观察窗口，不用于等待 UI 或掩盖请求时序。
      await delay(2_000);
      expect(fs.existsSync(backend.snapshotFile), '[E2] 强杀前正式快照已存在').toBe(true);
      const snapshot = JSON.parse(fs.readFileSync(backend.snapshotFile, 'utf8'));
      expect(snapshot.schemaVersion, '[E2] 快照为有效 JSON 且 schemaVersion=1').toBe(1);
      expect(fs.readdirSync(backend.dir).filter(name => name.endsWith('.tmp')), '[E2] 没有未完成的临时快照').toEqual([]);
      if (evidence.enabled) fs.copyFileSync(backend.snapshotFile, path.join(evidence.dir, 'snapshot-after-debounce.json'));
    });
    const secondURL = await test.step('S5：SIGKILL 结束 A 后使用同一快照启动 B', async () => {
      const exit = await backend.stop('SIGKILL');
      expect(exit.signal, '[E3] 强杀退出，排除 SIGTERM flush 带来的恢复').toBe('SIGKILL');
      return backend.start();
    });
    await test.step('S6：从 B 回读 health 与规则 id', async () => {
      const health = await api.get(secondURL + '/api/health');
      expect(health.status, '[E3] 重启后的 health 返回 200').toBe(200);
      expect(health.body, '[E3] 恢复十个页面和两条规则').toMatchObject({ status: 'ok', pageCount: 10, ruleCount: 2 });
      const rules = await api.get(secondURL + '/api/rules');
      expect(rules.status, '[E4] 重启后的规则接口返回 200').toBe(200);
      expect(rules.body.rules.map(rule => rule.id).sort(), '[E4] 重启保留原来的两个规则 id').toEqual([...savedIds].sort());
    });
    await test.step('S7：从 B 读取规则生效后的整理建议', async () => {
      const r = await api.get(secondURL + '/api/pages/cleanup-suggestions', { params: { now } });
      expect(r.status, '[E5] 重启后的整理建议返回 200').toBe(200);
      expect(r.body.summary, '[E5] 持久化规则继续影响整理建议').toEqual({ archive: 2, merge: 1, keep: 1 });
    });
  });
});

// 简报禁止修改公共夹具，进程编排保留在本用例文件内，不导入产品源码。
async function withBackend(api, evidence, run, { snapshot = true } = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const entry = path.join(root, 'server/src/index.js');
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'browser-nav-persist-'));
  const snapshotFile = path.join(dir, 'snapshot.json');
  const logDir = evidence.enabled ? evidence.dir : fs.mkdtempSync(path.join(tmpdir(), 'browser-nav-persist-log-'));
  const logFile = path.join(logDir, 'server-persist.log');
  const consoleFile = path.join(logDir, 'server-persist-console.log');
  fs.mkdirSync(logDir, { recursive: true });
  fs.rmSync(logFile, { force: true });
  const consoleFd = fs.openSync(consoleFile, 'w');
  let active = null;

  async function start() {
    if (active) throw new Error('必须先结束前一个独立后端');
    const listener = net.createServer();
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    const baseURL = 'http://127.0.0.1:' + port;
    const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_FILE: logFile, LOG_LEVEL: 'debug' };
    delete env.ENABLE_TEST_API;
    delete env.SNAPSHOT_FILE;
    // 隔离进程不覆盖其他测试的 V8 覆盖率目录。
    delete env.NODE_V8_COVERAGE;
    if (snapshot) env.SNAPSHOT_FILE = snapshotFile;
    const child = spawn(process.execPath, [entry], {
      cwd: snapshot ? root : dir, env, stdio: ['ignore', consoleFd, consoleFd],
    });
    let launchError = null;
    const exited = new Promise(resolve => {
      child.once('error', error => { launchError = error; resolve({ code: null, signal: null, error }); });
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    active = { child, exited };
    evidence.note('启动独立后端 pid=' + child.pid + ' port=' + port + ' snapshot=' + snapshot);

    // TCP 探测只用于等待监听；就绪条件仍是夹具发出的真实 GET /api/health 返回 200。
    await expect.poll(async () => {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('后端在就绪前退出，详见 server-persist-console.log');
      const listening = await new Promise(resolve => {
        const socket = net.createConnection({ host: '127.0.0.1', port });
        const finish = ready => { socket.destroy(); resolve(ready); };
        socket.setTimeout(200);
        socket.once('connect', () => finish(true));
        socket.once('error', () => finish(false));
        socket.once('timeout', () => finish(false));
      });
      return listening ? (await api.get(baseURL + '/api/health', { setup: true })).status : 0;
    }, { message: '独立后端必须在 10 秒内通过 health 就绪检查', timeout: 10_000, intervals: [25, 50, 100] }).toBe(200);
    return baseURL;
  }

  async function stop(signal = 'SIGTERM') {
    if (!active) throw new Error('没有可停止的独立后端');
    const { child, exited } = active;
    const started = performance.now();
    let timeout;
    try {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      const result = await Promise.race([
        exited,
        new Promise((resolve, reject) => {
          timeout = setTimeout(() => reject(new Error('独立后端未在 3 秒内退出：' + signal)), 3_000);
        }),
      ]);
      if (result.error) throw result.error;
      evidence.note('独立后端退出 ' + JSON.stringify({ pid: child.pid, requestedSignal: signal, ...result }));
      return { ...result, durationMs: performance.now() - started };
    } finally {
      clearTimeout(timeout);
      // 超时也回收进程，但原错误继续抛出，不会把清理成功记成测试通过。
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
        await exited;
      }
      active = null;
    }
  }

  try {
    await run({ start, stop, dir, snapshotFile, logFile });
  } finally {
    try {
      if (active) await stop();
    } finally {
      try {
        if (evidence.enabled && fs.existsSync(logFile)) fs.copyFileSync(logFile, path.join(evidence.dir, 'server.log'));
      } finally {
        fs.closeSync(consoleFd);
        fs.rmSync(dir, { recursive: true, force: true });
        if (!evidence.enabled) fs.rmSync(logDir, { recursive: true, force: true });
      }
    }
  }
}

