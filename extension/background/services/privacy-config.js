import { DEFAULTS } from '../../shared/constants.js';
import { log } from '../../shared/logger.js';
import { callApi } from './api-client.js';
import { readCache, writeCache } from './cache.js';

// @code C-FE-PRIV-02
function isPrivacyConfig(config) {
  return config !== null && typeof config === 'object' && !Array.isArray(config)
    && typeof config.enablePrivacyFilter === 'boolean'
    && Array.isArray(config.privacySensitiveKeywords)
    && config.privacySensitiveKeywords.every((word) => typeof word === 'string' && word.trim().length > 0);
}

function privacySettings(config, source) {
  return {
    enabled: config.enablePrivacyFilter,
    keywords: [...config.privacySensitiveKeywords],
    source,
  };
}

/**
 * 只读本地配置；缺失或无效时启用内置过滤，不请求后端或改写缓存时间。
 * @returns {Promise<{enabled: boolean, keywords: string[], source: 'cache'|'default'}>} 本地过滤配置及来源。
 */
// @code C-FE-PRIV-02
export async function getCachedPrivacyConfig() {
  try {
    const cached = await readCache('config');
    if (isPrivacyConfig(cached?.data)) return privacySettings(cached.data, 'cache');
  } catch (error) {
    log('privacy.config-cache-read-failed', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
  }
  return { enabled: true, keywords: [...DEFAULTS.PRIVACY_SENSITIVE_KEYWORDS], source: 'default' };
}

/**
 * 依次使用后端、本地缓存和内置配置；断连不能停用发送前的隐私过滤。
 * @returns {Promise<{enabled: boolean, keywords: string[], source: 'server'|'cache'|'default'}>} 过滤配置及来源。
 */
// @code C-FE-PRIV-02
export async function getPrivacyConfig() {
  let response;
  try {
    // 配置按契约使用 CORE 默认预算：5 秒超时，GET 可恢复失败重试一次。
    response = await callApi('GET', '/api/config');
  } catch {
    // 调用异常同样走配置兜底，不转存可能携带 URL 的原始异常。
    log('privacy.config-request-failed', {}, 'warn');
  }
  if (response?.ok === true && isPrivacyConfig(response.data)) {
    try {
      await writeCache('config', response.data);
    } catch (error) {
      // 缓存写入失败不丢弃本次已经取得的有效隐私配置。
      log('privacy.config-cache-write-failed', { code: error?.code || 'STORAGE_FAILED' }, 'warn');
    }
    return privacySettings(response.data, 'server');
  }
  if (response?.ok === true) log('privacy.config-invalid-response', {}, 'warn');
  return getCachedPrivacyConfig();
}
