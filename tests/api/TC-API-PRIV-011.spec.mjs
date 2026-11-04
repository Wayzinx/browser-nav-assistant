import { test, expect } from '../fixtures/api.mjs';

const K50 = 'a'.repeat(50);
const K51 = 'a'.repeat(51);
const LIST50 = Array.from({ length: 50 }, (_, index) => `kw${String(index + 1).padStart(2, '0')}`);
const LIST51 = [...LIST50, 'kw51'];

test('TC-API-PRIV-011 关键词长度和个数 50 通过，51 拒绝且无副作用', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：PUT /api/config 设置一个 50 字符的关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: [K50] });
    expect(r.status, '[E1] 50 字符关键词返回 200').toBe(200);
    expect(r.body.baseSensitiveKeywords, '[E1] 完整保存 50 字符关键词').toStrictEqual([K50]);
  });

  await test.step('S3：PUT /api/config 设置一个 51 字符的关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: [K51] });
    expect(r.status, '[E2] 51 字符关键词返回 400').toBe(400);
    expect(r.body.error.code, '[E2] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.message, '[E2] 错误信息非空').toMatch(/\S/);
    expect(r.body.error.details.fields, '[E2] 错误字段包含关键词列表').toContain('privacySensitiveKeywords');
  });

  await test.step('S4：PUT /api/config 设置 50 个不同关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: LIST50 });
    expect(r.status, '[E3] 50 项关键词返回 200').toBe(200);
    expect(r.body.baseSensitiveKeywords, '[E3] 返回 50 个关键词').toHaveLength(50);
    expect(r.body.baseSensitiveKeywords, '[E3] 保存的内容与 50 项列表一致').toStrictEqual(LIST50);
  });

  await test.step('S5：PUT /api/config 设置 51 个不同关键词', async () => {
    const r = await api.put('/api/config', { privacySensitiveKeywords: LIST51 });
    expect(r.status, '[E4] 51 项关键词返回 400').toBe(400);
    expect(r.body.error.code, '[E4] 错误码为 VALIDATION_FAILED').toBe('VALIDATION_FAILED');
    expect(r.body.error.details.fields, '[E4] 错误字段包含关键词列表').toContain('privacySensitiveKeywords');
  });

  await test.step('S6：GET /api/config 验证越界请求没有副作用', async () => {
    const r = await api.get('/api/config');
    expect(r.status, '[E5] 配置查询返回 200').toBe(200);
    expect(r.body.baseSensitiveKeywords, '[E5] 失败后仍有 50 项').toHaveLength(50);
    expect(r.body.baseSensitiveKeywords, '[E5] 失败后仍为最后一次合法保存的列表').toStrictEqual(LIST50);
  });
});
