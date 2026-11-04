import { test, expect } from '../fixtures/api.mjs';
import { createServer, connect } from 'node:net';
import { request as httpRequest } from 'node:http';

// features: F-RULE-01, F-RULE-06, F-RULE-07, F-RULE-08, F-RULE-09
// codePoints: C-BE-RULE-07, C-BE-RULE-08, C-BE-RULE-06

// 本例 S3/S4 明确要求 net/http 的 error 与 response 事件；只对已关闭端口使用原生客户端。
// 正常后端请求仍使用 api；原生传输异常通过现有 evidence.recordApi/note 留痕，不伪造 HTTP 状态。
const errorRecord = error => ({ name: error.name, message: error.message, code: error.code, address: error.address, port: error.port });

async function allocateClosedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function probe(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve({ connected: true });
    });
    socket.once('error', error => resolve({ connected: false, error: errorRecord(error) }));
    socket.setTimeout(2_000, () => socket.destroy(new Error('端口预检超时')));
  });
}

function sendToClosedPort(port, method, path, data, reqId) {
  return new Promise(resolve => {
    const started = performance.now();
    const headers = { 'x-request-id': reqId };
    const body = data === undefined ? undefined : JSON.stringify(data);
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    let responseReceived = false;
    const req = httpRequest({ hostname: '127.0.0.1', port, method, path, headers, agent: false });
    req.once('response', response => {
      responseReceived = true;
      response.resume();
      // 端口被接管或收到了响应时保留事实，后续断言必须失败。
      resolve({ responseReceived, status: response.statusCode, ms: performance.now() - started, headers });
    });
    req.once('error', error => resolve({ responseReceived, error: errorRecord(error), ms: performance.now() - started, headers }));
    req.setTimeout(2_000, () => req.destroy(new Error('离线 HTTP 请求超时')));
    req.end(body);
  });
}

test("TC-API-RULE-042 后端不可达时六种规则请求真实连接拒绝且健康实例不变", async ({ api, evidence }) => {
  await test.step('S1：通过真实 HTTP 重置本例状态', async () => {
    const r = await api.post('/api/__test__/reset', {});
    expect(r.status, '[E1] reset 返回 200').toBe(200);
    expect(r.body.ok, '[E1] reset 成功').toBe(true);
  });

  const baseline = await test.step('S2：在健康后端保存保护规则与完整快照', async () => {
    const saved = await api.post('/api/rules', { rules: [{ rawText: '保护docs', type: 'never_archive', domain: 'docs.internal.com' }] });
    expect(saved.status, '[E8] 健康实例基线保存成功').toBe(201);
    expect(saved.body.rules, '[E8] 基线只有一条保护规则').toHaveLength(1);
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E8] 基线列表成功').toBe(200);
    expect(health.status, '[E8] 基线健康检查成功').toBe(200);
    return { id: saved.body.rules[0].id, list: list.body, health: health.body };
  });
  const port = await test.step('S3：分配并关闭临时端口后验证真实连接拒绝', async () => {
    let outcome;
    let candidate;
    // 端口被其他进程接管时重新分配；五次均未取得拒绝则让断言失败。
    for (let attempt = 0; attempt < 5; attempt++) {
      candidate = await allocateClosedPort();
      outcome = await probe(candidate);
      evidence.note(JSON.stringify({ phase: 'port-preflight', attempt, port: candidate, ...outcome }));
      if (outcome.error?.code === 'ECONNREFUSED') {
        break;
      }
    }
    expect(candidate, '[E2] 使用非特权临时端口').toBeGreaterThan(1024);
    expect(outcome.connected, '[E2] 预检没有建立连接').toBe(false);
    expect(outcome.error, '[E2] 真实异常包含精确地址与端口').toMatchObject({ code: 'ECONNREFUSED', address: '127.0.0.1', port: candidate });
    return candidate;
  });
  await test.step('S4：向已预检关闭的端口发送六种真实规则请求', async () => {
    const calls = [
      { method: 'POST', path: '/api/rules/parse', data: { text: '飞书文档优先显示' }, tag: 3 },
      { method: 'POST', path: '/api/rules', data: { rules: [{ rawText: '新保护', type: 'never_archive', domain: 'example.com' }] }, tag: 4 },
      { method: 'GET', path: '/api/rules', tag: 5 },
      { method: 'DELETE', path: `/api/rules/${baseline.id}`, tag: 6 },
      { method: 'PATCH', path: `/api/rules/${baseline.id}`, data: { enabled: false }, tag: 7 },
      { method: 'PATCH', path: `/api/rules/${baseline.id}`, data: { enabled: true }, tag: 7 },
    ];
    const outcomes = [];
    for (const [index, call] of calls.entries()) {
      const reqId = `${evidence.caseId}-offline-${index + 1}`;
      const result = await sendToClosedPort(port, call.method, call.path, call.data, reqId);
      evidence.recordApi({ reqId, setup: false, method: call.method, url: `http://127.0.0.1:${port}${call.path}`, requestHeaders: result.headers, requestBody: call.data ?? null, responseHeaders: null, responseBody: null, status: result.status ?? null, responseReceived: result.responseReceived, transportError: result.error ?? null, ms: result.ms });
      outcomes.push(result);
    }
    expect(outcomes, '[E3] 记录了六次真实 HTTP 传输结果').toHaveLength(6);
    expect(outcomes[0], '[E3] parse 真实连接拒绝且未产生 HTTP response').toMatchObject({ responseReceived: false, error: { code: 'ECONNREFUSED', address: '127.0.0.1', port } });
    expect(outcomes[1], '[E4] save 真实连接拒绝且未产生 HTTP response').toMatchObject({ responseReceived: false, error: { code: 'ECONNREFUSED', address: '127.0.0.1', port } });
    expect(outcomes[2], '[E5] list 真实连接拒绝且未产生 HTTP response').toMatchObject({ responseReceived: false, error: { code: 'ECONNREFUSED', address: '127.0.0.1', port } });
    expect(outcomes[3], '[E6] delete 真实连接拒绝且未产生 HTTP response').toMatchObject({ responseReceived: false, error: { code: 'ECONNREFUSED', address: '127.0.0.1', port } });
    for (const result of outcomes.slice(4)) {
      expect(result, '[E7] 两个 PATCH 都真实连接拒绝且未产生 HTTP response').toMatchObject({ responseReceived: false, error: { code: 'ECONNREFUSED', address: '127.0.0.1', port } });
    }
  });
  await test.step('S5：回到健康实例核对原规则与健康计数', async () => {
    const list = await api.get('/api/rules');
    const health = await api.get('/api/health');
    expect(list.status, '[E8] 健康实例列表成功').toBe(200);
    expect(list.body, '[E8] 完整规则快照与基线相等').toEqual(baseline.list);
    expect(list.body.total, '[E8] 原有一条规则不变').toBe(1);
    expect(list.body.rules[0].enabled, '[E8] 原有规则仍启用').toBe(true);
    expect(health.status, '[E8] 健康实例健康检查成功').toBe(200);
    expect(health.body, '[E8] 原有计数正确').toMatchObject({ ruleCount: 1, enabledRuleCount: 1, pageCount: 0 });
    for (const key of ['ruleCount', 'enabledRuleCount', 'pageCount']) {
      expect(health.body[key], '[E8] 对应计数与 H0 相同').toBe(baseline.health[key]);
    }
  });
});
