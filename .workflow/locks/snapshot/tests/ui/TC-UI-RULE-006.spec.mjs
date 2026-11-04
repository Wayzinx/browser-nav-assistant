import { test, expect } from '../fixtures/extension.mjs';

const TEXT500 = 'github.com 永远不要归档'.padEnd(500, '。');

async function parse(popup, text, requestId) {
  return popup.evaluate(async (message) => {
    const response = await chrome.runtime.sendMessage(message);
    console.log('PARSE_RULE 响应', message.requestId, JSON.stringify(response));
    return response;
  }, { type: 'PARSE_RULE', payload: { text }, requestId });
}

test('TC-UI-RULE-006 PARSE_RULE 的 500、501、空串边界且解析不写库', async ({ ext, api }) => {
  let popup;
  await test.step('S1：发送恰好五百字的解析消息', async () => {
    popup = await ext.openPopup();
    const response = await parse(popup, TEXT500, 'rule-length-500');
    expect(response.ok, '[E1] 五百字解析成功').toBe(true);
    expect(response.data, '[E1] 解析结果三个字段均为数组').toMatchObject({
      rules: expect.any(Array), unparsed: expect.any(Array), warnings: expect.any(Array),
    });
    await ext.snap(popup, '五百字消息完成');
  });
  await test.step('S2：发送五百零一字的解析消息', async () => {
    const response = await parse(popup, TEXT500 + '。', 'rule-length-501');
    expect(response, '[E2] 超长文本返回校验错误').toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    expect(response.error.message, '[E2] 错误说明非空').toMatch(/\S/);
  });
  await test.step('S3：发送空串解析消息', async () => {
    const response = await parse(popup, '', 'rule-length-zero');
    expect(response, '[E3] 空串返回校验错误').toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED' } });
    await ext.snap(popup, '边界消息完成');
  });
  await test.step('S4：核对解析没有写入后端', async () => {
    const rules = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(rules.body.total, '[E4] 规则数为零').toBe(0);
    expect(health.body.ruleCount, '[E4] 健康接口规则数为零').toBe(0);
  });
});
