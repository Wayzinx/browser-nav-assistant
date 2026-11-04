// 测试工程配置（模板来源：.agents/skills/nav-case-to-script/assets/playwright.config.mjs）
// 阶段 4「测试基建」原样复制到项目根目录，评审通过后与 tests/ 一起锁定。
// 只有当后端技术方案的入口文件不是 server/src/index.js 时，才需要修改 webServer.command。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TEST_PORT || 4100);

// 主进程先算出 runId 和日志路径，worker 进程通过继承环境变量拿到同一份值
process.env.EVIDENCE_RUN_ID ||= new Date().toISOString().replace(/[:.]/g, '-');
process.env.SERVER_LOG_FILE ||= path.join(ROOT, 'evidence', '_runtime', `server-${PORT}.log`);

const serverEnv = {
  PORT: String(PORT),
  HOST: '127.0.0.1',
  ENABLE_TEST_API: '1',
  LOG_FILE: process.env.SERVER_LOG_FILE, // 后端规范 BE-LOG-02：设置后把 JSON 日志同步追加写入该文件
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
};
// 质量报告采集后端行覆盖率时，collect-coverage.mjs 会设置 BE_COVERAGE_DIR
if (process.env.BE_COVERAGE_DIR) serverEnv.NODE_V8_COVERAGE = path.resolve(ROOT, process.env.BE_COVERAGE_DIR);

export default defineConfig({
  testDir: 'tests',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1, // 后端是共享的内存状态，必须串行
  retries: 0, // 不允许靠重试掩盖不稳定
  forbidOnly: true,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  // 并行的开发 / 修复任务各用自己的输出目录（PW_OUTPUT_DIR），避免互相覆盖 trace 和附件（v2 运行时出现过 trace ENOENT）；
  // 证据目录用 EVIDENCE_DIR 隔离
  outputDir: process.env.PW_OUTPUT_DIR || 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server/src/index.js',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: serverEnv,
    // 发 SIGTERM 让后端正常退出：V8 覆盖率只有在进程正常退出时才会落盘（后端规范 BE-RUN-03）
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    { name: 'api', testDir: 'tests/api' },
    { name: 'e2e', testDir: 'tests/e2e' },
    { name: 'ui', testDir: 'tests/ui', timeout: 60_000 },
  ],
});
