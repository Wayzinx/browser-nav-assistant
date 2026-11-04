// 按后端方案 §3.5 启动「本用例专属」的真实产品后端：PORT + ENABLE_TEST_API=1 + SNAPSHOT_FILE。
// 不修改产品源码、不伪造 health：health.persistence / pageCount / lastSyncAt 都来自真实进程。
// 日志与共享 webServer 写同一个 LOG_FILE（evidence 抽取的 server.log），退出时用 SIGTERM 走正常关闭。
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 取一个空闲端口（listen 成功后立即释放） */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** 启动专属后端，返回 { baseURL, dir, snapshotFile, stop() } */
export async function startSnapshotBackend() {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nav-diag-backend-'));
  const snapshotFile = path.join(dir, 'snapshot.json');
  const child = spawn(process.execPath, ['server/src/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      ENABLE_TEST_API: '1',
      SNAPSHOT_FILE: snapshotFile,
      LOG_FILE: process.env.SERVER_LOG_FILE || path.join(dir, 'server.log'),
    },
    stdio: 'ignore',
  });
  return {
    port,
    dir,
    snapshotFile,
    baseURL: `http://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
