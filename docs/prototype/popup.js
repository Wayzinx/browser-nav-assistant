/*
 * 浏览器导航助手 · 弹窗原型
 * 每个 .popup-host 都是一个独立实例（自己的状态），数据由 engine.js 实时计算。
 */
(function () {
  'use strict';

  const E = window.NavEngine;
  const { MIN, DAY } = E;

  // ---------------------------------------------------------------- 图标（Lucide 风格线性图标）

  const ICONS = {
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
    archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    merge: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    offline: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M5 12.86a10 10 0 0 1 5.17-2.69"/><path d="M19 12.86a10 10 0 0 0-2-1.52"/><path d="M2 8.82a15 15 0 0 1 4.18-2.64"/><path d="M22 8.82a15 15 0 0 0-11.29-3.76"/><path d="m2 2 20 20"/>',
    activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0l1.58 6.14a2 2 0 0 0 1.44 1.44l6.14 1.58a.5.5 0 0 1 0 .96l-6.14 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    puzzle: '<path d="M15.39 4.39a1 1 0 0 0 1.68-.47 2.5 2.5 0 1 1 3.01 3.01 1 1 0 0 0-.47 1.68l1.68 1.68a2.41 2.41 0 0 1 0 3.42l-1.68 1.68a1 1 0 0 1-1.68-.47 2.5 2.5 0 1 0-3.01 3.01 1 1 0 0 1 .47 1.68l-1.68 1.68a2.41 2.41 0 0 1-3.42 0l-1.68-1.68a1 1 0 0 0-1.68.47 2.5 2.5 0 1 1-3.01-3.01 1 1 0 0 0 .47-1.68l-1.68-1.68a2.41 2.41 0 0 1 0-3.42l1.68-1.68a1 1 0 0 1 1.68.47 2.5 2.5 0 1 0 3.01-3.01 1 1 0 0 1-.47-1.68l1.68-1.68a2.41 2.41 0 0 1 3.42 0z"/>',
    back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    fwd: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    reload: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  };

  function icon(name, size, extra) {
    const s = size || 14;
    return '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (extra || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function shortUrl(url) {
    return String(url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }

  function ago(ts, now) {
    const d = Math.max(0, (now || Date.now()) - ts);
    if (d < MIN) return '刚刚';
    if (d < 60 * MIN) return Math.floor(d / MIN) + ' 分钟前';
    if (d < DAY) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / DAY) + ' 天前';
  }

  function hhmm(ts, sec) {
    const t = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return p(t.getHours()) + ':' + p(t.getMinutes()) + (sec ? ':' + p(t.getSeconds()) : '');
  }

  const FAV = {
    'github.com': ['#24292f', 'G'],
    'developer.mozilla.org': ['#15141a', 'M'],
    'react.dev': ['#087ea4', 'R'],
    'docs.internal.com': ['#3366ff', 'D'],
    'google.com': ['#4285f4', 'G'],
    'accounts.example.com': ['#8a9099', 'A'],
    'bank.example.com': ['#8a9099', 'B'],
  };

  function fav(url, cls) {
    if (!E.isTrackable(url)) return '<span class="fav ' + (cls || '') + '" style="background:#7d8590">' + icon('puzzle', 11, 2.4) + '</span>';
    const d = E.domainOf(url);
    const f = FAV[d] || ['#7d8590', (d[0] || '?').toUpperCase()];
    return '<span class="fav ' + (cls || '') + '" style="background:' + f[0] + '">' + f[1] + '</span>';
  }

  const RULE_TYPES = {
    archive_candidate: { label: '建议归档', cls: 'warn', icon: 'archive' },
    never_archive: { label: '永不归档', cls: 'ok', icon: 'shield' },
    privacy_filter: { label: '隐私过滤', cls: 'bad', icon: 'lock' },
    recommend_related: { label: '关联推荐', cls: 'accent', icon: 'bulb' },
    boost_domain: { label: '排序加权', cls: 'purple', icon: 'star' },
  };

  const RULE_TEXT = {
    issue: '把 7 天没访问过的 GitHub issue 建议归档',
    internal: 'docs.internal.com 的页面永远不要归档',
    react: '如果我连续看了 3 个 React 文档，推荐相关 MDN 页面',
    privacy: '不要上传包含 secret、session 的 URL',
  };

  const EXAMPLES = [
    '把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档',
    '如果我连续看了 3 个 React 文档，推荐相关 MDN 页面',
    '不要上传包含 password、token 的 URL',
    '两周没看的搜索结果页建议归档',
  ];

  const TABS = [['home', '首页'], ['context', '上下文'], ['ranked', '排序'], ['cleanup', '整理'], ['rules', '规则'], ['diag', '诊断']];

  let ruleSeq = 100;

  function savedRules(keys, now) {
    const out = [];
    keys.forEach((k, i) => {
      E.parseRules(RULE_TEXT[k]).rules.forEach((r) => {
        out.push(Object.assign(r, { id: 'rule_' + (out.length + 1), createdAt: now - (keys.length - i) * DAY }));
      });
    });
    return out;
  }

  function sugKey(s) { return s.action + ':' + (s.url || s.urls.join('|')); }

  // ---------------------------------------------------------------- 弹窗组件

  class Popup {
    constructor(host, preset) {
      this.host = host;
      this.preset = preset || {};
      this.onChange = null;
      host.addEventListener('click', (e) => this.handleClick(e));
      host.addEventListener('input', (e) => this.handleInput(e));
      this.reset();
    }

    reset() {
      const p = this.preset;
      const now = Date.now();
      const synced = p.synced !== false;
      const offline = p.backend === 'offline';
      this.s = {
        now,
        scenario: p.scenario || 'pr',
        backend: p.backend || 'online',
        apiBase: 'http://localhost:3000',
        apiDraft: null,
        apiError: null,
        tab: p.tab || 'home',
        synced,
        syncStatus: offline ? 'error' : synced ? 'success' : 'idle',
        lastSync: synced ? { at: now - (offline ? 18 : 2) * MIN } : null,
        lastError: offline ? { at: now - 40000, error: 'net::ERR_CONNECTION_REFUSED' } : null,
        rules: savedRules(p.rules || [], now),
        ruleText: p.ruleText || '',
        parse: null,
        picks: {},
        showJson: false,
        handled: {},
        important: [],
        rankFilter: 'all',
        expanded: null,
        diagAt: now,
        diagRunning: false,
        toast: null,
      };
      if (p.parse) this.parse(true);
      this.render();
      if (p.expandFirst) {
        const first = this.data().ranked[0];
        if (first) { this.s.expanded = first.id; this.render(); }
      }
    }

    set(patch) {
      const wasDown = !this.up();
      Object.assign(this.s, patch);
      this.render();
      // 后端恢复后自动重试上次失败的同步（PRD 10.2 降级策略）
      if (wasDown && this.up() && this.s.syncStatus === 'error') this.sync();
    }

    up() {
      return this.s.backend === 'online' && /^https?:\/\/(localhost|127\.0\.0\.1):3000\/?$/.test(this.s.apiBase);
    }

    // 后端视角的数据：每次渲染都按当前状态重新计算（原型数据量很小）
    data() {
      const s = this.s;
      const cfg = JSON.parse(JSON.stringify(E.DEFAULT_CONFIG));
      s.rules.filter((r) => r.enabled && r.type === 'privacy_filter').forEach((r) => {
        r.keywords.forEach((k) => { if (!cfg.privacySensitiveKeywords.includes(k)) cfg.privacySensitiveKeywords.push(k); });
      });
      const raw = E.buildDemoPayload(s.now, { scenario: s.scenario });
      const f = E.filterForUpload(raw, cfg);
      const out = { cfg, raw, payload: f.payload, filtered: f.filtered, ranked: [], recs: [], cleanup: [], stat: null };
      if (!s.synced) return out;

      const store = E.createStore();
      out.stat = E.ingest(store, f.payload, s.now);
      const rules = s.rules.filter((r) => r.enabled && r.type !== 'privacy_filter');
      out.cleanup = E.cleanupSuggestions(store, rules, cfg, s.now, s.important);
      // 已处理的整理建议：归档 / 合并后从排序和推荐里移除
      out.cleanup.forEach((sug) => {
        const st = s.handled[sugKey(sug)];
        if (st === 'archived') store.pages.get(E.normalizeUrl(sug.url)).isArchived = true;
        if (st === 'merged') sug.urls.filter((u) => u !== sug.keepUrl).forEach((u) => { store.pages.get(E.normalizeUrl(u)).isArchived = true; });
      });
      out.ranked = E.scorePages(store, rules, cfg, s.now, s.important);
      const ctx = { currentPage: f.payload.activeTab, openTabs: f.payload.openTabs, recentHistory: f.payload.history };
      out.recs = E.recommendNext(store, rules, cfg, ctx, s.now, s.important);
      return out;
    }

    toast(text, kind) {
      clearTimeout(this.toastTimer);
      this.s.toast = { text, kind: kind || 'ok' };
      this.render();
      this.toastTimer = setTimeout(() => { this.s.toast = null; this.render(); }, 2600);
    }

    // ------------------------------------------------------------ 交互

    handleInput(e) {
      const f = e.target.getAttribute('data-field');
      if (f === 'ruleText') this.s.ruleText = e.target.value;
      if (f === 'apiDraft') this.s.apiDraft = e.target.value;
    }

    handleClick(e) {
      const el = e.target.closest('[data-action]');
      if (!el || !this.host.contains(el)) return;
      const a = el.getAttribute('data-action');
      const arg = el.getAttribute('data-arg');
      const s = this.s;
      if (a === 'pick') { s.picks[arg] = el.checked; this.render(); return; }
      e.preventDefault();

      switch (a) {
        case 'tab': s.tab = arg; this.render(); break;
        case 'sync': this.sync(); break;
        case 'important': {
          const url = this.data().raw.activeTab.url;
          const i = s.important.indexOf(url);
          if (i >= 0) { s.important.splice(i, 1); this.toast('已取消标记'); }
          else { s.important.push(url); this.toast('已标记为重要 · 不会被建议归档'); }
          break;
        }
        case 'open': this.toast('已在新标签页打开（原型模拟）'); break;
        case 'filter': s.rankFilter = arg; this.render(); break;
        case 'expand': s.expanded = s.expanded === arg ? null : arg; this.render(); break;
        case 'sug': {
          const [op, key] = [arg.split('::')[0], arg.split('::').slice(1).join('::')];
          if (op === 'undo') delete s.handled[key]; else s.handled[key] = op;
          this.toast(op === 'archived' ? '已归档 · 将从排序和推荐中移除' : op === 'merged' ? '已合并重复页面' : op === 'ignored' ? '已忽略该建议' : '已撤销');
          break;
        }
        case 'archive-all':
          this.data().cleanup.filter((x) => x.action === 'archive' && !s.handled[sugKey(x)]).forEach((x) => { s.handled[sugKey(x)] = 'archived'; });
          this.toast('已全部归档');
          break;
        case 'example': s.ruleText = arg; s.parse = null; this.render(); break;
        case 'parse':
          if (!s.ruleText.trim()) { this.toast('先输入一句规则描述', 'bad'); break; }
          s.tab = 'rules';
          this.parse();
          break;
        case 'parse-cancel': s.parse = null; this.render(); break;
        case 'json': s.showJson = !s.showJson; this.render(); break;
        case 'save': this.saveParsed(); break;
        case 'rule-toggle': {
          const r = s.rules.find((x) => x.id === arg);
          r.enabled = !r.enabled;
          this.toast((r.enabled ? '已启用' : '已停用') + '规则 · 排序与整理建议已刷新');
          break;
        }
        case 'rule-del':
          s.rules = s.rules.filter((x) => x.id !== arg);
          this.toast('已删除规则（DELETE /api/rules/' + arg + '）');
          break;
        case 'diag-run':
          s.diagRunning = true; this.render();
          setTimeout(() => { s.diagRunning = false; s.diagAt = Date.now(); this.render(); }, 700);
          break;
        case 'diag-copy':
          try { navigator.clipboard.writeText(JSON.stringify(this.diagChecks(this.data()), null, 2)); } catch (err) { /* 原型里复制失败不影响展示 */ }
          this.toast('已复制诊断报告');
          break;
        case 'api-save': {
          const v = (s.apiDraft == null ? s.apiBase : s.apiDraft).trim();
          if (!/^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(v)) { s.apiError = '请输入以 http:// 或 https:// 开头的地址，例如 http://localhost:3000'; this.render(); break; }
          s.apiBase = v.replace(/\/$/, ''); s.apiDraft = null; s.apiError = null; s.diagAt = Date.now();
          this.toast(this.up() ? '已保存，连接正常' : '已保存，但无法连接该地址', this.up() ? 'ok' : 'bad');
          break;
        }
        case 'api-reset': s.apiBase = 'http://localhost:3000'; s.apiDraft = null; s.apiError = null; this.toast('已恢复默认地址'); break;
        default: break;
      }
    }

    sync() {
      const s = this.s;
      if (s.syncStatus === 'syncing') return;
      s.syncStatus = 'syncing';
      this.render();
      setTimeout(() => {
        if (!this.up()) {
          s.syncStatus = 'error';
          s.lastError = { at: Date.now(), error: 'net::ERR_CONNECTION_REFUSED' };
          this.toast('同步失败：无法连接后端', 'bad');
          return;
        }
        s.synced = true;
        s.syncStatus = 'success';
        s.lastError = null;
        s.lastSync = { at: Date.now() };
        const d = this.data();
        this.toast('同步成功 · 上传 ' + d.stat.received + ' 条 · 过滤 ' + d.filtered.length + ' 条');
      }, 900);
    }

    parse(silent) {
      const s = this.s;
      if (!this.up()) { if (!silent) this.toast('后端未连接，无法解析', 'bad'); return; }
      s.parse = E.parseRules(s.ruleText, E.DEFAULT_CONFIG);
      s.picks = {};
      s.parse.rules.forEach((r, i) => { s.picks[i] = true; });
      s.showJson = false;
      if (!silent) this.render();
    }

    saveParsed() {
      const s = this.s;
      const chosen = s.parse.rules.filter((r, i) => s.picks[i]);
      chosen.forEach((r) => { ruleSeq += 1; s.rules.push(Object.assign({}, r, { id: 'rule_' + ruleSeq, createdAt: Date.now(), enabled: true })); });
      s.parse = null;
      s.ruleText = '';
      this.toast('已保存 ' + chosen.length + ' 条规则 · 整理建议已更新');
    }

    // ------------------------------------------------------------ 渲染

    render() {
      const prevBody = this.host.querySelector('.pp-body');
      const prevTab = this.host.getAttribute('data-tab');
      const keep = prevBody && prevTab === this.s.tab ? prevBody.scrollTop : 0;
      const d = this.data();
      this.d = d;
      const s = this.s;
      this.host.setAttribute('data-tab', s.tab);
      this.host.innerHTML =
        '<div class="pp" role="dialog" aria-label="浏览器导航助手">' +
          this.head() + this.current(d) + this.syncBar(d) + this.tabs(d) +
          '<div class="pp-body">' + this[s.tab](d) + '</div>' +
          (s.toast ? '<div class="toast ' + s.toast.kind + '">' + icon(s.toast.kind === 'bad' ? 'alert' : 'check', 13) + esc(s.toast.text) + '</div>' : '') +
        '</div>';
      const body = this.host.querySelector('.pp-body');
      if (body) body.scrollTop = keep;
      if (this.onChange) this.onChange(s, d);
    }

    head() {
      const up = this.up();
      return '<header class="pp-head">' +
        '<div class="pp-brand"><span class="logo">' + icon('compass', 14, 2.2) + '</span>导航助手</div>' +
        '<button class="pp-conn ' + (up ? 'ok' : 'bad') + '" data-action="tab" data-arg="diag" data-anno="1" title="打开诊断">' +
          '<span class="dot"></span>' + (up ? '后端已连接' : '后端未连接') + '</button>' +
      '</header>';
    }

    current(d) {
      const cur = d.raw.activeTab;
      if (!E.isTrackable(cur.url)) {
        return '<div class="pp-cur sys" data-anno="2">' + fav(cur.url) +
          '<div class="meta"><div class="t">' + esc(cur.title) + '</div><div class="u">' + esc(cur.url) + '</div></div>' +
          '<span class="chip warn">系统页 · 不采集</span></div>';
      }
      const on = this.s.important.includes(cur.url);
      return '<div class="pp-cur" data-anno="2">' + fav(cur.url) +
        '<div class="meta"><div class="t" title="' + esc(cur.title) + '">' + esc(cur.title) + '</div><div class="u">' + esc(shortUrl(cur.url)) + '</div></div>' +
        '<button class="icon-btn ' + (on ? 'on' : '') + '" data-action="important" title="' + (on ? '取消重要标记' : '标记为重要') + '" aria-pressed="' + on + '">' + icon('star', 16) + '</button>' +
      '</div>';
    }

    syncBar(d) {
      const s = this.s;
      let meta;
      if (s.syncStatus === 'syncing') {
        meta = '<span class="spin"></span>正在读取 ' + (d.raw.openTabs.length + 1) + ' 个标签页、' + d.raw.history.length + ' 条历史…';
      } else if (s.syncStatus === 'error') {
        meta = '<span class="dot bad"></span><span>同步失败：无法连接后端' + (s.lastSync ? '，展示 ' + hhmm(s.lastSync.at) + ' 的缓存' : '') + ' · <a data-action="tab" data-arg="diag">诊断</a></span>';
      } else if (s.syncStatus === 'success' && s.lastSync) {
        meta = '<span class="dot ok"></span><span>' + ago(s.lastSync.at) + '同步成功 · 上传 ' + d.stat.received + ' 条 · 过滤 ' + d.filtered.length + ' 条</span>';
      } else {
        meta = '<span class="dot muted"></span>尚未同步，同步后生成排序与推荐';
      }
      const busy = s.syncStatus === 'syncing';
      return '<div class="pp-sync" data-anno="3">' +
        '<button class="btn primary" data-action="sync" ' + (busy ? 'disabled' : '') + '>' + (busy ? '<span class="spin"></span>同步中…' : icon('refresh', 13) + '同步浏览器上下文') + '</button>' +
        '<div class="sync-meta">' + meta + '</div></div>';
    }

    tabs(d) {
      const pending = d.cleanup.filter((x) => x.action !== 'keep' && !this.s.handled[sugKey(x)]).length;
      const bad = this.diagChecks(d).some((c) => c.status === 'fail');
      return '<nav class="pp-tabs" role="tablist" data-anno="4">' + TABS.map(([k, label]) =>
        '<button role="tab" aria-selected="' + (this.s.tab === k) + '" data-action="tab" data-arg="' + k + '">' + label +
          (k === 'cleanup' && pending ? '<span class="cnt">' + pending + '</span>' : '') +
          (k === 'diag' && bad ? '<span class="alert"></span>' : '') +
        '</button>').join('') + '</nav>';
    }

    offlineBanner() {
      if (this.up()) return '';
      const s = this.s;
      return '<div class="banner bad">' + icon('offline', 14) + '<span>后端未连接。' +
        (s.lastSync ? '以下为 <b>' + hhmm(s.lastSync.at) + '</b> 同步时缓存的结果，可能不是最新。' : '暂无缓存数据。') +
        '</span><button class="link" data-action="tab" data-arg="diag">去诊断</button></div>';
    }

    emptySync(text) {
      return '<div class="empty"><b>还没有数据</b>' + (text || '点击上方「同步浏览器上下文」，把当前标签页和最近历史发送到后端') + '</div>';
    }

    // ------------------------------------------------------------ 首页

    home(d) {
      const s = this.s;
      const cur = d.raw.activeTab;
      const sys = !E.isTrackable(cur.url);
      const recs = d.recs.slice(0, 3);
      const counts = { archive: 0, merge: 0, keep: 0 };
      d.cleanup.forEach((x) => { if (!s.handled[sugKey(x)]) counts[x.action] += 1; });
      const checks = this.diagChecks(d);
      const bad = checks.filter((c) => c.status === 'fail' || c.status === 'warn').length;

      return this.offlineBanner() +
        '<section data-anno="5">' +
          '<div class="sec-title">' + icon('bulb', 13) + '下一步推荐<span class="grow"></span><span class="muted">' + (sys ? '系统页 · 展示全局高分' : '基于当前页面') + '</span></div>' +
          (s.synced ? '<div class="recs">' + recs.map((r) => this.recCard(r)).join('') + '</div>' : this.emptySync()) +
        '</section>' +
        '<section data-anno="6">' +
          '<div class="sec-title">' + icon('activity', 13) + '历史排序 Top 5<span class="grow"></span>' + (s.synced ? '<button class="link" data-action="tab" data-arg="ranked">全部 ' + d.ranked.length + ' 条' + icon('chevron', 12) + '</button>' : '') + '</div>' +
          (s.synced ? '<div class="rank-list">' + d.ranked.slice(0, 5).map((p, i) => this.rankRow(p, i, true)).join('') + '</div>' : this.emptySync('同步后按「时效 · 频次 · 打开状态 · 域名」打分排序')) +
        '</section>' +
        '<section data-anno="7">' +
          '<div class="sec-title">' + icon('archive', 13) + '整理建议<span class="grow"></span>' + (s.synced ? '<button class="link" data-action="tab" data-arg="cleanup">去整理' + icon('chevron', 12) + '</button>' : '') + '</div>' +
          (s.synced ? '<div class="stats">' +
            '<button class="stat archive" data-action="tab" data-arg="cleanup"><div class="v">' + counts.archive + '</div><div class="k">' + icon('archive', 11) + '建议归档</div></button>' +
            '<button class="stat merge" data-action="tab" data-arg="cleanup"><div class="v">' + counts.merge + '</div><div class="k">' + icon('merge', 11) + '疑似重复</div></button>' +
            '<button class="stat keep" data-action="tab" data-arg="cleanup"><div class="v">' + counts.keep + '</div><div class="k">' + icon('shield', 11) + '规则保留</div></button>' +
          '</div>' : this.emptySync('同步后识别旧页面与重复页面')) +
        '</section>' +
        '<section data-anno="8" class="rule-box">' +
          '<div class="sec-title" style="margin:0">' + icon('sparkles', 13) + '用一句话配置规则<span class="grow"></span><span class="muted">已保存 ' + s.rules.length + ' 条</span></div>' +
          '<textarea rows="2" data-field="ruleText" placeholder="例如：把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档">' + esc(s.ruleText) + '</textarea>' +
          '<div class="row-end"><span class="grow">支持：N 天未访问 · 域名 · 归档 / 永不归档 / 推荐 / 不上传</span>' +
            '<button class="btn sm primary" data-action="parse" ' + (this.up() ? '' : 'disabled') + '>' + icon('sparkles', 12) + '解析</button></div>' +
        '</section>' +
        '<button class="entry" data-action="tab" data-arg="diag" data-anno="9">' +
          '<span class="sug-ico ' + (bad ? 'archive' : 'keep') + '">' + icon(bad ? 'alert' : 'shield', 13) + '</span>' +
          '<span class="grow"><span class="k">启动诊断</span><br><span class="s">' + (bad ? bad + ' 项需要处理' : checks.length + ' 项检查全部正常') + ' · 权限 / 后端 / 同步 / 规则</span></span>' +
          icon('chevron', 14) +
        '</button>';
    }

    recCard(r) {
      return '<button class="rec" data-action="open" data-arg="' + esc(r.url) + '" title="打开 ' + esc(r.url) + '">' +
        '<div class="rec-top">' + fav(r.url) + '<span class="t">' + esc(r.title) + '</span><span class="score">' + r.score.toFixed(2) + '</span></div>' +
        '<div class="u">' + esc(shortUrl(r.url)) + '</div>' +
        '<div class="why">' + icon('bulb', 12) + '<span>' + esc(r.reason) + '</span></div>' +
      '</button>';
    }

    sbar(p) {
      const c = p.contrib;
      return '<div class="sbar" role="img" aria-label="评分构成">' +
        ['recency', 'frequency', 'open', 'domain'].map((k) => '<i class="c-' + k + '" style="width:' + (c[k] * 100).toFixed(1) + '%"></i>').join('') + '</div>';
    }

    rankRow(p, i, compact) {
      if (compact) {
        return '<button class="rank compact" data-action="tab" data-arg="ranked" title="' + esc(p.reason) + '">' +
          '<span class="no">' + (i + 1) + '</span><span class="t">' + esc(p.title) + '</span>' + this.sbar(p) +
          '<span class="score">' + p.score.toFixed(2) + '</span></button>';
      }
      const open = this.s.expanded === p.id;
      return '<button class="rank ' + (open ? 'open' : '') + '" data-action="expand" data-arg="' + p.id + '" aria-expanded="' + open + '">' +
        '<span class="no">' + (i + 1) + '</span><span class="t">' + esc(p.title) + '</span><span class="score">' + p.score.toFixed(2) + '</span>' +
        '<span class="sub">' + fav(p.url, 'sm') + '<span class="d">' + esc(p.domain) + '</span>· ' + p.visitCount + ' 次 · ' + ago(p.lastVisitedAt, this.s.now) +
          (p.isActive ? ' <span class="chip accent">当前</span>' : p.isOpen ? ' <span class="chip ok">打开中</span>' : '') + '</span>' +
        '<span class="bar">' + this.sbar(p) + '</span>' +
        '<span class="why">' + esc(p.reason) + '</span>' +
        (open ? this.breakdown(p) : '') +
      '</button>';
    }

    breakdown(p) {
      const f = p.factors;
      const w = E.DEFAULT_CONFIG.weights;
      const age = f.ageDays < 1 ? Math.max(1, Math.round(f.ageDays * 24)) + ' 小时' : f.ageDays.toFixed(1) + ' 天';
      const domNote = { important: '你标记为重要 → 1', protect: '受保护域名 → 1', boost: '优先域名规则 → 1', affinity: p.domain + ' 访问量占比' }[f.domainBy];
      const row = (name, v, wt, note, cls) => '<tr><td><i class="c-' + cls + '" style="display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:5px"></i>' + name + '</td>' +
        '<td class="num">' + v.toFixed(2) + ' × ' + wt + '</td><td class="num">' + (v * wt).toFixed(2) + '</td><td class="note">' + note + '</td></tr>';
      return '<span class="breakdown"><table>' +
        row('时效', f.recency, w.recency, '距上次访问 ' + age + '，半衰期 7 天', 'recency') +
        row('频次', f.frequency, w.frequency, '访问 ' + p.visitCount + ' 次，对数归一化', 'frequency') +
        row('打开', f.open, w.open, f.open ? '当前处于打开状态' : '未打开', 'open') +
        row('域名', f.domain, w.domain, domNote, 'domain') +
        '<tr><td>合计</td><td></td><td class="num">' + p.score.toFixed(2) + '</td><td class="note">四舍五入到 2 位</td></tr>' +
      '</table></span>';
    }

    // ------------------------------------------------------------ 上下文

    context(d) {
      const masked = {};
      d.filtered.forEach((f) => { masked[f.url] = f; });
      const tabs = [d.raw.activeTab].concat(d.raw.openTabs);
      const kw = d.cfg.privacySensitiveKeywords;
      return '<section>' +
          '<div class="sec-title">当前窗口标签页<span class="muted">（' + tabs.length + '）chrome.tabs.query</span></div>' +
          '<div class="list">' + tabs.map((t, i) => this.ctxRow(t, masked[t.url], i === 0 ? '<span class="chip accent">当前</span>' : '<span class="chip">已打开</span>')).join('') + '</div>' +
        '</section>' +
        '<section>' +
          '<div class="sec-title">最近浏览历史<span class="muted">（' + d.raw.history.length + ' / 上限 ' + d.cfg.maxHistoryItems + '）chrome.history.search</span></div>' +
          '<div class="list">' + d.raw.history.map((h) => this.ctxRow(h, masked[h.url], ago(h.lastVisitTime, this.s.now) + '<br>' + h.visitCount + ' 次')).join('') + '</div>' +
        '</section>' +
        '<div class="banner info">' + icon('lock', 14) + '<span>隐私过滤已开启：URL 含 <b>' + kw.map(esc).join(' / ') + '</b> 的记录和 chrome:// 等系统页只在本地显示，<b>不会上传</b>到后端。本次过滤 ' + d.filtered.length + ' 条。</span></div>';
    }

    ctxRow(item, mask, side) {
      let tag = side;
      if (mask) tag = mask.reason === 'privacy' ? '<span class="chip bad">' + icon('lock', 10) + '含 ' + esc(mask.keyword) + ' · 不上传</span>' : '<span class="chip warn">系统页 · 跳过</span>';
      return '<div class="li ' + (mask ? 'masked' : '') + '">' + fav(item.url, 'sm') +
        '<div class="meta"><div class="t">' + esc(item.title) + '</div><div class="u">' + esc(shortUrl(item.url)) + '</div></div>' +
        '<div class="side">' + tag + '</div></div>';
    }

    // ------------------------------------------------------------ 排序

    ranked(d) {
      if (!this.s.synced) return this.emptySync();
      const s = this.s;
      const domains = [];
      d.ranked.forEach((p) => { if (!domains.includes(p.domain)) domains.push(p.domain); });
      const list = d.ranked.filter((p) => s.rankFilter === 'all' || (s.rankFilter === 'open' ? p.isOpen : p.domain === s.rankFilter));
      const chip = (k, label) => '<button aria-pressed="' + (s.rankFilter === k) + '" data-action="filter" data-arg="' + esc(k) + '">' + esc(label) + '</button>';
      return this.offlineBanner() +
        '<div class="formula"><div>score = 0.4·时效 + 0.3·频次 + 0.2·打开中 + 0.1·域名</div>' +
          '<div class="legend"><span><i class="c-recency"></i>时效 recency</span><span><i class="c-frequency"></i>频次 frequency</span><span><i class="c-open"></i>打开 isOpen</span><span><i class="c-domain"></i>域名 domain</span></div></div>' +
        '<div class="filters">' + chip('all', '全部 ' + d.ranked.length) + chip('open', '打开中') + domains.slice(0, 3).map((x) => chip(x, x)).join('') + '</div>' +
        '<div class="rank-list">' + list.map((p) => this.rankRow(p, d.ranked.indexOf(p), false)).join('') + '</div>' +
        '<div class="muted" style="font-size:11.5px;text-align:center">点击任一行查看评分明细 · GET /api/pages/ranked</div>';
    }

    // ------------------------------------------------------------ 整理

    cleanup(d) {
      if (!this.s.synced) return this.emptySync();
      const s = this.s;
      const by = (a) => d.cleanup.filter((x) => x.action === a);
      const archive = by('archive');
      const pendingArchive = archive.filter((x) => !s.handled[sugKey(x)]).length;
      const enabled = s.rules.filter((r) => r.enabled && (r.type === 'archive_candidate' || r.type === 'never_archive')).length;
      const group = (title, ico, cls, items, extra) => items.length ? '<section class="group"><div class="sec-title" style="margin:0"><span class="sug-ico ' + cls + '">' + icon(ico, 12) + '</span>' + title + '<span class="muted">（' + items.length + '）</span><span class="grow"></span>' + (extra || '') + '</div>' + items.map((x) => this.sugCard(x)).join('') + '</section>' : '';
      return this.offlineBanner() +
        '<div class="banner info">' + icon('info', 14) + '<span>依据：默认 ' + d.cfg.cleanupThresholdDays + ' 天未访问阈值 + ' + enabled + ' 条整理规则。正在打开的标签页不会被建议归档。</span></div>' +
        (d.cleanup.length ? '' : '<div class="empty"><b>很整洁</b>没有需要整理的页面</div>') +
        group('建议归档', 'archive', 'archive', archive, pendingArchive > 1 ? '<button class="btn sm" data-action="archive-all">全部归档</button>' : '') +
        group('疑似重复', 'merge', 'merge', by('merge')) +
        group('建议保留', 'shield', 'keep', by('keep'));
    }

    sugCard(x) {
      const key = sugKey(x);
      const st = this.s.handled[key];
      const title = x.title || (x.titles && x.titles[0]) || x.url;
      if (st) {
        const label = { archived: '已归档', merged: '已合并', ignored: '已忽略' }[st];
        return '<div class="sug done"><span>' + label + '「' + esc(title) + '」</span><button class="link" data-action="sug" data-arg="undo::' + esc(key) + '">撤销</button></div>';
      }
      const rule = x.ruleId ? this.s.rules.find((r) => r.id === x.ruleId) : null;
      const ruleChip = rule ? ' <span class="chip ' + RULE_TYPES[rule.type].cls + '">' + icon(RULE_TYPES[rule.type].icon, 10) + '规则</span>' : '';
      if (x.action === 'merge') {
        return '<div class="sug"><div class="sug-head"><span class="t">' + esc(title) + '</span><span class="chip purple">' + x.urls.length + ' 个 URL</span></div>' +
          '<div class="urls">' + x.urls.map((u) => '<div>' + (u === x.keepUrl ? '<span class="chip ok">保留</span>' : '<span class="chip">合并</span>') + '<span>' + esc(shortUrl(u)) + '</span></div>').join('') + '</div>' +
          '<div class="why">' + esc(x.reason) + '</div>' +
          '<div class="acts"><button class="btn sm" data-action="sug" data-arg="ignored::' + esc(key) + '">忽略</button><button class="btn sm primary" data-action="sug" data-arg="merged::' + esc(key) + '">合并为 1 条</button></div></div>';
      }
      if (x.action === 'keep') {
        return '<div class="sug"><div class="sug-head">' + fav(x.url, 'sm') + '<span class="t">' + esc(title) + '</span>' + ruleChip + '</div>' +
          '<div class="u">' + esc(shortUrl(x.url)) + '</div><div class="why">' + esc(x.reason) + '</div></div>';
      }
      return '<div class="sug"><div class="sug-head">' + fav(x.url, 'sm') + '<span class="t">' + esc(title) + '</span>' + ruleChip + '</div>' +
        '<div class="u">' + esc(shortUrl(x.url)) + '</div><div class="why">' + esc(x.reason) + '</div>' +
        '<div class="acts"><button class="btn sm" data-action="sug" data-arg="ignored::' + esc(key) + '">忽略</button><button class="btn sm primary" data-action="sug" data-arg="archived::' + esc(key) + '">' + icon('archive', 12) + '归档</button></div></div>';
    }

    // ------------------------------------------------------------ 规则

    rules() {
      const s = this.s;
      const up = this.up();
      return '<section class="card rule-box">' +
          '<div class="sec-title" style="margin:0">' + icon('sparkles', 13) + '用自然语言描述规则</div>' +
          '<textarea rows="3" data-field="ruleText" placeholder="例如：把 7 天没访问过的 GitHub issue 建议归档，但 docs.internal.com 的页面永远不要归档">' + esc(s.ruleText) + '</textarea>' +
          '<div class="examples">' + EXAMPLES.map((t) => '<button data-action="example" data-arg="' + esc(t) + '" title="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>' +
          (up ? '' : '<div class="banner bad">' + icon('offline', 14) + '<span>后端未连接，暂时无法解析新规则；已保存的规则仍在本地缓存中。</span></div>') +
          '<div class="row-end"><span class="grow">POST /api/rules/parse · 关键词规则引擎，不调用 LLM</span><button class="btn sm primary" data-action="parse" ' + (up ? '' : 'disabled') + '>' + icon('sparkles', 12) + '解析</button></div>' +
        '</section>' +
        (s.parse ? this.parsePreview() : '') +
        '<section>' +
          '<div class="sec-title">已保存规则<span class="muted">（' + s.rules.length + '）GET /api/rules</span></div>' +
          (s.rules.length ? '<div class="list">' + s.rules.map((r) => this.savedRule(r)).join('') + '</div>' : '<div class="empty"><b>还没有规则</b>在上方输入一句话，解析确认后保存</div>') +
        '</section>' +
        '<details class="help"><summary>支持哪些说法？</summary><table>' +
          '<tr><td>建议归档</td><td>“7 天没访问的 GitHub issue 建议归档”、“两周没看的搜索结果页清理掉”</td></tr>' +
          '<tr><td>永不归档</td><td>“docs.internal.com 的页面永远不要归档”、“保留飞书文档”</td></tr>' +
          '<tr><td>关联推荐</td><td>“如果我连续看了 3 个 React 文档，推荐相关 MDN 页面”</td></tr>' +
          '<tr><td>隐私过滤</td><td>“不要上传包含 password、token 的 URL”</td></tr>' +
          '<tr><td>排序加权</td><td>“GitHub 的页面优先显示”</td></tr>' +
          '<tr><td>识别要素</td><td>天数（7 天 / 两周 / 1 个月）、域名（显式域名或 GitHub、MDN、React 等别名）、页面类型（issue / PR / actions / 搜索）、动作词与否定词</td></tr>' +
        '</table></details>';
    }

    parsePreview() {
      const s = this.s;
      const p = s.parse;
      const n = p.rules.filter((r, i) => s.picks[i]).length;
      const json = { rules: p.rules.map((r) => { const o = Object.assign({}, r); delete o.notes; delete o.confidence; return o; }), unparsed: p.unparsed, warnings: p.warnings };
      return '<section class="card parse">' +
        '<div class="sec-title">解析结果<span class="muted">识别 ' + p.rules.length + ' 条' + (p.unparsed.length ? ' · 未识别 ' + p.unparsed.length + ' 段' : '') + '</span><span class="grow"></span>' +
          '<button class="link" data-action="json">' + icon('code', 12) + (s.showJson ? '收起 JSON' : '查看 JSON') + '</button></div>' +
        (s.showJson ? '<pre class="json">' + esc(JSON.stringify(json, null, 2)) + '</pre>' : '') +
        p.rules.map((r, i) => this.parsedRule(r, i)).join('') +
        p.unparsed.map((u) => '<div class="unparsed"><b>' + icon('alert', 12) + ' 未能识别：<q>' + esc(u.text) + '</q></b>' + esc(u.reason) + '</div>').join('') +
        p.warnings.map((w) => '<div class="unparsed"><b>' + icon('info', 12) + ' 规则冲突</b>' + esc(w) + '</div>').join('') +
        '<div class="row-end"><button class="btn sm" data-action="parse-cancel">取消</button><button class="btn sm primary" data-action="save" ' + (n ? '' : 'disabled') + '>' + icon('check', 12) + '确认保存 ' + n + ' 条</button></div>' +
      '</section>';
    }

    kvFor(r) {
      const rows = [['type', r.type]];
      if (r.type === 'privacy_filter') rows.push(['keywords', r.keywords.join(', ')]);
      else if (r.type === 'recommend_related') { rows.push(['trigger', r.trigger.domain + ' × 连续 ' + r.trigger.minCount]); rows.push(['target', r.target.domain]); }
      else {
        rows.push(['domain', r.domain || '（全部）']);
        if (r.urlPattern) rows.push(['urlPattern', r.urlPattern]);
        if (r.inactiveDays != null) rows.push(['inactiveDays', r.inactiveDays]);
      }
      rows.push(['action', r.action]);
      return '<dl class="kv">' + rows.map(([k, v]) => '<dt>' + k + '</dt><dd>' + esc(v) + '</dd>').join('') + '</dl>';
    }

    parsedRule(r, i) {
      const t = RULE_TYPES[r.type];
      return '<label class="prule"><input type="checkbox" data-action="pick" data-arg="' + i + '" ' + (this.s.picks[i] ? 'checked' : '') + '>' +
        '<div><div class="h"><span class="badge ' + t.cls + '">' + icon(t.icon, 11) + t.label + '</span>' +
          (r.confidence === 'high' ? '<span class="chip ok">完整识别</span>' : '<span class="chip warn">使用了默认值</span>') + '</div>' +
          this.kvFor(r) +
          '<div class="raw">原文：“' + esc(r.rawText) + '”</div>' +
          r.notes.map((x) => '<div class="note-line">' + icon('info', 12) + esc(x) + '</div>').join('') +
        '</div></label>';
    }

    savedRule(r) {
      const t = RULE_TYPES[r.type];
      return '<div class="srule ' + (r.enabled ? '' : 'off') + '">' +
        '<span class="badge ' + t.cls + '">' + icon(t.icon, 11) + t.label + '</span>' +
        '<div class="main"><div class="d">' + esc(E.describeRule(r)) + '</div><div class="raw">“' + esc(r.rawText) + '”</div></div>' +
        '<button class="switch" role="switch" aria-checked="' + r.enabled + '" aria-label="启用规则" data-action="rule-toggle" data-arg="' + r.id + '"></button>' +
        '<button class="icon-btn" title="删除规则" data-action="rule-del" data-arg="' + r.id + '">' + icon('trash', 14) + '</button>' +
      '</div>';
    }

    // ------------------------------------------------------------ 诊断

    diagChecks(d) {
      const s = this.s;
      const up = this.up();
      const tabs = d.raw.openTabs.length + 1;
      const checks = [
        up
          ? { name: '后端服务连接', status: 'ok', detail: 'GET ' + s.apiBase + '/api/health → 200 · 12 ms · status=ok' }
          : { name: '后端服务连接', status: 'fail', detail: 'GET ' + s.apiBase + '/api/health 失败：net::ERR_CONNECTION_REFUSED（3 s 超时）',
            fix: '① 在项目根目录运行 ./scripts/start.sh 启动后端；② 确认后端端口与下方 API Base URL 一致；③ 确认 manifest.json 的 host_permissions 包含该地址；④ 浏览器访问 ' + s.apiBase + '/api/health 自查' },
        { name: 'API Base URL', status: 'ok', detail: s.apiBase + '（chrome.storage.local · 可在下方修改）' },
        { name: 'tabs 权限', status: 'ok', detail: '已授权 · 可读取当前窗口 ' + tabs + ' 个标签页的 URL 与标题' },
        { name: 'history 权限', status: 'ok', detail: '已授权 · 读取到最近 ' + d.raw.history.length + ' 条历史（上限 ' + d.cfg.maxHistoryItems + '）' },
        { name: 'storage 可用', status: 'ok', detail: '写入 / 读取 / 删除自检通过 · 已用 38 KB' },
        { name: 'activeTab 权限', status: 'ok', detail: '已声明 · 当前页面信息可读取' },
      ];
      if (s.syncStatus === 'error') {
        checks.push({ name: '最近一次同步', status: 'fail', detail: hhmm(s.lastError.at) + ' 同步失败（' + s.lastError.error + '）' + (s.lastSync ? '；上次成功 ' + hhmm(s.lastSync.at) : ''),
          fix: '先修复「后端服务连接」，再点击「同步浏览器上下文」重试' });
      } else if (s.lastSync) {
        checks.push({ name: '最近一次同步', status: 'ok', detail: ago(s.lastSync.at) + '（' + hhmm(s.lastSync.at) + '）· 成功 · 上传 ' + d.stat.received + ' 条 · 过滤 ' + d.filtered.length + ' 条' });
      } else {
        checks.push({ name: '最近一次同步', status: 'warn', detail: '尚未同步，点击「同步浏览器上下文」完成首次同步' });
      }
      checks.push(up
        ? { name: '当前规则数量', status: 'ok', detail: s.rules.length + ' 条（启用 ' + s.rules.filter((r) => r.enabled).length + '）· 插件缓存与后端一致' }
        : { name: '当前规则数量', status: 'warn', detail: '后端不可达，显示本地缓存的 ' + s.rules.length + ' 条' });
      checks.push({ name: '隐私过滤', status: 'ok', detail: '已开启 · ' + d.cfg.privacySensitiveKeywords.length + ' 个关键词 · 本次过滤 ' + d.filtered.length + ' 条' });
      checks.push({ name: '无痕模式', status: 'info', detail: '未允许在无痕模式下运行：无痕窗口的标签页与历史不会被采集' });
      return checks;
    }

    diag(d) {
      const s = this.s;
      const checks = this.diagChecks(d);
      const fail = checks.filter((c) => c.status === 'fail').length;
      const warn = checks.filter((c) => c.status === 'warn').length;
      const okCount = checks.filter((c) => c.status === 'ok').length;
      const infoCount = checks.filter((c) => c.status === 'info').length;
      const okAll = !fail;
      const mark = { ok: 'check', warn: 'alert', fail: 'x', info: 'info' };
      const up = this.up();
      return '<div class="diag-sum ' + (okAll ? 'ok' : 'bad') + '"><span class="big">' + icon(okAll ? 'check' : 'alert', 18, 2.6) + '</span>' +
          '<span class="grow"><span class="k">' + (okAll ? '运行正常' : fail + ' 项异常' + (warn ? '，' + warn + ' 项警告' : '')) + '</span><br>' +
          '<span class="s">' + okCount + ' 项通过' + (infoCount ? ' · ' + infoCount + ' 项提示' : '') + ' · 检测于 ' + hhmm(s.diagAt, true) + '</span></span>' +
          '<button class="btn sm" data-action="diag-run" ' + (s.diagRunning ? 'disabled' : '') + '>' + (s.diagRunning ? '<span class="spin"></span>检测中' : icon('reload', 12) + '重新检测') + '</button>' +
        '</div>' +
        '<ul class="checks">' + checks.map((c) =>
          '<li class="' + c.status + '"><span class="st ' + c.status + '">' + icon(mark[c.status], 10, 3) + '</span>' +
            '<div><div class="n">' + esc(c.name) + '</div><div class="d">' + esc(c.detail) + '</div>' + (c.fix ? '<div class="fix">' + esc(c.fix) + '</div>' : '') + '</div></li>').join('') +
        '</ul>' +
        '<section class="card"><div class="sec-title" style="margin-bottom:6px">API Base URL</div>' +
          '<input type="text" data-field="apiDraft" value="' + esc(s.apiDraft == null ? s.apiBase : s.apiDraft) + '" spellcheck="false" aria-label="API Base URL">' +
          (s.apiError ? '<div class="field-err">' + esc(s.apiError) + '</div>' : '') +
          '<div class="row-end" style="margin-top:8px"><button class="btn sm" data-action="api-reset">恢复默认</button><button class="btn sm primary" data-action="api-save">保存并检测</button></div>' +
        '</section>' +
        '<div class="meta-grid">' +
          '<div><span>插件版本</span><b>0.1.0 · MV3</b></div>' +
          '<div><span>后端版本</span><b>' + (up ? '1.0.0' : '—') + '</b></div>' +
          '<div><span>后端运行</span><b>' + (up ? '1h 02m' : '—') + '</b></div>' +
          '<div><span>pageCount</span><b>' + (up && s.synced ? d.ranked.length : '—') + '</b></div>' +
          '<div><span>ruleCount</span><b>' + (up ? s.rules.length : '—') + '</b></div>' +
          '<div><span>阈值</span><b>' + d.cfg.cleanupThresholdDays + ' 天</b></div>' +
        '</div>' +
        '<div class="row-end"><button class="btn sm" data-action="diag-copy">' + icon('copy', 12) + '复制诊断报告</button></div>';
    }
  }

  // ---------------------------------------------------------------- 右键菜单静态画面

  function contextMenuFrame() {
    return '<div class="ctx-demo">' +
      '<div class="mock"><div class="crumb">developer.mozilla.org › Web › API</div><h4>Fetch API</h4>' +
        '<div class="bar" style="width:92%"></div><div class="bar" style="width:76%"></div><div class="bar" style="width:84%"></div>' +
        '<div class="box"><code>fetch(url, options)</code><div class="bar" style="width:60%"></div></div></div>' +
      '<div class="ctx-menu">' +
        '<div class="it">返回<span class="k">⌘[</span></div><div class="it dim">前进<span class="k">⌘]</span></div><div class="it">重新加载<span class="k">⌘R</span></div>' +
        '<div class="sep"></div><div class="it">存储为…<span class="k">⌘S</span></div><div class="it">打印…<span class="k">⌘P</span></div>' +
        '<div class="sep"></div><div class="it hl"><span class="logo" style="width:16px;height:16px;border-radius:4px">' + icon('compass', 11, 2.4) + '</span>浏览器导航助手<span class="k">' + icon('chevron', 12) + '</span></div>' +
        '<div class="sep"></div><div class="it">检查</div>' +
      '</div>' +
      '<div class="ctx-sub">' +
        '<div class="it hl">' + icon('plus', 13) + '添加到分析</div>' +
        '<div class="it">' + icon('star', 13) + '标记为重要</div>' +
      '</div>' +
      '<div class="ctx-toast"><b>添加到分析</b>：立即把当前页面作为 source=manual 上传（仍经过隐私过滤）。<br><b>标记为重要</b>：写入 importantUrls，排序 domainBoost 记满分且永不建议归档。<br>对应权限：<code>contextMenus</code></div>' +
    '</div>';
  }

  window.NavPrototype = { Popup, contextMenuFrame, icon, esc, shortUrl, fav };
})();
