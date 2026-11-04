#!/usr/bin/env node
// 提交打包门禁（P0-3）：把开发状态整理成满足平台限制的提交包，并在解包后复核证据和链接。
//
// 平台限制：上传根目录（项目的上一级「题目_1_浏览器导航助手/」）中、.gitignore 之外的文件，最多 200 个，
// 单个不超过 1MB，总计不超过 10MB。源码和主要文档原样提交，其余目录压成 tar.gz 分卷（bundles/）。
//
// 用法（在项目根目录执行）：
//   node .workflow/tools/pack-submission.mjs                      # dry run：在临时目录生成 staging 并自检，不改项目
//   node .workflow/tools/pack-submission.mjs --out=<dir> --json   # 指定 staging 目录；--json 只输出机器可读结果
//   node .workflow/tools/pack-submission.mjs --check-upload       # 额外检查 vc 自动上传日志
//   node .workflow/tools/pack-submission.mjs --apply --backup=<上传根目录之外的目录> [--yes]
//                                                                 # 把项目替换成 staging 的形态（先完整备份；没有 --yes 只打印计划）
// 输出（--json）：{ pass, errors[], warnings[], usage, manifestPath, stagingDir, level, evidence, links, smoke, freeze, upload }
// 退出码：0 = 通过；1 = 未通过；2 = 参数或环境错误；3 = apply 只打印了计划（缺少 --yes）
//
// 降级阶梯（只在超出预算时逐级启用，每一级的改动都记录在 bundles/MANIFEST.json 的 levelsApplied / dropped 中，绝不静默删除）：
//   L1 截图按内容去重；PNG 转半尺寸 JPEG（质量 60），同步改写 result.json / explore.json / 文档中的引用（默认必做，--min-level=L0 可关闭）
//   L2 证据瘦身：api/*.json 只保留关键响应头，setup 调用的请求 / 响应体只留摘要；extension.log 只留首尾和 warn / error 行
//   L3 原型截图转 JPEG；只保留验收流程、冒烟、人工验收的 flow.gif，其余用例的 gif 删除（截图仍在）
//   L4 每个 UI 用例只保留首张和末张截图（失败用例与验收 / 冒烟 / 人工验收目录不裁剪）
//   L5 截图重新编码为 0.35 倍尺寸、质量 45
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`)); if (!a) return d; return a.includes('=') ? a.slice(k.length + 3) : true; };
const ROOT = path.resolve(opt('root') || path.resolve(HERE, '../..'));
const JSON_OUT = Boolean(opt('json'));
const requireFromRoot = createRequire(path.join(ROOT, 'package.json'));

const log = (...m) => { if (!JSON_OUT) console.log(...m); };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const posix = (p) => p.split(path.sep).join('/');
const mkTmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const fmtMB = (b) => `${(b / 1048576).toFixed(2)}MB`;

// ---------------------------------------------------------------- 配置

const DEFAULTS = {
  uploadRoot: '..', ignoreFile: '../../.gitignore',
  budget: { maxFiles: 200, maxFileBytes: 1048576, maxTotalBytes: 10485760, partBytes: 972800, reserveFiles: 4, reserveBytes: 262144 },
  raw: [], bundles: [], exclude: [], neverUpload: [],
  evidence: { imageGlobs: ['evidence/**/*.png'], jpegQuality: 60, jpegScale: 0.5, keepGifFor: ['ACCEPTANCE-FLOW', '_smoke', '_manual'], neverTrimDirs: ['ACCEPTANCE-FLOW', '_smoke', '_manual'], slimHeaders: ['content-type', 'x-request-id'], extensionLogKeep: { head: 100, tail: 100, levels: ['error', 'warning', 'warn'] } },
};
const cfgFile = readJson(path.join(ROOT, '.workflow', 'submission.json')) || {};
const CFG = { ...DEFAULTS, ...cfgFile, budget: { ...DEFAULTS.budget, ...(cfgFile.budget || {}) }, evidence: { ...DEFAULTS.evidence, ...(cfgFile.evidence || {}) } };
const UPLOAD_ROOT = path.resolve(ROOT, CFG.uploadRoot);
const PROJECT_REL = posix(path.relative(UPLOAD_ROOT, ROOT));

// ---------------------------------------------------------------- glob 与遍历

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*' && glob[i + 1] === '*') { re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*'; i += glob[i + 2] === '/' ? 2 : 1; }
    else if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
const matchAny = (rel, globs) => globs.some((g) => globToRe(g).test(rel));
const underPath = (rel, p) => rel === p || rel.startsWith(`${p}/`);

/** 列出目录下的全部条目（不跟随软链接；软链接作为单独条目返回） */
function walk(base, rel = '', out = [], skipDirs = new Set(['node_modules', '.git'])) {
  const abs = path.join(base, rel);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isSymbolicLink()) { if (!skipDirs.has(e.name)) out.push({ rel: r, type: 'symlink' }); }
    else if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(base, r, out, skipDirs); }
    else if (e.isFile()) out.push({ rel: r, type: 'file' });
  }
  return out;
}

/** .gitignore 的简化解析（vc 上传按它排除文件）：支持「目录/」「文件」「*」 */
function loadIgnore() {
  const f = path.resolve(ROOT, CFG.ignoreFile);
  const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')) : [];
  const res = lines.map((l) => {
    const dir = l.endsWith('/');
    const body = l.replace(/\/$/, '');
    const anchored = body.includes('/');
    const g = globToRe(body).source.slice(1, -1);
    return new RegExp(`${anchored ? '^' : '(?:^|/)'}${g}${dir ? '/' : '(?:$|/)'}`);
  });
  return (relFromWorkspace) => res.some((re) => re.test(relFromWorkspace));
}

// ---------------------------------------------------------------- 分类

function classify() {
  const raw = []; const bundleFiles = new Map(CFG.bundles.map((b) => [b.name, []]));
  const excluded = new Map(); const unclassified = [];
  const neverUpload = (CFG.neverUpload || []).map((n) => (typeof n === 'string' ? { path: n, reason: '配置为不上传' } : n));
  const note = (key, reason) => { const k = `${key}|${reason}`; excluded.set(k, { path: key, reason, files: (excluded.get(k)?.files || 0) + 1 }); };
  for (const { rel, type } of walk(ROOT)) {
    if (matchAny(rel, CFG.exclude)) { note(rel.split('/').slice(0, 2).join('/'), '排除（运行产物 / 缓存 / 旧提交包）'); continue; }
    if (matchAny(rel, CFG.raw)) { raw.push({ rel, type }); continue; }
    const b = CFG.bundles.find((x) => x.paths.some((p) => underPath(rel, p)));
    if (b) { bundleFiles.get(b.name).push({ rel, type }); continue; }
    const n = neverUpload.find((x) => matchAny(rel, [x.path]));
    if (n) { note(n.path, n.reason); continue; }
    unclassified.push(rel);
  }
  return { raw, bundleFiles, excluded: [...excluded.values()], unclassified };
}

function copyEntry(fromBase, toBase, { rel, type }) {
  const src = path.join(fromBase, rel); const dst = path.join(toBase, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (type === 'symlink') { try { fs.rmSync(dst, { force: true }); } catch { /* 不存在 */ } fs.symlinkSync(fs.readlinkSync(src), dst); }
  else fs.copyFileSync(src, dst);
}

// ---------------------------------------------------------------- 图片处理

let PNG, jpeg;
function loadImageLibs() {
  if (PNG) return;
  try { ({ PNG } = requireFromRoot('pngjs')); jpeg = requireFromRoot('jpeg-js'); }
  catch (e) { throw new Error(`缺少图片依赖：npm i -D pngjs jpeg-js（${e.message}）`); }
}

/** 面积平均缩放 + 白底合成透明通道，输出 JPEG */
function pngToJpeg(buf, scale, quality) {
  loadImageLibs();
  const img = PNG.sync.read(buf);
  const w = Math.max(1, Math.round(img.width * scale)); const h = Math.max(1, Math.round(img.height * scale));
  const out = Buffer.alloc(w * h * 4);
  const sx = img.width / w; const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1 && yy < img.height; yy++) {
        for (let xx = x0; xx < x1 && xx < img.width; xx++) {
          const i = (yy * img.width + xx) * 4; const a = img.data[i + 3] / 255;
          r += img.data[i] * a + 255 * (1 - a); g += img.data[i + 1] * a + 255 * (1 - a); b += img.data[i + 2] * a + 255 * (1 - a); n++;
        }
      }
      const o = (y * w + x) * 4; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return jpeg.encode({ data: out, width: w, height: h }, quality).data;
}

// ---------------------------------------------------------------- 引用改写

/**
 * 根据 mapping（旧相对路径 → 新相对路径，null 表示已删除）改写准备目录里的文本引用。
 * JSON 文件按值改写（数组中指向已删除图片的项会被移除，并记录到 packaging.droppedRefs）；其他文本文件按字符串替换。
 */
function rewriteRefs(baseDir, files, mapping, { globRewrite = false } = {}) {
  if (!mapping.size && !globRewrite) return 0;
  const names = new Set([...mapping.keys()].map((k) => path.posix.basename(k)));
  let changed = 0;
  for (const rel of files) {
    if (!/\.(json|md|html?|js|css|txt)$/i.test(rel)) continue;
    const abs = path.join(baseDir, rel);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    if (![...names].some((n) => text.includes(n) || text.includes(encodeURI(n))) && !(globRewrite && /evidence\/[^\s`'")]*\*\.png/.test(text))) continue;
    const dir = path.posix.dirname(rel);
    const forms = (p) => { const r = path.posix.relative(dir, p); return [...new Set([p, r, `./${r}`, encodeURI(p), encodeURI(r)])]; };
    let next;
    if (rel.endsWith('.json')) {
      let data; try { data = JSON.parse(text); } catch { data = null; }
      if (data !== null) {
        const lookup = new Map();
        for (const [oldP, newP] of mapping) { const nf = newP ? forms(newP) : null; forms(oldP).forEach((f, i) => lookup.set(f, nf ? nf[Math.min(i, nf.length - 1)] : null)); }
        const dropped = [];
        const visit = (v) => {
          if (Array.isArray(v)) return v.flatMap((x) => { if (typeof x === 'string' && lookup.has(x)) { const n = lookup.get(x); if (n === null) { dropped.push(x); return []; } return [n]; } return [visit(x)]; });
          if (v && typeof v === 'object') { for (const k of Object.keys(v)) { const x = v[k]; if (typeof x === 'string' && lookup.has(x)) { if (lookup.get(x) !== null) v[k] = lookup.get(x); else dropped.push(x); } else v[k] = visit(x); } return v; }
          return v;
        };
        const res = visit(data);
        if (dropped.length && res && typeof res === 'object' && !Array.isArray(res)) res.packaging = { ...(res.packaging || {}), droppedRefs: [...new Set([...(res.packaging?.droppedRefs || []), ...dropped])], note: '提交包按预算裁剪了这些截图，原图见完整开发环境，裁剪记录见 bundles/MANIFEST.json' };
        next = JSON.stringify(res, null, text.includes('\n  ') ? 2 : 0);
      }
    }
    if (next === undefined) {
      next = text;
      if (globRewrite) next = next.replace(/((?:^|[`'"(\s])(?:\.\.\/)*evidence\/[^\s`'")]*?)\*\.png/g, '$1*.jpg');
      for (const [oldP, newP] of mapping) {
        if (!newP) continue;
        const of = forms(oldP); const nf = forms(newP);
        of.forEach((f, i) => { if (next.includes(f)) next = next.split(f).join(nf[Math.min(i, nf.length - 1)]); });
      }
    }
    if (next !== text) { fs.writeFileSync(abs, next); changed++; }
  }
  return changed;
}

// ---------------------------------------------------------------- 证据处理（各级）

function listFiles(base, prefix = '') { return walk(base).map((e) => e.rel).filter((r) => !prefix || underPath(r, prefix)); }
const caseDirOf = (rel) => { const m = /^evidence\/([^/]+)\//.exec(rel); return m ? m[1] : null; };

function levelImages(state, { scale, quality, includePrototype, reencode }) {
  const { prep } = state;
  const globs = CFG.evidence.imageGlobs.filter((g) => includePrototype || !g.startsWith('docs/prototype'));
  const all = listFiles(prep).filter((r) => matchAny(r, globs) || (reencode && state.jpegSource.has(r)));
  const mapping = new Map();
  const seen = new Map(); // 目录分组 + hash → 保留的路径
  for (const rel of all) {
    if (reencode && state.jpegSource.has(rel)) { // L5：从原始 PNG 重新编码
      const src = state.jpegSource.get(rel);
      const before = fs.statSync(path.join(prep, rel)).size;
      const buf = pngToJpeg(fs.readFileSync(path.join(ROOT, src)), scale, quality);
      fs.writeFileSync(path.join(prep, rel), buf);
      state.stats.reencoded = (state.stats.reencoded || 0) + 1; state.stats.reencodeSaved = (state.stats.reencodeSaved || 0) + before - buf.length;
      continue;
    }
    if (!rel.endsWith('.png')) continue;
    const abs = path.join(prep, rel); const buf = fs.readFileSync(abs);
    const group = caseDirOf(rel) || path.posix.dirname(rel);
    const key = `${group}|${sha256(buf)}`;
    state.stats.imagesOriginal = (state.stats.imagesOriginal || 0) + 1; state.stats.imagesOriginalBytes = (state.stats.imagesOriginalBytes || 0) + buf.length;
    if (seen.has(key)) {
      fs.rmSync(abs); mapping.set(rel, seen.get(key));
      state.stats.deduped = (state.stats.deduped || 0) + 1;
      state.dropped.push({ path: rel, reason: `与 ${seen.get(key)} 内容完全相同，去重`, level: state.level });
      continue;
    }
    const outRel = rel.replace(/\.png$/i, '.jpg');
    const jpg = pngToJpeg(buf, scale, quality);
    fs.writeFileSync(path.join(prep, outRel), jpg); fs.rmSync(abs);
    mapping.set(rel, outRel); seen.set(key, outRel); state.jpegSource.set(outRel, rel);
    state.stats.converted = (state.stats.converted || 0) + 1; state.stats.convertedBytes = (state.stats.convertedBytes || 0) + jpg.length;
  }
  for (const [o, n] of mapping) state.globalMap.set(o, n);
  return mapping;
}

function levelSlim(state) {
  const { prep } = state;
  const keepH = new Set(CFG.evidence.slimHeaders.map((h) => h.toLowerCase()));
  let apiFiles = 0, apiBefore = 0, apiAfter = 0, logFiles = 0, logDroppedLines = 0;
  for (const rel of listFiles(prep, 'evidence')) {
    const abs = path.join(prep, rel);
    if (/\/api\/[^/]+\.json$/.test(rel)) {
      const text = fs.readFileSync(abs, 'utf8'); const j = (() => { try { return JSON.parse(text); } catch { return null; } })();
      if (!j || typeof j !== 'object') continue;
      for (const k of ['requestHeaders', 'responseHeaders']) if (j[k] && typeof j[k] === 'object') j[k] = Object.fromEntries(Object.entries(j[k]).filter(([h]) => keepH.has(h.toLowerCase())));
      if (j.setup) for (const k of ['requestBody', 'responseBody']) { const v = j[k]; if (v && typeof v === 'object') j[k] = { packagingSummary: true, bytes: JSON.stringify(v).length, keys: Object.keys(v).slice(0, 20) }; }
      const out = JSON.stringify(j);
      apiFiles++; apiBefore += text.length; apiAfter += out.length; fs.writeFileSync(abs, out);
    } else if (/(^|\/)extension\.log$/.test(rel)) {
      const lines = fs.readFileSync(abs, 'utf8').split('\n');
      const { head, tail, levels } = CFG.evidence.extensionLogKeep;
      if (lines.length <= head + tail) continue;
      const lv = new RegExp(`"(?:type|level)"\\s*:\\s*"(?:${levels.join('|')})"`);
      const kept = lines.filter((l, i) => i < head || i >= lines.length - tail || lv.test(l));
      kept.splice(head, 0, JSON.stringify({ packaging: `中间 ${lines.length - kept.length} 行 info 日志按预算省略（L2），完整日志见开发环境` }));
      logFiles++; logDroppedLines += lines.length - kept.length + 1; fs.writeFileSync(abs, kept.join('\n'));
    }
  }
  state.slim.push({ kind: 'api-json', files: apiFiles, bytesBefore: apiBefore, bytesAfter: apiAfter, detail: `请求 / 响应头只保留 ${[...keepH].join('、')}；setup 调用的请求 / 响应体只保留摘要；去掉缩进`, level: state.level });
  state.slim.push({ kind: 'extension-log', files: logFiles, droppedLines: logDroppedLines, detail: `保留首 ${CFG.evidence.extensionLogKeep.head} 行、末 ${CFG.evidence.extensionLogKeep.tail} 行与 warn / error 行`, level: state.level });
}

function levelGifs(state) {
  const keep = CFG.evidence.keepGifFor;
  for (const rel of listFiles(state.prep, 'evidence').filter((r) => r.endsWith('.gif'))) {
    const dir = caseDirOf(rel);
    if (keep.includes(dir)) continue;
    fs.rmSync(path.join(state.prep, rel));
    state.globalMap.set(rel, null);
    state.dropped.push({ path: rel, reason: '非验收 / 冒烟 / 人工验收的 flow.gif，按预算删除（同目录截图仍保留）', level: state.level });
  }
}

function levelTrim(state) {
  const { prep } = state;
  const byDir = new Map();
  for (const rel of listFiles(prep, 'evidence').filter((r) => /\.(jpe?g|png)$/i.test(r))) {
    const c = caseDirOf(rel); if (!c || CFG.evidence.neverTrimDirs.includes(c)) continue;
    const d = path.posix.dirname(rel); if (!byDir.has(d)) byDir.set(d, []); byDir.get(d).push(rel);
  }
  for (const [d, files] of byDir) {
    const c = caseDirOf(files[0]);
    const result = readJson(path.join(prep, 'evidence', c, 'result.json'));
    if (result && result.status && result.status !== 'passed') continue; // 失败用例保留全部截图
    const sorted = files.sort();
    if (sorted.length <= 2) continue;
    for (const rel of sorted.slice(1, -1)) {
      fs.rmSync(path.join(prep, rel)); state.globalMap.set(rel, null); state.jpegSource.delete(rel);
      state.dropped.push({ path: rel, reason: `${d} 只保留首张和末张截图（L4 预算裁剪）`, level: state.level });
    }
  }
}

// ---------------------------------------------------------------- 打包

function tarFlags() {
  const v = spawnSync('tar', ['--version'], { encoding: 'utf8' }).stdout || '';
  return /bsdtar/.test(v) ? ['--no-mac-metadata', '--no-xattrs'] : [];
}

function buildBundles(state, stagingBundles) {
  fs.rmSync(stagingBundles, { recursive: true, force: true });
  fs.mkdirSync(stagingBundles, { recursive: true });
  const out = [];
  for (const b of CFG.bundles) {
    const present = b.paths.filter((p) => fs.existsSync(path.join(state.prep, p)));
    if (!present.length) continue;
    const r = spawnSync('tar', ['-czf', '-', ...tarFlags(), '-C', state.prep, ...present], { maxBuffer: 1 << 30, env: { ...process.env, COPYFILE_DISABLE: '1' } });
    if (r.status !== 0) throw new Error(`tar 打包 ${b.name} 失败：${String(r.stderr).slice(0, 400)}`);
    const buf = r.stdout; const parts = [];
    if (buf.length <= CFG.budget.partBytes) {
      fs.writeFileSync(path.join(stagingBundles, `${b.name}.tar.gz`), buf);
      parts.push({ file: `bundles/${b.name}.tar.gz`, bytes: buf.length, sha256: sha256(buf) });
    } else {
      for (let i = 0, k = 0; i < buf.length; i += CFG.budget.partBytes, k++) {
        const suffix = String.fromCharCode(97 + Math.floor(k / 26)) + String.fromCharCode(97 + (k % 26));
        const chunk = buf.subarray(i, i + CFG.budget.partBytes);
        fs.writeFileSync(path.join(stagingBundles, `${b.name}.tar.gz.part-${suffix}`), chunk);
        parts.push({ file: `bundles/${b.name}.tar.gz.part-${suffix}`, bytes: chunk.length, sha256: sha256(chunk) });
      }
    }
    const src = listFiles(state.prep).filter((r) => present.some((p) => underPath(r, p)));
    out.push({ name: b.name, desc: b.desc || '', paths: present, sha256: sha256(buf), bytes: buf.length, parts, sourceFiles: src.length, sourceBytes: src.reduce((s, r) => s + fs.lstatSync(path.join(state.prep, r)).size, 0) });
  }
  return out;
}

function uploadExtras(ignored) {
  // 上传根目录中、项目目录以外、未被 .gitignore 排除的文件（例如 .vibecoding/problem.json）
  const wsRel = posix(path.relative(path.resolve(ROOT, path.dirname(CFG.ignoreFile)), UPLOAD_ROOT));
  return walk(UPLOAD_ROOT).filter((e) => !underPath(e.rel, PROJECT_REL)).filter((e) => !ignored(`${wsRel ? `${wsRel}/` : ''}${e.rel}`))
    .map((e) => ({ path: e.rel, bytes: fs.lstatSync(path.join(UPLOAD_ROOT, e.rel)).size }));
}

function measure(staging, extras) {
  const files = walk(staging).map((e) => ({ path: e.rel, bytes: fs.lstatSync(path.join(staging, e.rel)).size }));
  const raw = files.filter((f) => !f.path.startsWith('bundles/'));
  const bun = files.filter((f) => f.path.startsWith('bundles/'));
  const sum = (a) => a.reduce((s, f) => s + f.bytes, 0);
  const all = [...files, ...extras];
  return {
    files: all.length, totalBytes: sum(all), maxFileBytes: Math.max(0, ...all.map((f) => f.bytes)),
    largest: [...all].sort((a, b) => b.bytes - a.bytes).slice(0, 6),
    raw: { files: raw.length, bytes: sum(raw) }, bundles: { files: bun.length, bytes: sum(bun) }, extra: { files: extras.length, bytes: sum(extras), paths: extras.map((e) => e.path) },
    list: files,
  };
}

function budgetErrors(u, withReserve) {
  const b = CFG.budget; const errs = [];
  const maxFiles = b.maxFiles - (withReserve ? b.reserveFiles : 0);
  const maxTotal = b.maxTotalBytes - (withReserve ? b.reserveBytes : 0);
  if (u.files > maxFiles) errs.push(`文件数 ${u.files} 超过上限 ${maxFiles}${withReserve ? `（含预留 ${b.reserveFiles}）` : ''}`);
  if (u.totalBytes > maxTotal) errs.push(`总大小 ${fmtMB(u.totalBytes)} 超过上限 ${fmtMB(maxTotal)}${withReserve ? `（含预留 ${fmtMB(b.reserveBytes)}）` : ''}`);
  for (const f of u.largest.filter((x) => x.bytes > b.maxFileBytes)) errs.push(`单个文件 ${f.path} 为 ${fmtMB(f.bytes)}，超过 ${fmtMB(b.maxFileBytes)}`);
  return errs;
}

// ---------------------------------------------------------------- 自检

function codeDigest(base) {
  const files = {};
  for (const d of ['extension', 'server', 'scripts', 'resources']) for (const e of walk(base, d)) if (e.type === 'file') files[e.rel] = sha256(fs.readFileSync(path.join(base, e.rel)));
  const sorted = Object.fromEntries(Object.keys(files).sort().map((k) => [k, files[k]]));
  return { digest: sha256(JSON.stringify(sorted)), files: sorted };
}

const REPO_PATH_RE = /`((?:evidence|docs|tests|specs|extension|server|scripts|resources|coverage|bundles|\.workflow|\.agents)\/[^`\s]*)`/g;

/** 仓库相对路径（可含 * 通配）在 base 下是否存在 */
function repoPathExists(base, p) {
  const clean = p.replace(/[)，。；、]+$/, '');
  if (!clean.includes('*')) return fs.existsSync(path.join(base, clean.replace(/\/$/, '')));
  const re = globToRe(clean.replace(/\/$/, ''));
  const fixed = clean.split('*')[0].replace(/[^/]*$/, '');
  return walk(base, fixed.replace(/\/$/, '')).some((e) => re.test(e.rel));
}

function checkLinks(base, docs) {
  const broken = []; let checked = 0;
  for (const doc of docs) {
    const abs = path.join(base, doc); if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const m of text.matchAll(REPO_PATH_RE)) {
      const p = m[1];
      if (/[<>{}]/.test(p)) continue; // 占位符写法（例如 server-<port>.log），不是实际路径
      const excludedByConfig = matchAny(p.replace(/\/$/, ''), CFG.exclude) || (CFG.neverUpload || []).some((n) => matchAny(p.replace(/\/$/, ''), [typeof n === 'string' ? n : n.path]));
      if (excludedByConfig) continue; // 按配置本来就不随提交包提供（例如 coverage 的 HTML、运行期日志）
      checked++;
      // 证据引用（evidence/ 下）必须可解析；其他代码格式里提到的路径只做提示
      if (!repoPathExists(base, p)) broken.push({ file: doc, link: p, kind: p.startsWith('evidence/') ? 'evidence-ref' : 'code-path', severity: p.startsWith('evidence/') ? 'error' : 'warning' });
    }
    const links = [...text.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g), ...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
    for (const link of links) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue;
      checked++;
      let target = link.split('#')[0].split('?')[0];
      try { target = decodeURIComponent(target); } catch { /* 保留原样 */ }
      if (!target) continue;
      if (!fs.existsSync(path.resolve(path.dirname(abs), target))) broken.push({ file: doc, link, kind: 'markdown-link', severity: 'error' });
    }
  }
  return { checked, broken };
}

const runCasesModule = () => import(pathToFileURL(path.resolve(HERE, '../../.agents/skills/nav-case-to-script/scripts/run-cases.mjs')).href);

async function selfCheck(staging, errors, warnings) {
  const verify = mkTmp('nav-pack-verify-');
  fs.cpSync(staging, verify, { recursive: true, verbatimSymlinks: true });
  const unpack = spawnSync('sh', ['scripts/unpack-bundles.sh'], { cwd: verify, encoding: 'utf8' });
  if (unpack.status !== 0) errors.push(`解包自检失败：${(unpack.stderr || unpack.stdout).slice(0, 600)}`);
  // 证据完整率：以 cases-*.json 中登记的全部用例为分母（没有证据目录的用例也算不完整）
  const rc = await runCasesModule();
  const index = rc.buildEvidenceIndex(verify, { packaged: true });
  const cases = rc.inventory ? rc.inventory({ root: verify }).cases.map((c) => c.id) : Object.keys(index);
  const incomplete = cases.filter((id) => !index[id] || !index[id].complete).map((id) => ({ caseId: id, missing: index[id] ? index[id].missing : ['没有证据目录'] }));
  const evidence = { total: cases.length, complete: cases.length - incomplete.length, packaged: true, stateCovered: Object.values(index).filter((r) => r.stateCovered).length, incomplete: incomplete.slice(0, 50), incompleteCount: incomplete.length };
  if (incomplete.length) errors.push(`提交包证据不完整：${evidence.complete}/${evidence.total}，例如 ${incomplete.slice(0, 3).map((x) => `${x.caseId}（${x.missing.join('；')}）`).join('，')}`);
  if (evidence.total && evidence.stateCovered < evidence.total) warnings.push(`后端状态快照覆盖 ${evidence.stateCovered}/${evidence.total}`);
  const links = checkLinks(verify, ['docs/08-测试报告.md', 'README.md']);
  const hard = links.broken.filter((b) => b.severity === 'error'); const soft = links.broken.filter((b) => b.severity !== 'error');
  if (hard.length) errors.push(`文档中有 ${hard.length} 个链接 / 证据引用在提交包中无法解析，例如 ${hard.slice(0, 4).map((b) => `${b.file} → ${b.link}`).join('，')}`);
  if (soft.length) warnings.push(`文档中提到的 ${soft.length} 个路径在提交包中不存在（只是提及，不是链接），例如 ${soft.slice(0, 3).map((b) => b.link).join('、')}`);
  const smokeSummary = readJson(path.join(verify, 'evidence', '_smoke', 'summary.json'));
  const smoke = smokeSummary ? { present: true, pass: smokeSummary.pass === true } : { present: false };
  if (smokeSummary && !smoke.pass) errors.push('evidence/_smoke/summary.json 显示真实安装冒烟未通过');
  if (!smokeSummary) warnings.push('提交包中没有真实安装冒烟证据（evidence/_smoke/summary.json）');
  const freezeRec = readJson(path.join(ROOT, '.workflow', 'reports', 'freeze.json'));
  let freeze = { present: false };
  if (freezeRec) {
    const cur = codeDigest(staging);
    let mismatched = [];
    if (freezeRec.files && typeof freezeRec.files === 'object') {
      const keys = new Set([...Object.keys(freezeRec.files), ...Object.keys(cur.files)]);
      mismatched = [...keys].filter((k) => freezeRec.files[k] !== cur.files[k]);
    } else if (freezeRec.digest !== cur.digest) mismatched = ['(只有 digest，无法逐文件比对)'];
    freeze = { present: true, match: mismatched.length === 0, recordedAt: freezeRec.recordedAt || null, mismatched: mismatched.slice(0, 30) };
    if (!freeze.match) errors.push(`提交包中的代码与终检冻结记录不一致（${mismatched.length} 个文件，例如 ${mismatched.slice(0, 3).join('、')}）：终检后代码被修改，需要重跑门禁和冒烟`);
  } else warnings.push('没有代码冻结记录（.workflow/reports/freeze.json），无法确认提交的代码就是终检通过的版本');
  fs.rmSync(verify, { recursive: true, force: true });
  return { evidence, links, smoke, freeze };
}

function checkUpload() {
  const wsRoot = path.resolve(ROOT, path.dirname(CFG.ignoreFile));
  const problem = PROJECT_REL.split('/')[0] || path.basename(UPLOAD_ROOT);
  const res = { checked: true, ok: true, lastLines: [], logs: [] };
  for (const name of ['auto-upload.log', 'watch.stdout.log']) {
    const f = path.join(wsRoot, '.vibecoding', name);
    if (!fs.existsSync(f)) continue;
    res.logs.push(posix(path.relative(ROOT, f)));
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).filter((l) => l.includes(problem) || /upload|上传/.test(l)).slice(-8);
    res.lastLines.push(...lines.map((l) => `[${name}] ${l}`));
  }
  if (!res.logs.length) { res.checked = false; res.ok = true; res.note = '没有找到 .vibecoding 上传日志'; return res; }
  const last = res.lastLines.filter((l) => /\[auto-upload\.log\]/.test(l)).slice(-3).concat(res.lastLines.filter((l) => /\[watch\.stdout\.log\]/.test(l)).slice(-2));
  const bad = last.filter((l) => /失败|error|文件过多/i.test(l));
  if (bad.length) { res.ok = false; res.problems = bad; }
  return res;
}

// ---------------------------------------------------------------- 主流程

async function pack() {
  const errors = []; const warnings = [];
  const cls = classify();
  if (cls.unclassified.length) warnings.push(`有 ${cls.unclassified.length} 个文件没有被配置覆盖，不会进入提交包：${[...new Set(cls.unclassified.map((r) => r.split('/').slice(0, 2).join('/')))].slice(0, 10).join('、')}（如需提交请修改 .workflow/submission.json）`);
  const staging = path.resolve(opt('out') || mkTmp('nav-submission-'));
  // staging 不能位于上传根目录之内（否则会被 vc 一起上传），当然也不能在项目目录里
  const relOut = path.relative(UPLOAD_ROOT, staging);
  if (!relOut.startsWith('..') && !path.isAbsolute(relOut)) throw new Error(`--out 不能位于上传根目录 ${UPLOAD_ROOT} 之内`);
  fs.rmSync(staging, { recursive: true, force: true }); fs.mkdirSync(staging, { recursive: true });
  for (const e of cls.raw) copyEntry(ROOT, staging, e);
  const prep = mkTmp('nav-pack-prep-');
  for (const files of cls.bundleFiles.values()) for (const e of files) copyEntry(ROOT, prep, e);

  const state = { prep, level: 0, dropped: [], slim: [], stats: {}, globalMap: new Map(), jpegSource: new Map(), levelsApplied: [] };
  const textTargets = () => [...listFiles(prep).map((r) => ({ base: prep, rel: r })), ...['docs/08-测试报告.md', 'README.md'].map((r) => ({ base: staging, rel: r }))];
  const applyRefs = (mapping) => {
    const t = textTargets(); const globRewrite = (state.stats.converted || 0) > 0;
    rewriteRefs(prep, t.filter((x) => x.base === prep).map((x) => x.rel), mapping, { globRewrite });
    rewriteRefs(staging, t.filter((x) => x.base === staging).map((x) => x.rel), mapping, { globRewrite });
  };
  const extras = uploadExtras(loadIgnore());
  const LEVELS = [
    { id: 'L0', desc: '原样打包（只排除运行产物与不上传的目录）', run: () => {} },
    { id: 'L1', desc: '截图去重 + PNG 转半尺寸 JPEG（质量 60）', run: () => applyRefs(levelImages(state, { scale: CFG.evidence.jpegScale, quality: CFG.evidence.jpegQuality, includePrototype: false })) },
    { id: 'L2', desc: '证据瘦身：api/*.json 精简请求 / 响应头与 setup 调用体，extension.log 只留首尾与 warn / error', run: () => levelSlim(state) },
    { id: 'L3', desc: '原型截图转 JPEG；只保留验收 / 冒烟 / 人工验收的 flow.gif', run: () => { applyRefs(levelImages(state, { scale: CFG.evidence.jpegScale, quality: CFG.evidence.jpegQuality, includePrototype: true })); levelGifs(state); applyRefs(state.globalMap); } },
    { id: 'L4', desc: '每个通过的 UI 用例只保留首张和末张截图', run: () => { levelTrim(state); applyRefs(state.globalMap); } },
    { id: 'L5', desc: '截图重新编码为 0.35 倍尺寸、质量 45', run: () => levelImages(state, { scale: 0.35, quality: 45, includePrototype: true, reencode: true }) },
  ];
  let bundles = []; let usage = null;
  const minLevel = Math.max(0, LEVELS.findIndex((l) => l.id === String(opt('min-level', 'L1'))));
  for (const [li, L] of LEVELS.entries()) {
    state.level = L.id;
    if (L.id !== 'L0') state.levelsApplied.push({ level: L.id, desc: L.desc });
    L.run();
    // 压缩包里的 evidence/index.json 按提交包口径重建，评审者解包后看到的就是真实状态
    if (fs.existsSync(path.join(prep, 'evidence')) && fs.existsSync(path.join(prep, 'docs', 'trace'))) (await runCasesModule()).buildEvidenceIndex(prep, { packaged: true });
    bundles = buildBundles(state, path.join(staging, 'bundles'));
    fs.writeFileSync(path.join(staging, 'bundles', 'README.md'), 'placeholder');
    fs.writeFileSync(path.join(staging, 'bundles', 'MANIFEST.json'), '{}');
    usage = measure(staging, extras);
    const over = budgetErrors({ ...usage, totalBytes: usage.totalBytes + 64 * 1024 }, true); // 预估 MANIFEST / README 的体积
    log(`${L.id}：${usage.files} 个文件，${fmtMB(usage.totalBytes)}${over.length ? `，超出预算：${over.join('；')}` : '，满足预算'}`);
    if (!over.length && li >= minLevel) break;
  }

  const manifest = {
    generatedAt: new Date().toISOString(), project: PROJECT_REL, uploadRoot: posix(path.relative(ROOT, UPLOAD_ROOT)) || '.',
    budget: CFG.budget, level: state.level, levelsApplied: state.levelsApplied,
    images: { original: { count: state.stats.imagesOriginal || 0, bytes: state.stats.imagesOriginalBytes || 0 }, deduped: state.stats.deduped || 0, converted: { count: state.stats.converted || 0, bytesAfter: state.stats.convertedBytes || 0 }, reencoded: state.stats.reencoded || 0 },
    slimmed: state.slim, dropped: state.dropped,
    excluded: cls.excluded, unclassified: [...new Set(cls.unclassified.map((r) => r.split('/').slice(0, 2).join('/')))],
    bundles: bundles.map(({ name, desc, paths, sha256: s, bytes, parts, sourceFiles, sourceBytes }) => ({ name, desc, paths, sha256: s, bytes, parts, sourceFiles, sourceBytes })),
  };
  const writeDocs = (extra = {}) => {
    const m = { ...manifest, ...extra };
    fs.writeFileSync(path.join(staging, 'bundles', 'MANIFEST.json'), JSON.stringify(m, null, 1));
    fs.writeFileSync(path.join(staging, 'bundles', 'README.md'), bundlesReadme(m));
  };
  writeDocs();
  const checks = await selfCheck(staging, errors, warnings);
  usage = measure(staging, extras);
  const { list, ...usageOut } = usage;
  writeDocs({ usage: usageOut, files: list.filter((f) => f.path !== 'bundles/MANIFEST.json').map((f) => ({ ...f, sha256: sha256(fs.readFileSync(path.join(staging, f.path))) })), ...checks });
  usage = measure(staging, extras);
  const { list: _l, ...usageFinal } = usage;
  errors.unshift(...budgetErrors(usage, false));
  const upload = opt('check-upload') ? checkUpload() : { checked: false };
  if (upload.checked && !upload.ok) errors.push(`vc 自动上传日志显示最近的上传失败：${upload.problems.join(' | ').slice(0, 600)}`);
  fs.rmSync(prep, { recursive: true, force: true });
  return { pass: errors.length === 0, errors, warnings, usage: usageFinal, manifestPath: path.join(staging, 'bundles', 'MANIFEST.json'), stagingDir: staging, level: state.level, levelsApplied: state.levelsApplied, images: manifest.images, droppedCount: state.dropped.length, ...checks, upload };
}

function bundlesReadme(m) {
  const rows = (m.bundles || []).map((b) => `| ${b.parts.map((p) => `\`${path.posix.basename(p.file)}\``).join('<br>')} | ${b.desc} | ${b.sourceFiles} 个文件 / ${fmtMB(b.sourceBytes)} → ${fmtMB(b.bytes)} |`).join('\n');
  const u = m.usage;
  return `# 提交包说明（自动生成，请勿手改）

平台上传限制：最多 ${m.budget.maxFiles} 个文件、单个文件不超过 ${fmtMB(m.budget.maxFileBytes)}、总计不超过 ${fmtMB(m.budget.maxTotalBytes)}。源码（\`extension/\`、\`server/\`、\`scripts/\`、\`resources/\`）和主要文档（\`docs/01\`–\`08\`、README 等）原样提交，下列目录以压缩包提交。执行 \`sh scripts/unpack-bundles.sh\` 可以一键还原（会校验 MANIFEST 中的 sha256）。

| 压缩包 | 内容 | 原始 → 压缩后 |
|---|---|---|
${rows}

${u ? `**预算占用**：${u.files} 个文件、${fmtMB(u.totalBytes)}（其中原样提交 ${u.raw.files} 个 / ${fmtMB(u.raw.bytes)}，压缩包 ${u.bundles.files} 个 / ${fmtMB(u.bundles.bytes)}，上传根目录其他文件 ${u.extra.files} 个）。` : ''}

**降级记录**：${m.levelsApplied.length ? m.levelsApplied.map((l) => `${l.level} ${l.desc}`).join('；') : '无（原样打包）'}。截图 ${m.images.original.count} 张，去重 ${m.images.deduped} 张，转 JPEG ${m.images.converted.count} 张；被裁剪的条目共 ${m.dropped.length} 个，逐条列在 \`bundles/MANIFEST.json\` 的 \`dropped\` 中。

${m.evidence ? `**证据完整率（按提交包解包后重算）**：${m.evidence.complete}/${m.evidence.total}；后端状态快照覆盖 ${m.evidence.stateCovered}/${m.evidence.total}。` : ''}
${m.smoke ? `**真实安装冒烟**：${m.smoke.present ? (m.smoke.pass ? '通过' : '未通过') : '没有证据'}。` : ''}
${m.freeze ? `**代码冻结**：${m.freeze.present ? (m.freeze.match ? '提交的代码与终检冻结记录一致' : '与终检冻结记录不一致') : '没有冻结记录'}。` : ''}

不上传的内容：${(m.excluded || []).map((e) => `\`${e.path}\`（${e.reason}）`).slice(0, 12).join('、')}。
`;
}

// ---------------------------------------------------------------- apply

async function apply(result) {
  const backup = opt('backup');
  if (!backup || backup === true) { console.error('--apply 需要 --backup=<目录>（必须位于上传根目录之外）'); process.exit(2); }
  const backupAbs = path.resolve(backup);
  if (!path.relative(UPLOAD_ROOT, backupAbs).startsWith('..')) { console.error(`--backup 不能位于上传根目录 ${UPLOAD_ROOT} 之内`); process.exit(2); }
  if (!result.pass) { console.error('提交包自检未通过，拒绝 apply：\n' + result.errors.join('\n')); process.exit(1); }
  const cls = classify();
  const removeTop = [...new Set([...CFG.bundles.flatMap((b) => b.paths), ...cls.excluded.map((e) => e.path.split('/')[0].replace(/\*.*$/, '')), 'bundles'])]
    .filter((p) => p && !['tests/explore', 'node_modules'].includes(p) && fs.existsSync(path.join(ROOT, p)));
  const plan = [
    `1. 完整备份开发状态：${ROOT} → ${backupAbs}（不含 node_modules）`,
    `2. 从项目中删除（已在备份中）：${removeTop.join('、')}`,
    `3. 复制 staging 的 bundles/ 与原样提交文件到项目（docs/08、README 中的截图链接已按提交包改写）：${result.stagingDir}`,
    '4. 重新统计上传根目录的文件数与大小',
    '注意：先停掉正在运行的后端。后端的持久化目录 data/ 可能包含真实浏览记录，apply 会把它移出项目；之后再启动后端前，请把持久化目录指向上传根目录之外，否则下次上传会带上它。',
    `恢复开发状态：rsync -a ${backupAbs}/ ${ROOT}/，或在项目中执行 sh scripts/unpack-bundles.sh（只能恢复压缩包中的内容）`,
  ];
  console.log(`apply 计划：\n${plan.join('\n')}`);
  if (!opt('yes')) { console.log('\n未执行。确认无误后加 --yes 再运行。'); process.exit(3); }
  fs.mkdirSync(backupAbs, { recursive: true });
  const r = spawnSync('rsync', ['-a', '--exclude', 'node_modules', `${ROOT}/`, `${backupAbs}/`], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(`备份失败：${r.stderr}`); process.exit(1); }
  for (const p of removeTop) fs.rmSync(path.join(ROOT, p), { recursive: true, force: true });
  for (const e of walk(result.stagingDir)) copyEntry(result.stagingDir, ROOT, e);
  const after = measure(ROOT, uploadExtras(loadIgnore()));
  console.log(`apply 完成：上传根目录 ${after.files} 个文件、${fmtMB(after.totalBytes)}；${budgetErrors(after, false).join('；') || '满足预算'}`);
}

// ---------------------------------------------------------------- 入口

try {
  const result = await pack();
  if (opt('apply')) await apply(result);
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`\n${result.pass ? '✔ 提交包自检通过' : '✖ 提交包自检未通过'}（级别 ${result.level}）`);
    console.log(`预算：${result.usage.files}/${CFG.budget.maxFiles} 个文件，${fmtMB(result.usage.totalBytes)}/${fmtMB(CFG.budget.maxTotalBytes)}，最大单文件 ${fmtMB(result.usage.maxFileBytes)}`);
    console.log(`证据完整率（提交包口径）：${result.evidence.complete}/${result.evidence.total}；状态快照 ${result.evidence.stateCovered}/${result.evidence.total}；无法解析的链接 / 证据引用 ${result.links.broken.filter((b) => b.severity === 'error').length}`);
    for (const e of result.errors) console.log(`  ✖ ${e}`);
    for (const w of result.warnings) console.log(`  ⚠ ${w}`);
    console.log(`staging：${result.stagingDir}\nMANIFEST：${result.manifestPath}`);
  }
  process.exit(result.pass ? 0 : 1);
} catch (e) {
  if (JSON_OUT) console.log(JSON.stringify({ pass: false, errors: [`打包脚本异常：${e.message}`], warnings: [], usage: null, manifestPath: null, stagingDir: null }));
  else console.error(e.stack || e.message);
  process.exit(2);
}
