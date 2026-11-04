// API / E2E 用例的公共夹具：import { test, expect } from '../fixtures/api.mjs'
//
// 提供：
//   api       真实 HTTP 客户端（基于 Playwright request）。每次调用自动写入 evidence/<CaseID>/api/，
//             并带上 x-request-id: <CaseID>-NN，便于在后端日志里对上号。非 2xx 不会抛错，状态码由用例自己断言。
//   evidence  留痕对象（自动启用）。可以调用 evidence.metric(name, value, unit) / evidence.note(text)。
//
// 每个测试开始前会自动调用 POST /api/__test__/reset，保证用例之间互相隔离。
// 需要保留数据的场景（极少）可以在文件里写 test.use({ autoReset: false })。
import { test as base, expect } from '@playwright/test';
import { Evidence } from './evidence.mjs';
import { mutate } from './mutation.mjs';
import { samplePayload } from './sample.mjs';

export { expect };
export * from './sample.mjs';

export class ApiClient {
  /** @param {import('@playwright/test').APIRequestContext} request @param {Evidence} evidence */
  constructor(request, evidence) {
    this.request = request;
    this.ev = evidence;
    this.seq = 0;
  }

  /**
   * @param {string} method
   * @param {string} url 相对路径，例如 '/api/pages/ranked'
   * @param {{ data?: any, params?: Record<string, string|number|boolean>, headers?: Record<string,string>, rawBody?: string, contentType?: string, setup?: boolean }} [opts]
   * @returns {Promise<{ status: number, ok: boolean, headers: Record<string,string>, body: any, ms: number, reqId: string }>}
   */
  async call(method, url, { data, params, headers = {}, rawBody, contentType, setup = false } = {}) {
    const reqId = `${this.ev.caseId || 'NO-CASE'}-${String(++this.seq).padStart(2, '0')}`;
    const opts = { method, params, headers: { 'x-request-id': reqId, ...headers }, failOnStatusCode: false, maxRedirects: 0 };
    if (rawBody !== undefined) {
      // 必须转成 Buffer：字符串 + application/json 会被 Playwright 再 JSON 编码一次（'{bad' 变成合法的 "\"{bad\""）
      opts.data = Buffer.from(rawBody, 'utf8'); // 原样发送，用于非法 JSON、错误 Content-Type 等反例
      opts.headers['content-type'] = contentType || 'application/json';
    } else if (data !== undefined) {
      opts.data = data; // 对象会被序列化为 JSON，并自动带上 application/json
    }
    const t0 = performance.now();
    const res = await this.request.fetch(url, opts);
    const ms = Number((performance.now() - t0).toFixed(1));
    const text = await res.text();
    const resHeaders = res.headers();
    let body = text;
    if (/json/i.test(resHeaders['content-type'] || '') && text) {
      try { body = JSON.parse(text); } catch { body = text; } // 解析失败就保留原文，交给断言发现
    }
    let status = res.status();
    let mutated = null;
    if (!setup && this.ev.mutation && this.ev.mutation !== 'baseline') {
      const m = mutate(this.ev.mutation, status, body);
      if (m.applied) { ({ status, body } = m); mutated = this.ev.mutation; this.ev.mutationApplied = true; }
    }
    this.ev.recordApi({
      reqId, setup, method, url, params: params || null,
      requestHeaders: opts.headers, requestBody: rawBody ?? data ?? null,
      status, responseHeaders: resHeaders, responseBody: body, ms, mutated,
    });
    return { status, ok: status >= 200 && status < 300, headers: resHeaders, body, ms, reqId };
  }

  get(url, opts) { return this.call('GET', url, opts); }
  post(url, data, opts = {}) { return this.call('POST', url, { ...opts, data }); }
  put(url, data, opts = {}) { return this.call('PUT', url, { ...opts, data }); }
  patch(url, data, opts = {}) { return this.call('PATCH', url, { ...opts, data }); }
  del(url, opts) { return this.call('DELETE', url, opts); }
  /** 发送原始字符串请求体（反例：非法 JSON / 错误 Content-Type） */
  raw(method, url, rawBody, contentType = 'application/json') { return this.call(method, url, { rawBody, contentType }); }

  /**
   * 读取后端状态快照（GET /api/__test__/state，仅 ENABLE_TEST_API=1）。
   * 走 Node 侧 HTTP，不写入 api/ 留痕、不参与变异；后端没有该接口（404）时返回 null。
   */
  async fetchState() {
    const res = await this.request.fetch('/api/__test__/state', { method: 'GET', failOnStatusCode: false, headers: { 'x-request-id': `${this.ev.caseId || 'NO-CASE'}-state` } });
    if (res.status() === 404) return null;
    if (!res.ok()) throw new Error(`GET /api/__test__/state 返回 ${res.status()}`);
    return res.json();
  }

  // ---------------------------------------------------------------- setup 辅助（不参与变异，失败直接抛错）

  async reset() {
    const r = await this.call('POST', '/api/__test__/reset', { setup: true });
    if (r.status !== 200 && r.status !== 204) {
      throw new Error(`[setup] POST /api/__test__/reset 返回 ${r.status}：请确认后端在 ENABLE_TEST_API=1 时提供重置接口`);
    }
    return r;
  }

  /** 以 setup 身份导入数据（被测的同步调用请用 api.post('/api/sync', ...)） */
  async seed(payload) {
    const r = await this.call('POST', '/api/sync', { data: payload, setup: true });
    if (!r.ok) throw new Error(`[setup] 导入数据失败：${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    return r;
  }

  /** 导入平移后的 resource.json（PRD D-01）；返回 { now, payload, res }，期望值用 now 和 shiftedTime 推算 */
  async loadSample({ now = Date.now(), lagMs, transform } = {}) {
    const payload = samplePayload({ now, lagMs, transform });
    const res = await this.seed(payload);
    return { now, payload, res };
  }
}

export const test = base.extend({
  evidence: [async ({}, use, testInfo) => {
    const ev = new Evidence(testInfo);
    ev.prepare();
    const note = ev.mutation && ev.mutation !== 'baseline' ? { type: 'mutation', description: ev.mutation } : null;
    if (note) testInfo.annotations.push(note);
    await use(ev);
    if (note) note.description = `${ev.mutation}|applied=${ev.mutationApplied}`;
    await ev.finalize();
  }, { auto: true }],

  autoReset: [true, { option: true }],

  api: async ({ request, evidence, autoReset }, use) => {
    const api = new ApiClient(request, evidence);
    if (autoReset) await api.reset();
    // 用例前后各取一次后端状态，写入 evidence/<CaseID>/state-*.json（变异检查时 evidence 关闭，不取）
    const captureState = async (kind) => {
      if (!evidence.enabled) return;
      try {
        const state = await api.fetchState();
        if (state) evidence.setState(kind, state);
        else if (kind === 'before') evidence.note('后端没有提供 GET /api/__test__/state（BE-RUN-07），跳过状态快照');
      } catch (e) {
        // 取状态失败不能掩盖用例本身的结果（例如后端已经崩溃），只记备注
        evidence.note(`读取 ${kind} 状态快照失败：${String((e && e.message) || e).slice(0, 200)}`);
      }
    };
    await captureState('before');
    await use(api);
    await captureState('after');
  },
});
