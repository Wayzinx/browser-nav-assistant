import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { log } from './lib/logger.js';
import { restorePages } from './store/page-repo.js';
import { restoreRules } from './store/rule-repo.js';
import { hydrateState, onStateChange } from './store/state.js';

// @code C-BE-CORE-01
/** @param {import('node:http').Server} server HTTP server @param {object} options config/flushSnapshotSync @returns {void} 信号到达后至多 3 秒正常退出。 */
export function registerShutdown(server, { config, flushSnapshotSync = () => {} }) {
  let isClosing = false;
  const shutdown = (signal) => {
    if (isClosing) return;
    isClosing = true;
    const fallback = setTimeout(() => process.exit(0), 3000).unref();
    try {
      log('info', '服务正在退出', { signal });
      if (config.snapshotFile) flushSnapshotSync();
    } catch (error) {
      log('error', '退出时快照刷新失败', { stack: error.stack });
    } finally {
      server.close(() => { clearTimeout(fallback); process.exit(0); });
    }
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

/** @param {object} [config] 运行配置 @returns {Promise<import('node:http').Server>} 启动服务，仅编排配置、存储恢复与生命周期。 */
export async function main(config = loadConfig()) {
  const server = createApp(config);
  let flushSnapshotSync;
  if (config.snapshotFile) {
    const [loader, writer] = await Promise.all([import('./store/snapshot-loader.js'), import('./store/snapshot-writer.js')]);
    const result = loader.loadSnapshot(config.snapshotFile);
    if (result.ok) {
      restorePages(result.data.pages);
      restoreRules(result.data.rules);
      hydrateState(result.data);
    } else {
      log('warn', '未加载快照，以空数据启动', { reason: result.reason });
    }
    const snapshotWriter = writer.createSnapshotWriter({ file: config.snapshotFile });
    onStateChange(() => snapshotWriter.schedule());
    flushSnapshotSync = writer.flushSnapshotSync;
  }
  registerShutdown(server, { config, flushSnapshotSync });
  server.once('error', (error) => {
    const msg = error.code === 'EADDRINUSE' ? '端口已被占用，请停止占用进程或通过 PORT 指定其他端口' : '后端启动失败';
    log('error', msg, { code: error.code, port: config.port, host: config.host });
    process.exit(1);
  });
  server.listen(config.port, config.host, () => log('info', '服务已启动', {
    port: config.port, host: config.host,
    persistence: config.snapshotFile ? 'snapshot' : 'memory', enableTestApi: config.enableTestApi,
  }));
  return server;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { log('error', '后端启动失败', { stack: error.stack }); process.exit(1); });
}
