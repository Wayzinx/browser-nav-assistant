// 跨产物对齐检查（确定性）：在用例设计完成、编写脚本和开发之前，把需求、契约、用例之间的不一致一次性暴露出来。
// 每条 error 都以「[align:<检查名>] <文件或 ID>：…」开头，workflow 按检查名和 ID 路由给负责人：
//   cases-api   API / E2E 用例引用的接口、错误码、状态码与 api-contract 一致     → 负责人：TEST（或 BE，契约缺失时）
//   cases-ui    UI 用例引用的 testId、消息 type、storageKey 在 ui-contract 中登记 → 负责人：TEST（或 FE）
//   fe-be       前端代码点 interfaces、ui-contract 消息、docs/04 中的后端接口在 api-contract 中存在 → 负责人：FE / BE
//   contract    契约内部一致：同一错误码不对应多个状态码；与通用错误表一致       → 负责人：BE
//   ac-coverage 每条 inScope AC 至少被 1 个用例引用                              → 负责人：TEST
//   prd-samples PRD 第 13 章样例中的 URL 在用例中出现（warning）                  → 负责人：TEST / PM
//   board       看板中 stage ≤ align 的阻塞项必须已关闭                           → 负责人：看板记录的 to
import { checkBoard } from './board.mjs';

const METHODS = 'GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD';
const EP_MENTION = new RegExp(`\\b(${METHODS})\\s+(\\/api\\/[A-Za-z0-9_\\-\\/:{}<>$.]*)`, 'g');
const BARE_API = /(^|[^A-Za-z0-9_./])(\/api\/[A-Za-z0-9_\-\/:{}]*[A-Za-z0-9_}])/g;
const UPPER = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g;
const MSG_LIKE = /^(GET|SET|SAVE|DELETE|SYNC|PARSE|RUN|CHECK|OPEN|MARK|CLEAR|UPDATE|RECOVER|LIST|TOGGLE|ARCHIVE|MERGE|ADD|REMOVE|CLEANUP|FETCH|REFRESH|IMPORT|EXPORT|RESET)_[A-Z0-9_]+$/;
const ROUTE_GENERIC = new Set(['NOT_FOUND', 'METHOD_NOT_ALLOWED', 'INTERNAL']);
const STATUS_RE = /(?:HTTP\s*|status\s*[=:：]?\s*|返回\s*|状态码\s*[=:：]?\s*)([1-5]\d{2})\b/gi;

function textOf(t) {
  return [...(t.preconditions || []), ...(t.steps || []), ...(t.expected || []), t.testData || ''].map(String);
}

/** 规范化用例里写的路径：<id> / {id} / ${x} → :id，去掉末尾标点和斜杠 */
function cleanPath(p) {
  return String(p).replace(/<[^>]*>|\{[^}]*\}|\$\{[^}]*\}/g, ':id').replace(/[.,;:，。；：)）]+$/, '').replace(/\/+$/, '') || '/';
}

