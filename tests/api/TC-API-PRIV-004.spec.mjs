import { test, expect } from '../fixtures/api.mjs';

test('TC-API-PRIV-004 URL 子串 tokenizer 被拦，标题中的关键词不影响上传', async ({ api }) => {
  await test.step('S1：POST /api/__test__/reset', () => api.reset());

  await test.step('S2：POST /api/sync 对照 URL 子串和标题关键词', async () => {
    const lastVisitTime = Date.now() - 60 * 60 * 1000;
    const r = await api.post('/api/sync', {
      history: [
        { url: 'https://huggingface.co/docs/tokenizers', title: 'tokenizers', lastVisitTime, visitCount: 1 },
        { url: 'https://example.com/docs-a', title: 'password reset guide', lastVisitTime, visitCount: 1 },
      ],
    });
    expect(r.status, '[E1] 同步返回 200').toBe(200);
    expect(r.body, '[E1] 仅 URL 含 token 子串的记录被拒收').toMatchObject({
      received: 2, rejected: 1, rejectedByReason: { privacy: 1 }, created: 1,
    });
  });

  await test.step('S3：GET /api/pages/ranked', async () => {
    const r = await api.get('/api/pages/ranked');
    expect(r.status, '[E2] 排序接口返回 200').toBe(200);
    expect(r.body.total, '[E2] 排序总数为一').toBe(1);
    expect(r.body.pages, '[E2] 标题含 password 的普通 URL 正常保存').toHaveLength(1);
    expect(r.body.pages[0], '[E2] URL 和标题保持原值').toMatchObject({
      url: 'https://example.com/docs-a', title: 'password reset guide',
    });
    expect(r.body.pages.map((page) => page.url), '[E3] tokenizers URL 按已知子串匹配规则拒收').not.toContain('https://huggingface.co/docs/tokenizers');
  });
});
