import { splitClauses } from './rule-clauses.js';
import { extractCount, extractDays, extractDomains, extractKeywords, extractPageType } from './rule-lexicon.js';
import { buildUnparsed, detectConflicts } from './rule-diagnose.js';
import { ACTION_BY_TYPE } from './rule-schema.js';

// @code C-BE-RULE-03
// 默认值是自然语言解析契约，不随整理建议的可配置阈值改变。
const DEFAULT_INACTIVE_DAYS = 14;
const DEFAULT_RECOMMENDATION_COUNT = 3;
const RECOMMEND_ACTION = /推荐|建议\s*(?:看|打开|访问)/u;
const EXPLICIT_DURATION = /[\d零〇一二两三四五六七八九十百千万几半.+-]+\s*(?:个\s*)?(?:天|日|周|星期|月)/u;

/** @param {string} text 子句原文 @returns {string|null} 五类规则之一；隐私、推荐、否定先于肯定归档判定。 */
export function classifyClause(text) {
  if (/(?:不要|别|不|禁止)\s*(?:上传|同步|采集|记录)|隐私过滤|屏蔽/u.test(text)) return 'privacy_filter';
  if (RECOMMEND_ACTION.test(text)) return 'recommend_related';
  if (/(?:不要|别|不需要|不|禁止|无需|不用|不可|不能)\s*(?:再|自动|建议|随意|轻易)?\s*(?:归档|关闭|清理|删(?:除)?)|保留|保护|白名单/u.test(text)) return 'never_archive';
  if (/归档|清理|关闭|收起/u.test(text)) return 'archive_candidate';
  if (/优先|置顶|重要|加权|提升/u.test(text)) return 'boost_domain';
  return null;
}

function unsupportedReason(text) {
  if (/(?:上|本|下|这)(?:个)?(?:周|星期|月|季度|年)|昨天|前天|今天|明天|昨日|今日|自从|以来/u.test(text)) {
    return '暂不支持相对日期，请明确写出未访问的天数';
  }
  if (/或|\bor\b/iu.test(text)) return '暂不支持“或”条件，请拆成独立规则';
  if (/正则|\bregex(?:p)?\b|(?:^|[：:\s])\/[^/\r\n]+\/[dgimsuvy]*(?=\s|$|[，,；;。])/iu.test(text)) {
    return '暂不支持正则表达式，请使用域名或页面类型';
  }
  if (/标题|正文|\b(?:title|body)\s*(?:contains|matches|=)/iu.test(text)) return '暂不支持基于标题或正文的条件，请使用域名或页面类型';
  return null;
}

function addScope(rule, text) {
  const domains = extractDomains(text);
  rule.domain = domains[0]?.domain ?? null;
  if (domains.length > 1) rule.notes.push('识别到多个域名，仅使用第一个域名，请拆句配置');
}

function parseRecommendation(rule, text, defaults) {
  const action = RECOMMEND_ACTION.exec(text);
  const triggers = extractDomains(text.slice(0, action.index));
  const targets = extractDomains(text.slice(action.index + action[0].length));
  if (!triggers.length || !targets.length) return '推荐规则需要“触发站点”和“推荐站点”两个对象';
  const count = extractCount(text);
  if (count !== null && (count < 1 || count > 20)) return '推荐次数必须是 1–20 的正整数';
  if (count === null && /(?:连续|一连)\s*(?:看|访问|浏览|打开)\s*(?:了\s*)?[\d零〇一二两三四五六七八九十百千万几半.+-]+/u.test(text)) {
    return '推荐次数必须是明确的正整数';
  }
  const minCount = count ?? defaults.minCount ?? DEFAULT_RECOMMENDATION_COUNT;
  rule.trigger = { domain: triggers[0].domain, minCount, label: triggers[0].label };
  rule.target = { domain: targets[0].domain, label: targets[0].label };
  if (count === null) {
    rule.confidence = 'medium';
    rule.notes.push(`未指定次数，使用默认 ${minCount} 次`);
  }
  if (triggers.length > 1 || targets.length > 1) rule.notes.push('识别到多个域名，仅使用首个触发站点和首个推荐站点，请拆句配置');
  return null;
}

function fillRule(rule, text, defaults) {
  if (rule.type === 'privacy_filter') {
    rule.keywords = extractKeywords(text);
    if (!rule.keywords.length) return '识别到“不上传”，但没找到要过滤的关键词';
    return rule.keywords.length > 20 ? '隐私规则最多支持 20 个关键词，请拆句配置' : null;
  }
  if (rule.type === 'recommend_related') return parseRecommendation(rule, text, defaults);
  addScope(rule, text);
  if (rule.type === 'boost_domain') return rule.domain ? null : '识别到“优先”，但没找到作用的域名';
  rule.urlPattern = extractPageType(text);
  if (rule.type === 'never_archive') {
    return rule.domain || rule.urlPattern ? null : '识别到“不要归档”，但没找到作用的域名或页面类型';
  }
  const days = extractDays(text);
  if ((days === null && EXPLICIT_DURATION.test(text)) || (days !== null && (days < 1 || days > 3650))) {
    return '归档天数必须是 1–3650 的明确正整数';
  }
  rule.inactiveDays = days ?? defaults.inactiveDays ?? DEFAULT_INACTIVE_DAYS;
  if (days === null) {
    rule.confidence = 'medium';
    rule.notes.push(`未指定天数，使用默认 ${rule.inactiveDays} 天`);
  }
  if (!rule.domain && !rule.urlPattern) rule.notes.push('未指定域名或页面类型，将作用于全部页面');
  return null;
}

/**
 * @param {string} text 已校验的自然语言文本
 * @param {{defaults?:{inactiveDays?:number,minCount?:number},savedRules?:object[]}} [options] 默认值与已保存规则快照
 * @returns {{rules:object[],unparsed:object[],warnings:string[]}} 连续预览 ID 的完整 DTO；不读取时间或仓储，不消耗正式 ID
 */
export function parseRuleText(text, { defaults = {}, savedRules = [] } = {}) {
  const rules = [];
  const unparsed = [];
  for (const rawText of splitClauses(text)) {
    const unsupported = unsupportedReason(rawText);
    const type = classifyClause(rawText);
    if (unsupported || !type) {
      unparsed.push(buildUnparsed(rawText, unsupported ?? undefined));
      continue;
    }
    const rule = {
      id: `rule_${rules.length + 1}`, rawText, type,
      domain: null, urlPattern: null, inactiveDays: null,
      action: ACTION_BY_TYPE[type], enabled: true, confidence: 'high', notes: [],
    };
    const reason = fillRule(rule, rawText, defaults);
    if (reason) unparsed.push(buildUnparsed(rawText, reason));
    else rules.push(rule);
  }
  return { rules, unparsed, warnings: detectConflicts(rules, savedRules) };
}
