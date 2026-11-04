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

test('TC-API-PERSIST-003 仅有半截 tmp 时空库启动并清理 tmp', async ({ api, evidence }) => {
  await withBackend(api, evidence, async backend => {
    const tmpFile = await test.step('S1：仅写入半截 tmp，不创建正式快照', async () => {
      const file = backend.snapshotFile + '.99999.tmp';
      fs.writeFileSync(file, '{"schemaVersion":1,"pages":[');
      expect(fs.existsSync(backend.snapshotFile), '[E1] 启动前不存在正式快照').toBe(false);
      return file;
    });
    const baseURL = await test.step('S2：启动独立后端并读取 health', async () => {
      const url = await backend.start();
      const r = await api.get(url + '/api/health');
      expect(r.status, '[E1] 返回 200').toBe(200);
      expect(r.body, '[E1] 快照模式以空页面和空规则启动').toMatchObject({ status: 'ok', pageCount: 0, ruleCount: 0, persistence: 'snapshot' });
      return url;
    });
    await test.step('S3：核对 tmp 已删除并再次读取 health', async () => {
      expect(fs.existsSync(tmpFile), '[E2] 半截 tmp 已被清理').toBe(false);
      const r = await api.get(baseURL + '/api/health');
      expect(r.status, '[E3] 再次健康检查仍返回 200').toBe(200);
      expect(r.body.status, '[E3] 进程继续正常服务').toBe('ok');
      evidence.note('清理后的快照目录：' + JSON.stringify(fs.readdirSync(backend.dir)));
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

