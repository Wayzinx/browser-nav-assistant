// 用例：TC-UI-DIAG-018（F-DIAG-06#AC4）最近一次成功同步在 25 小时前时警告「超过 24 小时未同步」
import { test, expect, samplePayload } from '../fixtures/extension.mjs';
import { startSnapshotBackend } from './diag-local-backend.mjs';
import { enterDiagTab, checkState, DIAG_CHECK_IDS, renderedCheckCount } from './diag-testkit.mjs';

let backend;
test.afterEach(async () => {
  if (backend) await backend.stop();
  backend = null;
});

test('TC-UI-DIAG-018 最近一次成功同步在 25 小时前（24 小时 + 1 小时）时警告「超过 24 小时未同步」', async ({ ext, api }) => {
  let popup;
  let sync;
  let health;

  await test.step('S1：在专属后端真实导入平移样例，读取 health 确认快照模式与 10 个页面', async () => {
    backend = await startSnapshotBackend();
    // 进程刚 spawn 时端口尚未监听，连接拒绝属于「未就绪」，继续轮询直到真实 health 返回 200
    await expect.poll(async () => api.get(`${backend.baseURL}/api/health`, { setup: true }).then((r) => r.status, () => 0), { message: '专属后端就绪', timeout: 30_000 }).toBe(200);
    expect((await api.get(`${backend.baseURL}/api/health`)).status, '专属后端 health 200').toBe(200);
    await api.post(`${backend.baseURL}/api/__test__/reset`, undefined, { setup: true });
    const now = Date.now();
    sync = await api.post(`${backend.baseURL}/api/sync`, samplePayload({ now }), { setup: true });
    health = await api.get(`${backend.baseURL}/api/health`);
    expect(sync.status, '[E1] 真实导入 HTTP 200').toBe(200);
    expect(sync.body.pageCount, '[E1] pageCount=10').toBe(10);
    expect(health.body.persistence, '[E1] health.persistence="snapshot"').toBe('snapshot');
    expect(health.body.pageCount, '[E1] health.pageCount=10').toBe(10);
    expect(health.body.lastSyncAt, '[E1] health.lastSyncAt=sync.syncedAt 且非 null').toBe(sync.body.syncedAt);
  });

  await test.step('S2：在 SW 捕获 T，写入 25 小时前的完整 syncState、apiBaseUrl 与 connection', async () => {
    const T = Date.now();
    const L = T - 1500 * 60_000;
    await ext.setStorage({
      apiBaseUrl: backend.baseURL,
      syncState: {
        status: 'success', startedAt: L, lastSyncAt: L, lastSuccessAt: L, lastError: null,
        cursor: null, cursorBase: { apiBaseUrl: backend.baseURL, serverStartedAt: health.body.startedAt },
        fullReason: null, mode: 'full', trigger: 'user',
        stats: { uploaded: 14, filtered: 0, received: sync.body.received, created: sync.body.created, updated: sync.body.updated, rejected: sync.body.rejected },
      },
      connection: { status: 'online', since: T, lastCheckedAt: T, lastErrorCode: null, recoverPending: false },
    });
    const stored = (await ext.getStorage('syncState')).syncState;
    expect(stored.lastSuccessAt, '读回 L 与统计值').toBe(L);
  });

  await test.step('S3：打开 popup → 诊断页签，读取 diag-check-last-sync 的状态、详情与数值', async () => {
    popup = await ext.openPopup();
    await enterDiagTab(popup);
    const lastSync = await checkState(popup, 'diag-check-last-sync');
    expect(lastSync.status, '[E2] data-status="warn"').toBe('warn');
    expect(lastSync.statusText, '[E2] 状态文本为「警告」').toBe('警告');
    const text = `${lastSync.detail} ${lastSync.value}`;
    expect(text, '[E3] 详情包含「超过 24 小时未同步」').toContain('超过 24 小时未同步');
    expect(text, '[E4] 不包含「后端数据少于本地同步记录」').not.toContain('后端数据少于本地同步记录');
    expect(lastSync.hintSteps.join(' '), '[E4] 排查步骤提供「立即同步」建议').toContain('立即同步');
    expect(await renderedCheckCount(popup), '11 项检查全部渲染').toBe(DIAG_CHECK_IDS.length);
    await ext.snap(popup, 'S3-超过 24 小时未同步');
  });
});