function buildContract(ctx) {
  const api = ctx.readJson(ctx.PATHS.api, false);
  const eps = (api?.endpoints || []).map((e) => {
    const method = String(e.method || '').toUpperCase();
    const p = String(e.path || '').replace(/\/+$/, '');
    const rx = new RegExp('^' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
    const codes = new Map();
    for (const er of e.errors || []) {
      const code = er?.body?.error?.code || er?.code;
      if (!code) continue;
      if (!codes.has(code)) codes.set(code, new Set());
      codes.get(code).add(Number(er.status));
    }
    return { method, path: p, key: `${method} ${p}`, rx, codes, errors: e.errors || [], raw: e };
  });
  const common = new Map();
  for (const c of api?.common?.errorCodes || []) if (c?.code) common.set(c.code, Number(c.status));
  const universe = new Set([...common.keys(), ...eps.flatMap((e) => [...e.codes.keys()])]);
  return { api, eps, common, universe };
}

/** 在契约中查找路径：返回 { path: 匹配的接口列表（任意方法）, exact: 方法也匹配的接口 } */
function findEndpoint(K, method, rawPath) {
  const p = cleanPath(rawPath);
  const byPath = K.eps.filter((e) => e.rx.test(p) || e.path === p);
  return { p, byPath, exact: byPath.filter((e) => e.method === method) };
}

export function checkAlign(ctx) {
  const R = ctx.R;
  const S = {};
  const stat = (k) => (S[k] ||= { checked: 0, errors: 0, warnings: 0 });
  const E = (check, where, msg) => { stat(check).errors++; R.errors.push(`[align:${check}] ${where}：${msg}`); };
  const W = (check, where, msg) => { stat(check).warnings++; R.warnings.push(`[align:${check}] ${where}：${msg}`); };

  const F = ctx.loadFeatures(false); const C = ctx.loadCodePoints(false); const T = ctx.loadCases(false);
  const K = buildContract(ctx);
  const ui = ctx.readJson(ctx.PATHS.ui, false);
  if (!K.api) E('contract', ctx.PATHS.api, '缺少 api-contract.json，无法做对齐检查');
  if (!ui) E('cases-ui', ctx.PATHS.ui, '缺少 ui-contract.json，无法做对齐检查');

  // ---------------------------------------------------------------- contract：契约内部一致性
  if (K.api) {
    const commonSeen = new Map();
    for (const c of K.api.common?.errorCodes || []) {
      if (commonSeen.has(c.code) && commonSeen.get(c.code) !== Number(c.status)) E('contract', `${ctx.PATHS.api}#common.errorCodes`, `通用错误码 ${c.code} 对应多个状态码（${commonSeen.get(c.code)} / ${c.status}）`);
      commonSeen.set(c.code, Number(c.status));
    }
    const whenMap = new Map();
    const normWhen = (s) => String(s || '').replace(/[\s，,。.；;：:、（）()「」"'`]/g, '').toLowerCase();
    for (const c of K.api.common?.errorCodes || []) if (c.when) whenMap.set(normWhen(c.when), [{ where: 'common.errorCodes', status: Number(c.status), code: c.code }]);
    for (const e of K.eps) {
      stat('contract').checked++;
      for (const [code, statuses] of e.codes) {
        if (statuses.size > 1) E('contract', `${e.key}`, `错误码 ${code} 对应多个状态码（${[...statuses].join(' / ')}）`);
        if (K.common.has(code) && !statuses.has(K.common.get(code))) E('contract', `${e.key}`, `错误码 ${code} 在该接口中为 ${[...statuses].join('/')}，但通用错误表中为 ${K.common.get(code)}`);
      }
      for (const er of e.errors) {
        const w = normWhen(er.when);
        if (!w) continue;
        if (!whenMap.has(w)) whenMap.set(w, []);
        whenMap.get(w).push({ where: e.key, status: Number(er.status), code: er?.body?.error?.code || er?.code });
      }
    }
    for (const [w, list] of whenMap) {
      const statuses = new Set(list.map((x) => x.status));
      if (statuses.size > 1) W('contract', list.map((x) => x.where).filter((v, i, a) => a.indexOf(v) === i).join('、'), `同一个错误条件对应多个状态码（${list.map((x) => `${x.where}=${x.status} ${x.code || ''}`).join('；')}）：「${ctx.short(list[0] && w, 60)}」`);
    }
  }

  // ---------------------------------------------------------------- cases-api：API / E2E 用例 ↔ api-contract
  const checkEndpoints = (t, check, segs) => {
    const whole = segs.join('\n');
    const mentioned = [];
    for (const s of segs) {
      for (const m of s.matchAll(EP_MENTION)) {
        const method = m[1];
        if (method === 'OPTIONS' || method === 'HEAD') continue; // CORS 预检等不在契约接口表中
        const f = findEndpoint(K, method, m[2]);
        stat(check).checked++;
        if (!f.byPath.length) { E(check, t.id, `引用的接口 ${method} ${f.p} 不在 api-contract 中`); continue; }
        if (!f.exact.length) {
          if (/\b405\b|METHOD_NOT_ALLOWED/.test(whole)) continue; // 有意用错方法的反例
          E(check, t.id, `api-contract 中 ${f.p} 只有 ${f.byPath.map((e) => e.method).join(' / ')}，没有 ${method}（如果是反例，请在 expected 中写明 405 / METHOD_NOT_ALLOWED）`);
          continue;
        }
        mentioned.push(...f.exact);
      }
    }
    return mentioned;
  };
  for (const t of T.list.filter((x) => x.type === 'API' || x.type === 'E2E')) {
    const segs = textOf(t);
    const eps = checkEndpoints(t, 'cases-api', segs);
    // 错误码：必须是所调用接口声明过的，或者是通用错误表 / 路由级通用错误；状态码与错误码同时出现时必须匹配
    const declared = new Map();
    for (const e of eps) for (const [code, st] of e.codes) declared.set(code, new Set([...(declared.get(code) || []), ...st]));
    for (const s of [...(t.expected || []), ...(t.steps || [])].map(String)) {
      const codes = [...new Set([...s.matchAll(UPPER)].map((m) => m[1]).filter((c) => K.universe.has(c)))];
      if (!codes.length) continue;
      const statuses = [...new Set([...s.matchAll(STATUS_RE)].map((m) => Number(m[1])))];
      for (const code of codes) {
        stat('cases-api').checked++;
        const allowed = declared.get(code) || (K.common.has(code) ? new Set([K.common.get(code)]) : null) || (ROUTE_GENERIC.has(code) ? new Set() : null);
        if (!allowed) { E('cases-api', t.id, `期望的错误码 ${code} 没有在所调用的接口（${eps.map((e) => e.key).join('、') || '未识别到接口'}）或通用错误表中声明`); continue; }
        if (!declared.has(code) && eps.length && !ROUTE_GENERIC.has(code)) W('cases-api', t.id, `错误码 ${code} 来自通用错误表，所调用的接口（${eps.map((e) => e.key).join('、')}）的 errors 中没有单独声明`);
        if (statuses.length === 1 && allowed.size && !allowed.has(statuses[0])) E('cases-api', t.id, `期望「${statuses[0]} ${code}」，但契约中 ${code} 对应的状态码为 ${[...allowed].join(' / ')}`);
      }
    }
  }

  // ---------------------------------------------------------------- cases-ui：UI 用例 ↔ ui-contract
  if (ui) {
    const tids = new Set((ui.pages || []).flatMap((p) => (p.elements || []).map((e) => e.testId)));
    const tidList = [...tids];
    const prefixes = new Set(tidList.map((x) => x.split('-')[0]));
    const msgs = new Set((ui.messages || []).map((m) => m.type));
    const keys = new Set((ui.storageKeys || []).map((s) => s.key));
    const isFamily = (tok) => tidList.some((x) => x.startsWith(tok + '-'));
    for (const t of T.list.filter((x) => x.type === 'UI')) {
      const segs = textOf(t);
      checkEndpoints(t, 'cases-ui', segs);
      for (const s of segs) {
        // testId：kebab-case 标识，第一段是已登记 testId 的前缀；不在 URL / 路径里；不是某个已登记 testId 的家族前缀
        for (const m of s.matchAll(/(^|[^A-Za-z0-9_\/.:#@-])([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?![A-Za-z0-9_\/.-])/g)) {
          const tok = m[2];
          if (!prefixes.has(tok.split('-')[0])) continue;
          stat('cases-ui').checked++;
          if (tids.has(tok) || isFamily(tok)) continue;
          E('cases-ui', t.id, `引用的 testId「${tok}」没有在 ui-contract 中登记`);
        }
        for (const m of s.matchAll(UPPER)) {
          const tok = m[1];
          if (!MSG_LIKE.test(tok) || K.universe.has(tok)) continue;
          stat('cases-ui').checked++;
          if (!msgs.has(tok)) E('cases-ui', t.id, `引用的消息 type「${tok}」没有在 ui-contract.messages 中登记`);
        }
        for (const m of s.matchAll(/storage(?:\.local)?\.(?:get|set|remove)\(\s*(?:\{\s*|\[\s*)?['"`]([A-Za-z_][A-Za-z0-9_]*)['"`]|(?:storage\s*key|storageKey|存储键)\s*[「"'`]?\s*([A-Za-z_][A-Za-z0-9_]*)/gi)) {
          const tok = m[1] || m[2];
          stat('cases-ui').checked++;
          if (!keys.has(tok)) E('cases-ui', t.id, `引用的 storage key「${tok}」没有在 ui-contract.storageKeys 中登记`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- fe-be：前端依赖的后端接口在契约中存在
  if (K.api) {
    for (const c of C.list.filter((x) => x.side === 'FE')) {
      for (const i of c.interfaces || []) {
        const m = new RegExp(`^(${METHODS})\\s+(\\/\\S+)`).exec(String(i).trim());
        stat('fe-be').checked++;
        if (!m) { W('fe-be', c.id, `interfaces 中的「${i}」不是「METHOD /path」格式`); continue; }
        const f = findEndpoint(K, m[1], m[2]);
        if (!f.exact.length) E('fe-be', c.id, `interfaces 引用的 ${m[1]} ${f.p} 不在 api-contract 中${f.byPath.length ? `（契约中该路径只有 ${f.byPath.map((e) => e.method).join(' / ')}）` : ''}`);
      }
    }
    for (const msg of ui?.messages || []) {
      const s = JSON.stringify(msg);
      for (const m of s.matchAll(EP_MENTION)) {
        stat('fe-be').checked++;
        const f = findEndpoint(K, m[1], m[2]);
        if (!f.exact.length) E('fe-be', `ui-contract.messages.${msg.type}`, `引用的 ${m[1]} ${f.p} 不在 api-contract 中`);
      }
    }
    const fe = ctx.readText(ctx.PATHS.feDoc, false);
    if (fe) {
      fe.split('\n').forEach((line, i) => {
        const where = `${ctx.PATHS.feDoc}:${i + 1}`;
        const withMethod = [...line.matchAll(EP_MENTION)];
        for (const m of withMethod) {
          if (m[1] === 'OPTIONS' || m[1] === 'HEAD') continue;
          stat('fe-be').checked++;
          const f = findEndpoint(K, m[1], m[2]);
          if (!f.byPath.length) E('fe-be', where, `引用的接口 ${m[1]} ${f.p} 不在 api-contract 中`);
          else if (!f.exact.length) E('fe-be', where, `api-contract 中 ${f.p} 只有 ${f.byPath.map((e) => e.method).join(' / ')}，没有 ${m[1]}`);
        }
        const covered = new Set(withMethod.map((m) => cleanPath(m[2])));
        for (const m of line.matchAll(BARE_API)) {
          const p = cleanPath(m[2]);
          if (covered.has(p) || p === '/api' || p.endsWith('/__test__')) continue;
          stat('fe-be').checked++;
          if (!K.eps.some((e) => e.rx.test(p) || e.path === p || e.path.startsWith(p + '/'))) E('fe-be', where, `引用的路径 ${p} 不在 api-contract 中`);
        }
      });
    }
  }

  // ---------------------------------------------------------------- ac-coverage：每条 inScope AC 至少被 1 个用例引用
  const refs = new Set(T.list.flatMap((t) => t.acceptanceRefs || []));
  for (const f of F.list.filter((x) => x.inScope)) {
    (f.acceptance || []).forEach((a, i) => {
      const m = /^AC(\d+)/.exec(String(a));
      const key = `${f.id}#AC${m ? m[1] : i + 1}`;
      stat('ac-coverage').checked++;
      if (!refs.has(key)) E('ac-coverage', key, `没有任何用例在 acceptanceRefs 中引用这条验收标准：${ctx.short(a, 100)}`);
    });
  }

  // ---------------------------------------------------------------- prd-samples：PRD 第 13 章样例 URL 在用例中出现
  const prd = ctx.readText(ctx.PATHS.prd, false);
  if (prd) {
    const start = prd.search(/^##\s*13[\s.、．]/m);
    if (start < 0) W('prd-samples', ctx.PATHS.prd, '没有找到第 13 章（样例数据推演）');
    else {
      const rest = prd.slice(start + 3);
      const end = rest.search(/^##\s/m);
      const sec = end < 0 ? rest : rest.slice(0, end);
      const urls = [...new Set([...sec.matchAll(/[`"'「]((?:https?:\/\/)[^\s`"'」）)]+)[`"'」]/g)].map((m) => m[1].replace(/[.,;，。；]+$/, '')))];
      const corpus = JSON.stringify(T.list);
      for (const u of urls) {
        stat('prd-samples').checked++;
        const bare = u.replace(/^https?:\/\//, '').replace(/\/$/, '');
        if (!corpus.includes(bare)) W('prd-samples', `${ctx.PATHS.prd}#13`, `样例 URL ${u} 没有出现在任何用例中`);
      }
    }
  }

  // ---------------------------------------------------------------- board：stage ≤ align 的阻塞项必须已关闭
  checkBoard(ctx, { freeze: 'align', report: (m) => { stat('board').errors++; R.errors.push(`[align:board] ${m}`); } });

  R.stats.align = S;
}
