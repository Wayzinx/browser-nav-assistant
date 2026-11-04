// 版本不兼容场景的依赖故障服务：真实 HTTP + CORS，health.version 主版本为 2。
// 只用于 UI「版本兼容」诊断，不代表产品 /api/health 通过（F-DIAG-09 另有 API 用例）。
import http from 'node:http';

const CORS_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

/** api-contract 的默认配置 */
const DEFAULT_CONFIG = {
  cleanupThresholdDays: 14,
  maxHistoryItems: 100,
  enablePrivacyFilter: true,
  privacySensitiveKeywords: ['password', 'token', 'bank', 'secret'],
  baseSensitiveKeywords: ['password', 'token', 'bank', 'secret'],
  historyLookbackDays: 30,
  recencyHalfLifeDays: 7,
  weights: { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 },
  minRecommendationScore: 0.3,
  apiVersion: '1',
  limits: { maxItemsPerSync: 500, maxUrlLength: 2048, maxRuleTextLength: 500, maxBodyBytes: 1_048_576 },
};

/** 启动依赖故障服务，返回 Promise<{ port, baseURL, stop() }> */
export function startFaultService({ version = '2.3.1' } = {}) {
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const reply = (body, status = 200) => { res.writeHead(status, CORS_HEADERS); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
    } else if (pathname === '/api/health') {
      reply({ status: 'ok', version, uptime: Math.floor((Date.now() - startedAt) / 1000), pageCount: 0, ruleCount: 0, enabledRuleCount: 0, lastSyncAt: null, persistence: 'memory', startedAt });
    } else if (pathname === '/api/config') {
      reply(DEFAULT_CONFIG);
    } else if (pathname === '/api/rules') {
      reply({ rules: [], total: 0 });
    } else if (pathname === '/api/pages/ranked') {
      reply({ pages: [], total: 0, domains: [], generatedAt: Date.now() });
    } else if (pathname === '/api/pages/cleanup-suggestions') {
      reply({ summary: { archive: 0, merge: 0, keep: 0 }, suggestions: [], thresholdDays: 14, generatedAt: Date.now() });
    } else if (pathname === '/api/recommendations/next') {
      reply({ recommendations: [], cached: false, generatedAt: Date.now() });
    } else {
      reply({ error: { code: 'NOT_FOUND', message: `依赖故障服务没有实现 ${req.method} ${pathname}` } }, 404);
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    resolve({
      port,
      baseURL: `http://127.0.0.1:${port}`,
      async stop() {
        await new Promise((done) => server.close(done));
      },
    });
  }));
}
