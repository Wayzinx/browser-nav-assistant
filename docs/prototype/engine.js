/*
 * 浏览器导航助手 · 原型 Mock 引擎
 *
 * 与 PRD 第 6 章的算法口径保持一致：URL 归一化 / 隐私过滤 / 同步入库 / 评分排序 /
 * 下一步推荐 / 整理建议 / 自然语言规则解析。原型页面直接调用它渲染数据，
 * 也可以在 Node 中运行 `node docs/prototype/engine.js` 打印样例数据的计算结果。
 *
 * 注意：这是产品原型的参考实现，不是最终后端代码。
 */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const HOUR = 3600000;
  const MIN = 60000;

  const DEFAULT_CONFIG = {
    cleanupThresholdDays: 14,
    maxHistoryItems: 100,
    enablePrivacyFilter: true,
    privacySensitiveKeywords: ['password', 'token', 'bank', 'secret'],
    recencyHalfLifeDays: 7,
    weights: { recency: 0.4, frequency: 0.3, open: 0.2, domain: 0.1 },
  };

  // 跟踪参数：归一化时直接去掉（不影响页面内容）
  const TRACKING_PARAM = /^(utm_[a-z]+|ref|ref_src|spm|from|fbclid|gclid|_ga)$/i;
  // 判重时保留的“有语义”的 query：去掉会把不同搜索词 / 视频误判为重复
  const MEANINGFUL_PARAMS = ['q', 'query', 'wd', 'keyword', 'search', 'v', 'id'];

  const MIN_REC_SCORE = 0.3; // 低于该分数的推荐不展示，宁缺毋滥

  const DOC_DOMAINS = ['developer.mozilla.org', 'react.dev', 'docs.internal.com', 'vuejs.org', 'nodejs.org'];

  // ---------------------------------------------------------------- URL 工具

  function safeUrl(url) {
    try { return new URL(url); } catch (e) { return null; }
  }

  function isTrackable(url) {
    const u = safeUrl(url);
    return !!u && (u.protocol === 'http:' || u.protocol === 'https:');
  }

  function domainOf(url) {
    const u = safeUrl(url);
    return u ? u.hostname.toLowerCase().replace(/^www\./, '') : '';
  }

  /** 存储主键：小写 host、去 hash、去跟踪参数、参数排序、去尾部斜杠 */
  function normalizeUrl(url) {
    const u = safeUrl(url);
    if (!u) return url;
    u.hash = '';
    const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING_PARAM.test(k));
    kept.sort((a, b) => a[0].localeCompare(b[0]));
    u.search = kept.length ? '?' + new URLSearchParams(kept).toString() : '';
    let s = u.protocol + '//' + u.host.toLowerCase() + u.pathname.replace(/\/+$/, '') + u.search;
    if (u.pathname === '/') s = u.protocol + '//' + u.host.toLowerCase() + '/' + u.search;
    return s;
  }

  /** 判重 key：只保留有语义的 query，其余全部去掉 */
  function dupKey(url) {
    const u = safeUrl(url);
    if (!u) return url;
    const kept = MEANINGFUL_PARAMS.filter((k) => u.searchParams.has(k)).map((k) => k + '=' + u.searchParams.get(k));
    return u.host.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '') + (kept.length ? '?' + kept.join('&') : '');
  }

  function githubRepo(url) {
    const u = safeUrl(url);
    if (!u || domainOf(url) !== 'github.com') return null;
    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length < 2) return null;
    return { repo: seg[0] + '/' + seg[1], kind: seg[2] || 'home' };
  }

  function sensitiveKeyword(url, keywords) {
    const lower = String(url).toLowerCase();
    return keywords.find((k) => lower.includes(String(k).toLowerCase())) || null;
  }

  // ---------------------------------------------------------- 插件侧：上传前过滤

  /**
   * 插件在发送 /api/sync 前调用：去掉非 http(s) 页面和含敏感词的 URL。
   * 返回过滤后的 payload 与被过滤的明细（只在本地展示，不上传）。
   */
  function filterForUpload(payload, config) {
    const keywords = config.enablePrivacyFilter ? config.privacySensitiveKeywords : [];
    const filtered = [];
    const pass = (item, source) => {
      if (!item || !isTrackable(item.url)) {
        if (item) filtered.push({ url: item.url, title: item.title, source, reason: 'system' });
        return false;
      }
      const hit = sensitiveKeyword(item.url, keywords);
      if (hit) { filtered.push({ url: item.url, title: item.title, source, reason: 'privacy', keyword: hit }); return false; }
      return true;
    };
    return {
      payload: {
        activeTab: pass(payload.activeTab, 'active_tab') ? payload.activeTab : null,
        openTabs: payload.openTabs.filter((t) => pass(t, 'open_tab')),
        history: payload.history.filter((h) => pass(h, 'history')),
      },
      filtered,
    };
  }

  // ---------------------------------------------------------------- 后端：入库

  function createStore() {
    return { pages: new Map(), seq: 0 };
  }

  /** POST /api/sync 的入库语义（按 normalizedUrl 去重 + 合并） */
  function ingest(store, payload, now) {
    const stat = { received: 0, created: 0, updated: 0 };
    const openKeys = new Set();

    const upsert = (item, source, patch) => {
      stat.received += 1;
      const key = normalizeUrl(item.url);
      let page = store.pages.get(key);
      if (!page) {
        store.seq += 1;
        page = {
          id: 'page_' + store.seq,
          url: item.url,
          normalizedUrl: key,
          title: item.title || item.url,
          domain: domainOf(item.url),
          visitCount: 0,
          lastVisitedAt: 0,
          firstSeenAt: now,
          sources: [],
          isOpen: false,
          isActive: false,
          isArchived: false,
          score: 0,
        };
        store.pages.set(key, page);
        stat.created += 1;
      } else {
        stat.updated += 1;
      }
      if (item.title) page.title = item.title;
      if (!page.sources.includes(source)) page.sources.push(source);
      patch(page);
      page.visitCount = Math.max(page.visitCount, 1);
      return key;
    };

    payload.history.forEach((h) => upsert(h, 'history', (p) => {
      // Chrome 的 visitCount 是累计值：取 max，避免重复同步导致翻倍
      p.visitCount = Math.max(p.visitCount, h.visitCount || 1);
      p.lastVisitedAt = Math.max(p.lastVisitedAt, h.lastVisitTime || 0);
      p.firstSeenAt = Math.min(p.firstSeenAt, h.lastVisitTime || now);
    }));
    payload.openTabs.forEach((t) => openKeys.add(upsert(t, 'open_tab', (p) => {
      p.lastVisitedAt = Math.max(p.lastVisitedAt, t.lastAccessed || p.lastVisitedAt || now);
    })));
    if (payload.activeTab) {
      openKeys.add(upsert(payload.activeTab, 'active_tab', (p) => { p.lastVisitedAt = now; }));
    }

    // 打开状态是快照语义：本次未出现的页面视为已关闭
    const activeKey = payload.activeTab ? normalizeUrl(payload.activeTab.url) : null;
    store.pages.forEach((p, key) => {
      p.isOpen = openKeys.has(key);
      p.isActive = key === activeKey;
    });
    return stat;
  }

  // ---------------------------------------------------------------- 规则匹配

  function ruleMatches(rule, page) {
    if (rule.enabled === false) return false;
    if (rule.domain && !(page.domain === rule.domain || page.domain.endsWith('.' + rule.domain))) return false;
    if (rule.urlPattern) {
      const u = safeUrl(page.url);
      const path = u ? u.pathname + u.search : page.url;
      if (!path.includes(rule.urlPattern)) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- 评分排序

  function scorePages(store, rules, config, now, important) {
    const w = config.weights;
    const pages = [...store.pages.values()].filter((p) => !p.isArchived);
    const maxVisit = Math.max(1, ...pages.map((p) => p.visitCount));
    const domainVisits = {};
    pages.forEach((p) => { domainVisits[p.domain] = (domainVisits[p.domain] || 0) + p.visitCount; });
    const maxDomain = Math.max(1, ...Object.values(domainVisits));
    const protect = rules.filter((r) => r.type === 'never_archive');
    const boost = rules.filter((r) => r.type === 'boost_domain');
    const importantSet = new Set((important || []).map(normalizeUrl));

    pages.forEach((p) => {
      const ageDays = Math.max(0, (now - p.lastVisitedAt) / DAY);
      const recency = Math.pow(0.5, ageDays / config.recencyHalfLifeDays);
      const frequency = Math.log(1 + p.visitCount) / Math.log(1 + maxVisit);
      const open = p.isOpen ? 1 : 0;
      let domain = domainVisits[p.domain] / maxDomain;
      let domainBy = 'affinity';
      const protectRule = protect.find((r) => ruleMatches(r, p));
      if (importantSet.has(p.normalizedUrl)) { domain = 1; domainBy = 'important'; }
      else if (protectRule) { domain = 1; domainBy = 'protect'; }
      else if (boost.find((r) => ruleMatches(r, p))) { domain = 1; domainBy = 'boost'; }

      const parts = {
        recency: w.recency * recency,
        frequency: w.frequency * frequency,
        open: w.open * open,
        domain: w.domain * domain,
      };
      p.factors = { recency, frequency, open, domain, domainBy, ageDays };
      p.contrib = parts;
      p.score = round2(parts.recency + parts.frequency + parts.open + parts.domain);
      p.reason = rankReason(p, config);
    });
    return pages.sort((a, b) => b.score - a.score || b.lastVisitedAt - a.lastVisitedAt);
  }

  function rankReason(p, config) {
    const f = p.factors;
    const out = [];
    if (p.isActive) out.push('正在浏览');
    if (f.ageDays < 3 && p.visitCount >= 3) out.push('最近 3 天内多次访问（' + p.visitCount + ' 次）');
    else if (f.ageDays < 1) out.push('今天访问过');
    else if (f.ageDays < 3) out.push('最近 3 天内访问');
    else if (f.ageDays >= config.cleanupThresholdDays) out.push('已 ' + Math.floor(f.ageDays) + ' 天未访问');
    else out.push(Math.floor(f.ageDays) + ' 天前访问');
    if (p.visitCount >= 5 && !(f.ageDays < 3)) out.push('高频访问（' + p.visitCount + ' 次）');
    if (p.isOpen && !p.isActive) out.push('当前仍处于打开状态');
    if (f.domainBy === 'important') out.push('已被你标记为重要');
    else if (f.domainBy === 'protect') out.push('属于受保护域名');
    else if (f.domainBy === 'boost') out.push('命中优先域名规则');
    else if (f.domain >= 0.6) out.push('常用域名 ' + p.domain);
    return out.slice(0, 3).join('，');
  }

  // ---------------------------------------------------------------- 下一步推荐

  function recommendNext(store, rules, config, ctx, now, important) {
    const ranked = scorePages(store, rules, config, now, important);
    const current = ctx.currentPage;
    const exclude = new Set();
    [current].concat(ctx.openTabs || []).filter(Boolean).forEach((t) => exclude.add(dupKey(t.url)));

    const curRepo = current ? githubRepo(current.url) : null;
    const curDomain = current ? domainOf(current.url) : '';
    const curPath = current ? (safeUrl(current.url) || {}).pathname || '' : '';
    const isDoc = DOC_DOMAINS.includes(curDomain) || /\/(docs|reference|learn|guide)\b/.test(curPath);

    // 规则触发：从最近一次访问往前数，连续属于触发域名的页面数
    const recent = (ctx.recentHistory || []).slice().sort((a, b) => b.lastVisitTime - a.lastVisitTime);
    const triggered = rules.filter((r) => r.type === 'recommend_related' && r.enabled !== false).filter((r) => {
      let run = 0;
      const seen = new Set();
      for (const h of recent) {
        if (domainOf(h.url) !== r.trigger.domain) break;
        if (!seen.has(dupKey(h.url))) { seen.add(dupKey(h.url)); run += 1; }
      }
      return run >= r.trigger.minCount;
    });

    const importantSet = new Set((important || []).map(normalizeUrl));
    const activeRules = rules.filter((r) => r.enabled !== false);
    const recs = [];
    ranked.forEach((p) => {
      if (exclude.has(dupKey(p.url))) return;
      // 已被建议归档的旧页面不再推荐，避免“既推荐又让你归档”的矛盾
      if (archiveVerdict(p, activeRules, config, now, importantSet).state === 'archive') return;
      let rel = 0;
      let reason = '';
      let strategy = '';
      const repo = githubRepo(p.url);
      const rule = triggered.find((r) => p.domain === r.target.domain);
      if (rule) {
        rel = 0.95; strategy = 'rule';
        reason = '你已连续浏览 ' + rule.trigger.minCount + ' 个 ' + rule.trigger.label + ' 页面，按你的规则推荐相关 ' + rule.target.label + ' 页面';
      } else if (curRepo && repo && repo.repo === curRepo.repo) {
        strategy = 'same_repo';
        if (curRepo.kind === 'pull' && repo.kind === 'actions') { rel = 1; reason = '你正在查看 PR，同仓库 CI 页面最近访问频率较高，可能需要检查构建状态'; }
        else if (curRepo.kind === 'pull' && repo.kind === 'issues') { rel = 0.8; reason = '你正在查看 PR，同仓库的 Issue 可能与本次改动相关'; }
        else if (curRepo.kind === 'issues' && repo.kind === 'pull') { rel = 0.9; reason = '你正在查看 Issue，同仓库的 PR 可能是对应修复'; }
        else { rel = 0.7; reason = '与当前页面属于同一仓库 ' + curRepo.repo; }
      } else if (isDoc && p.domain === curDomain) {
        rel = 0.8; strategy = 'same_doc_site';
        reason = '你正在看 ' + curDomain + ' 文档，这是同站点访问 ' + p.visitCount + ' 次的高频页面';
      } else if (p.domain === curDomain) {
        rel = 0.6; strategy = 'same_domain';
        reason = '与当前页面同域名，历史评分较高（' + p.score.toFixed(2) + '）';
      } else {
        rel = 0.3; strategy = 'global_top';
        reason = '近期综合评分较高的页面，可作为备选';
      }
      recs.push({
        id: 'rec_' + p.id.replace('page_', ''),
        type: 'next_visit',
        url: p.url,
        title: p.title,
        domain: p.domain,
        score: round2(0.6 * rel + 0.4 * p.score),
        strategy,
        reason,
        createdAt: now,
      });
    });

    // 规则触发但库里没有目标域名页面：给一个站内搜索兜底
    triggered.forEach((r) => {
      if (recs.some((x) => x.strategy === 'rule' && x.domain === r.target.domain)) return;
      const q = encodeURIComponent((current && current.title || '').split(/[–|-]/)[0].trim());
      recs.push({
        id: 'rec_rule_' + r.id, type: 'next_visit', domain: r.target.domain, strategy: 'rule', score: 0.8, createdAt: now,
        url: 'https://' + r.target.domain + '/zh-CN/search?q=' + q,
        title: '在 ' + r.target.label + ' 中搜索「' + decodeURIComponent(q) + '」',
        reason: '你已连续浏览 ' + r.trigger.minCount + ' 个 ' + r.trigger.label + ' 页面，库中暂无 ' + r.target.label + ' 记录，按规则推荐站内搜索',
      });
    });

    const seen = new Set();
    return recs.sort((a, b) => b.score - a.score).filter((r) => {
      const k = dupKey(r.url);
      if (seen.has(k) || r.score < MIN_REC_SCORE) return false;
      seen.add(k);
      return true;
    }).slice(0, 5);
  }

  // ---------------------------------------------------------------- 整理建议

  /** 单页归档判定：保护规则 > 重要标记 > 打开中 > 归档规则阈值 > 默认阈值 */
  function archiveVerdict(p, rules, config, now, importantSet) {
    const ageDays = Math.floor((now - p.lastVisitedAt) / DAY);
    const guard = rules.find((r) => r.type === 'never_archive' && ruleMatches(r, p));
    if (guard) return { state: 'keep', ageDays, rule: guard };
    if (importantSet.has(p.normalizedUrl)) return { state: 'keep', ageDays, important: true };
    if (p.isOpen) return { state: 'open', ageDays };
    // 多条归档规则同时命中时取最严格（天数最小）的一条
    const hit = rules.filter((r) => r.type === 'archive_candidate' && ruleMatches(r, p)).sort((x, y) => x.inactiveDays - y.inactiveDays)[0];
    const threshold = hit ? hit.inactiveDays : config.cleanupThresholdDays;
    return { state: ageDays > threshold ? 'archive' : 'active', ageDays, threshold, rule: hit || null };
  }

  function cleanupSuggestions(store, rules, config, now, important) {
    const pages = scorePages(store, rules, config, now, important);
    const importantSet = new Set((important || []).map(normalizeUrl));
    const archive = [];
    const keep = [];

    pages.forEach((p) => {
      const v = archiveVerdict(p, rules, config, now, importantSet);
      if (v.state === 'keep' && v.rule) {
        keep.push({ action: 'keep', url: p.url, title: p.title, ruleId: v.rule.id,
          reason: '被保护域名配置（' + v.rule.domain + '），不建议归档' + (v.ageDays >= 3 ? '，虽已 ' + v.ageDays + ' 天未访问' : '') });
      } else if (v.state === 'keep') {
        keep.push({ action: 'keep', url: p.url, title: p.title, reason: '你已标记为重要，不建议归档' });
      } else if (v.state === 'archive') {
        archive.push({ action: 'archive', url: p.url, title: p.title, ageDays: v.ageDays, ruleId: v.rule ? v.rule.id : null,
          reason: '超过 ' + v.threshold + ' 天未访问（已 ' + v.ageDays + ' 天），且不在当前打开的 tab 中' + (v.rule ? '；命中规则「' + v.rule.rawText + '」' : '') });
      }
    });

    const groups = {};
    pages.forEach((p) => { (groups[dupKey(p.url)] = groups[dupKey(p.url)] || []).push(p); });
    const merge = Object.values(groups).filter((g) => g.length > 1).map((g) => {
      const sorted = g.slice().sort((a, b) => a.url.length - b.url.length);
      return { action: 'merge', urls: sorted.map((p) => p.url), titles: sorted.map((p) => p.title), keepUrl: sorted[0].url,
        reason: '去掉 query 参数后 URL 相同，疑似重复页面' };
    });

    archive.sort((a, b) => b.ageDays - a.ageDays);
    return archive.concat(merge, keep);
  }

  // ---------------------------------------------------------------- 自然语言规则解析

  const DOMAIN_ALIASES = [
    { re: /github/i, domain: 'github.com', label: 'GitHub' },
    { re: /\bmdn\b/i, domain: 'developer.mozilla.org', label: 'MDN' },
    { re: /react/i, domain: 'react.dev', label: 'React' },
    { re: /google|谷歌/i, domain: 'google.com', label: 'Google' },
    { re: /stack\s?overflow/i, domain: 'stackoverflow.com', label: 'Stack Overflow' },
    { re: /\bnpm\b/i, domain: 'npmjs.com', label: 'npm' },
    { re: /飞书|lark/i, domain: 'feishu.cn', label: '飞书' },
    { re: /语雀/, domain: 'yuque.com', label: '语雀' },
  ];

  const PAGE_TYPES = [
    { re: /issues?/i, pattern: '/issues/', label: 'Issue' },
    { re: /\bpr\b|pull\s?request|合并请求/i, pattern: '/pull/', label: 'PR' },
    { re: /actions|\bci\b|流水线/i, pattern: '/actions', label: 'Actions' },
    { re: /搜索结果|搜索页|search/i, pattern: '/search', label: '搜索结果' },
  ];

  const CN_NUM = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  function cnToInt(s) {
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === '十') return 10;
    const m = s.match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
    if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
    return CN_NUM[s] != null ? CN_NUM[s] : NaN;
  }

  const NUM = '(\\d+|[零一二两三四五六七八九十]+)';

  function extractDays(seg) {
    const m = seg.match(new RegExp(NUM + '\\s*(天|日|周|星期|个月|月)'));
    if (!m) return null;
    const n = cnToInt(m[1]);
    const unit = m[2];
    return n * (unit === '周' || unit === '星期' ? 7 : unit === '个月' || unit === '月' ? 30 : 1);
  }

  function extractDomains(seg) {
    const found = [];
    const explicit = /((?:[a-z0-9-]+\.)+[a-z]{2,})/gi;
    let m;
    while ((m = explicit.exec(seg))) found.push({ at: m.index, domain: m[1].toLowerCase().replace(/^www\./, ''), label: m[1] });
    DOMAIN_ALIASES.forEach((a) => {
      const mm = seg.match(a.re);
      if (mm && !found.some((f) => f.domain === a.domain || f.domain.endsWith('.' + a.domain))) found.push({ at: mm.index, domain: a.domain, label: a.label });
    });
    return found.sort((x, y) => x.at - y.at);
  }

  function splitClauses(text) {
    const strong = text.split(/[；;。\n]|但是|但|另外|同时|而且|并且/).map((s) => s.trim()).filter(Boolean);
    const out = [];
    strong.forEach((s) => {
      const parts = s.split(/[，,]/).map((x) => x.trim()).filter(Boolean);
      for (let i = 0; i < parts.length; i++) {
        // “如果 A，B” 是一个完整条件句，不能拆开
        if (/^(如果|若|当|要是)/.test(parts[i]) && i + 1 < parts.length) { out.push(parts[i] + '，' + parts[i + 1]); i++; }
        else out.push(parts[i]);
      }
    });
    return out;
  }

  let ruleSeq = 0;

  function parseRules(text, config) {
    const cfg = config || DEFAULT_CONFIG;
    const rules = [];
    const unparsed = [];
    splitClauses(String(text || '')).forEach((seg) => {
      const domains = extractDomains(seg);
      const pageType = PAGE_TYPES.find((t) => t.re.test(seg));
      const days = extractDays(seg);
      const notes = [];
      const base = { id: 'rule_' + (++ruleSeq), rawText: seg, enabled: true };

      if (/(不要|别|禁止|不)\s*(上传|同步|采集|记录)|隐私过滤|屏蔽/.test(seg)) {
        const m = seg.match(/(?:包含|含有|带有|含|带)\s*([\w\s、,，/和及]+?)\s*(?:等)?\s*(?:关键词|字样)?\s*的/);
        const keywords = m ? m[1].split(/[、,，/\s]|和|及/).map((k) => k.trim().toLowerCase()).filter(Boolean) : [];
        if (!keywords.length) { unparsed.push({ text: seg, reason: '识别到“不上传”，但没找到要过滤的关键词。试试：不要上传包含 password、token 的 URL' }); return; }
        rules.push(Object.assign(base, { type: 'privacy_filter', keywords, action: 'exclude_upload', confidence: 'high', notes }));
        return;
      }

      if (/推荐|建议(看|打开|访问)/.test(seg)) {
        const cut = seg.indexOf('推荐');
        const trig = domains.filter((d) => d.at < cut)[0];
        const target = domains.filter((d) => d.at > cut)[0];
        const cnt = seg.match(new RegExp('(?:连续|一连)?(?:看|访问|浏览|打开)了?\\s*' + NUM + '\\s*(?:个|篇|次|页)'));
        if (!trig || !target) { unparsed.push({ text: seg, reason: '推荐规则需要“触发站点”和“推荐站点”两个对象，例如：连续看了 3 个 React 文档，推荐相关 MDN 页面' }); return; }
        const minCount = cnt ? cnToInt(cnt[1]) : 3;
        if (!cnt) notes.push('未指定次数，默认连续 3 个');
        rules.push(Object.assign(base, {
          type: 'recommend_related', action: 'recommend',
          trigger: { domain: trig.domain, label: trig.label, minCount },
          target: { domain: target.domain, label: target.label },
          confidence: notes.length ? 'medium' : 'high', notes,
        }));
        return;
      }

      if (/(永远|永久|始终|一直|千万)?\s*(不要|别|不|禁止|无需|不用)\s*(要)?\s*(归档|关闭|清理|删)|保留|保护|白名单/.test(seg)) {
        if (!domains.length && !pageType) { unparsed.push({ text: seg, reason: '识别到“不要归档”，但没找到作用的域名或页面类型' }); return; }
        rules.push(Object.assign(base, {
          type: 'never_archive', action: 'keep',
          domain: domains[0] ? domains[0].domain : null, urlPattern: pageType ? pageType.pattern : null,
          confidence: 'high', notes,
        }));
        return;
      }

      if (/归档|清理|关闭|收起/.test(seg)) {
        let inactiveDays = days;
        if (inactiveDays == null) { inactiveDays = cfg.cleanupThresholdDays; notes.push('未指定天数，使用默认 ' + inactiveDays + ' 天'); }
        if (!domains.length && !pageType) notes.push('未指定域名或页面类型，将作用于全部页面');
        rules.push(Object.assign(base, {
          type: 'archive_candidate', action: 'suggest_archive',
          domain: domains[0] ? domains[0].domain : null, urlPattern: pageType ? pageType.pattern : null, inactiveDays,
          confidence: notes.length ? 'medium' : 'high', notes,
        }));
        return;
      }

      if (/优先|置顶|重要|加权|提升/.test(seg) && domains.length) {
        rules.push(Object.assign(base, { type: 'boost_domain', action: 'boost', domain: domains[0].domain, urlPattern: pageType ? pageType.pattern : null, confidence: 'high', notes }));
        return;
      }

      unparsed.push({ text: seg, reason: '没有识别到动作（归档 / 不要归档 / 推荐 / 不上传 / 优先）' });
    });

    // 冲突检测：同一范围既“归档”又“永不归档”时，保护优先
    const warnings = [];
    rules.filter((r) => r.type === 'archive_candidate').forEach((a) => {
      const k = rules.find((r) => r.type === 'never_archive' && r.domain && r.domain === a.domain);
      if (k) warnings.push('「' + a.rawText + '」与「' + k.rawText + '」冲突，执行时“永不归档”优先');
    });
    return { rules, unparsed, warnings };
  }

  function describeRule(r) {
    const scope = [r.domain, r.urlPattern].filter(Boolean).join(' · ') || '全部页面';
    switch (r.type) {
      case 'archive_candidate': return scope + ' · ' + r.inactiveDays + ' 天未访问 → 建议归档';
      case 'never_archive': return scope + ' → 永不归档';
      case 'privacy_filter': return 'URL 含 ' + r.keywords.join(' / ') + ' → 不上传';
      case 'recommend_related': return '连续 ' + r.trigger.minCount + ' 个 ' + r.trigger.domain + ' → 推荐 ' + r.target.domain;
      case 'boost_domain': return scope + ' → 排序加权';
      default: return scope;
    }
  }

  // ---------------------------------------------------------------- 样例数据

  // 来自 resources/sample-history.json（题目提供的 resource.json）
  const SAMPLE = {
    activeTab: { url: 'https://github.com/org/repo/pull/456', title: 'Refactor auth middleware (#456)' },
    openTabs: [
      { url: 'https://github.com/org/repo/issues/123', title: 'Fix login redirect bug' },
      { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', title: 'Fetch API - Web APIs | MDN' },
      { url: 'https://docs.internal.com/ai-agent-design', title: 'AI Agent Design Guidelines' },
    ],
    history: [
      { url: 'https://github.com/org/repo/pull/456', title: 'Refactor auth middleware (#456)', lastVisitTime: 1710100000000, visitCount: 5 },
      { url: 'https://github.com/org/repo/issues/123', title: 'Fix login redirect bug', lastVisitTime: 1710090000000, visitCount: 8 },
      { url: 'https://github.com/org/repo/actions', title: 'Actions · org/repo', lastVisitTime: 1710080000000, visitCount: 3 },
      { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API', title: 'Fetch API - Web APIs | MDN', lastVisitTime: 1710070000000, visitCount: 4 },
      { url: 'https://docs.internal.com/ai-agent-design', title: 'AI Agent Design Guidelines', lastVisitTime: 1709500000000, visitCount: 2 },
      { url: 'https://github.com/org/repo/issues/100', title: 'Old bug report from last sprint', lastVisitTime: 1708000000000, visitCount: 1 },
      { url: 'https://www.google.com/search?q=chrome+extension+manifest+v3', title: 'chrome extension manifest v3 - Google Search', lastVisitTime: 1707000000000, visitCount: 1 },
      { url: 'https://github.com/org/repo/issues/123?tab=comments', title: 'Fix login redirect bug - Comments', lastVisitTime: 1710088000000, visitCount: 3 },
      { url: 'https://react.dev/reference/react/useState', title: 'useState – React', lastVisitTime: 1710060000000, visitCount: 6 },
      { url: 'https://react.dev/learn', title: 'Quick Start – React', lastVisitTime: 1710055000000, visitCount: 2 },
    ],
  };

  // 原型额外补充的演示数据：用于展示隐私过滤、7 天 Issue 规则和 React→MDN 规则
  const DEMO_EXTRAS = [
    { url: 'https://github.com/org/repo/issues/87', title: 'Flaky e2e test on Safari', lastVisitTime: 1710100000000 - 10 * DAY, visitCount: 2 },
    { url: 'https://react.dev/reference/react/useEffect', title: 'useEffect – React', lastVisitTime: 1710057000000, visitCount: 3 },
    { url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise', title: 'Promise - JavaScript | MDN', lastVisitTime: 1710100000000 - 2 * DAY, visitCount: 3 },
    { url: 'https://accounts.example.com/reset-password?token=8f2a91c', title: '重置密码', lastVisitTime: 1710095000000, visitCount: 1 },
    { url: 'https://bank.example.com/account/overview', title: '网上银行 - 账户总览', lastVisitTime: 1710052000000, visitCount: 2 },
    { url: 'chrome://extensions/', title: '扩展程序', lastVisitTime: 1710099000000, visitCount: 4 },
  ];

  /**
   * 把样例时间平移到“现在”：最新一条历史 = now - 5 分钟。
   * 样例时间戳是 2024 年，不平移的话所有页面都会被判定为旧页面。
   */
  function buildDemoPayload(now, opts) {
    const o = opts || {};
    const history = SAMPLE.history.concat(o.extras === false ? [] : DEMO_EXTRAS);
    const newest = Math.max(...SAMPLE.history.map((h) => h.lastVisitTime));
    const offset = now - 5 * MIN - newest;
    const shifted = history.map((h) => Object.assign({}, h, { lastVisitTime: h.lastVisitTime + offset }));
    let activeTab = SAMPLE.activeTab;
    const openTabs = SAMPLE.openTabs.slice();
    if (o.scenario === 'react') {
      // 场景：刚连续看了 3 篇 React 文档
      activeTab = { url: 'https://react.dev/reference/react/useEffect', title: 'useEffect – React' };
      openTabs.unshift(SAMPLE.activeTab);
      [['useEffect', 1], ['useState', 2], ['learn', 3]].forEach(([k, m]) => {
        const h = shifted.find((x) => x.url.includes('react.dev') && x.url.includes(k));
        if (h) h.lastVisitTime = now - m * MIN;
      });
    } else if (o.scenario === 'system') {
      activeTab = { url: 'chrome://extensions/', title: '扩展程序' };
      openTabs.unshift(SAMPLE.activeTab);
    }
    return { activeTab, openTabs, history: shifted.sort((a, b) => b.lastVisitTime - a.lastVisitTime) };
  }

  function round2(n) { return Math.round(n * 100) / 100; }

  const api = {
    DAY, HOUR, MIN, DEFAULT_CONFIG, SAMPLE, DEMO_EXTRAS,
    safeUrl, isTrackable, domainOf, normalizeUrl, dupKey, githubRepo, sensitiveKeyword,
    filterForUpload, createStore, ingest, ruleMatches, scorePages, recommendNext, archiveVerdict, cleanupSuggestions,
    parseRules, describeRule, splitClauses, buildDemoPayload,
  };

  root.NavEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  // node docs/prototype/engine.js —— 打印样例数据的计算结果（PRD 示例数字来源）
  if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
    const now = Date.now();
    const cfg = DEFAULT_CONFIG;
    const raw = buildDemoPayload(now);
    const { payload, filtered } = filterForUpload(raw, cfg);
    const store = createStore();
    console.log('sync:', ingest(store, payload, now), 'filtered:', filtered.map((f) => f.reason + ':' + (f.keyword || '') + ' ' + f.url));
    const parsed = parseRules('把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档；如果我连续看了 3 个 React 文档，推荐相关 MDN 页面。不要上传包含 password、token 的 URL', cfg);
    console.log('\nparse:'); parsed.rules.forEach((r) => console.log(' ', r.type, '|', describeRule(r), '|', r.rawText, r.notes.join(';')));
    console.log('  unparsed:', parsed.unparsed, 'warnings:', parsed.warnings);
    const rules = parsed.rules.filter((r) => r.type !== 'privacy_filter');
    console.log('\nranked:');
    scorePages(store, rules, cfg, now).forEach((p) => console.log(' ', p.score.toFixed(2), p.factors.recency.toFixed(2), p.factors.frequency.toFixed(2), p.factors.open, p.factors.domain.toFixed(2), p.factors.ageDays.toFixed(1) + 'd', p.url, '|', p.reason));
    console.log('\nrecommend:');
    recommendNext(store, rules, cfg, { currentPage: payload.activeTab, openTabs: payload.openTabs, recentHistory: payload.history }, now)
      .forEach((r) => console.log(' ', r.score, r.strategy, r.url, '|', r.reason));
    console.log('\ncleanup (no rules):');
    cleanupSuggestions(store, [], cfg, now).forEach((s) => console.log(' ', s.action, s.url || s.urls.join(' + '), '|', s.reason));
    console.log('\ncleanup (with rules):');
    cleanupSuggestions(store, rules, cfg, now).forEach((s) => console.log(' ', s.action, s.url || s.urls.join(' + '), '|', s.reason));
    ['帮我整理一下', '两周没看的搜索结果页建议归档', '别关闭 docs 页面', '不要上传含 secret 的网址', '飞书文档优先显示'].forEach((t) => {
      const r = parseRules(t, cfg);
      console.log('\nparse "' + t + '":', JSON.stringify(r.rules.map((x) => describeRule(x) + ' ' + x.notes.join(';'))), JSON.stringify(r.unparsed));
    });
    const react = buildDemoPayload(now, { scenario: 'react' });
    const s2 = createStore();
    const f2 = filterForUpload(react, cfg).payload;
    ingest(s2, f2, now);
    console.log('\nrecommend (react scenario):');
    recommendNext(s2, rules, cfg, { currentPage: f2.activeTab, openTabs: f2.openTabs, recentHistory: f2.history }, now)
      .forEach((r) => console.log(' ', r.score, r.strategy, r.url, '|', r.reason));
  }
})(typeof window !== 'undefined' ? window : globalThis);
