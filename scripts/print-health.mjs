import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../server/src/config.js';

// @code C-BE-DEMO-01
// 整体最多等 10 秒；单次请求最多 500 ms，避免端口仅接受连接时拖住退出。
const STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 500;
const POLL_INTERVAL_MS = 100;

// 先检查端口，避免健康探针连接到已经占用该地址的其他进程。
async function checkPortAvailable(config = loadConfig()) {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', (error) => {
      reject(new Error(error.code === 'EADDRINUSE'
        ? `端口 ${config.port} 已被占用，请用 PORT=<端口> ./scripts/start.sh 更换端口`
        : `无法使用启动端口：${error.message}`));
    });
    probe.listen(config.port, config.host, () => probe.close(resolve));
  });
}

/**
 * 只打印真实 health 返回；启动进程已退出时结束轮询，避免留下后台进程。
 * @param {{config?:object, parentPid?:number|null, timeoutMs?:number}} [options] 服务配置与启动进程 PID
 * @returns {Promise<object|null>} 健康信息；启动进程提前退出时返回 null
 */
export async function waitAndPrintHealth({ config = loadConfig(), parentPid = null, timeoutMs = STARTUP_TIMEOUT_MS } = {}) {
  const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '::1' : config.host;
  const address = host.includes(':') ? `[${host}]` : host;
  const url = `http://${address}:${config.port}/api/health`;
  const deadline = performance.now() + timeoutMs;
  const isParentAlive = () => parentPid === null || process.ppid === parentPid;
  let lastError;

  while (performance.now() < deadline) {
    if (!isParentAlive()) return null;
    try {
      const remaining = Math.max(1, Math.ceil(deadline - performance.now()));
      const response = await fetch(url, {
        signal: AbortSignal.timeout(Math.min(REQUEST_TIMEOUT_MS, remaining)),
        redirect: 'error',
      });
      if (response.status !== 200) throw new Error(`health 返回 HTTP ${response.status}`);
      const health = await response.json();
      if (health?.status !== 'ok') throw new Error('health 的 status 不是 ok');
      if (!isParentAlive()) return null;
      process.stdout.write(`${JSON.stringify(health)}\n`);
      return health;
    } catch (error) {
      // 后端可能尚未监听；保留最后一次错误，在整体超时后给出诊断。
      lastError = error;
    }
    if (!isParentAlive()) return null;
    const remaining = deadline - performance.now();
    if (remaining > 0) await delay(Math.min(POLL_INTERVAL_MS, remaining));
  }
  throw new Error(`等待后端健康检查超时：${lastError?.message ?? '未收到响应'}；请检查 PORT 和 HOST`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const task = process.argv[2] === '--check-port'
    ? checkPortAvailable()
    : waitAndPrintHealth({ parentPid: process.argv[2] ? Number(process.argv[2]) : null });
  task.catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
