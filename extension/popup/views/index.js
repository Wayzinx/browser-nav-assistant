import { mount as connection } from './connection.js';
import { mount as currentPage } from './current-page.js';
import { mount as importantStar } from './important-star.js';
import { mount as sync } from './sync.js';
import { mount as syncMode } from './sync-mode.js';
import { mount as offlineBanner } from './offline-banner.js';
import { mount as recommend } from './recommend.js';
import { mount as rankedHome } from './ranked-home.js';
import { mount as cleanupHome } from './cleanup-home.js';
import { mount as ruleHome } from './rule-home.js';
import { mount as diagHome } from './diag-home.js';
import { mount as context } from './context.js';
import { mount as ranked } from './ranked.js';
import { mount as cleanup } from './cleanup.js';
import { mount as ruleParse } from './rule-parse.js';
import { mount as ruleList } from './rule-list.js';
import { mount as diagApiBase } from './diag-api-base.js';
import { mount as diagnostics } from './diagnostics.js';

// @code C-FE-CORE-06
/** 按 docs/04 §11.2 冻结顺序排列的插槽及视图挂载函数。 */
export const VIEWS = Object.freeze([
  { slot: 'connection', mount: connection },
  { slot: 'current-page', mount: currentPage },
  { slot: 'current-page-actions', mount: importantStar },
  { slot: 'sync', mount: sync },
  { slot: 'sync-mode', mount: syncMode },
  { slot: 'offline-banner-home', mount: offlineBanner },
  { slot: 'recommend', mount: recommend },
  { slot: 'ranked-home', mount: rankedHome },
  { slot: 'cleanup-home', mount: cleanupHome },
  { slot: 'rule-home', mount: ruleHome },
  { slot: 'diag-home', mount: diagHome },
  { slot: 'context', mount: context },
  { slot: 'offline-banner-ranked', mount: offlineBanner },
  { slot: 'ranked', mount: ranked },
  { slot: 'offline-banner-cleanup', mount: offlineBanner },
  { slot: 'cleanup', mount: cleanup },
  { slot: 'rule-parse', mount: ruleParse },
  { slot: 'rule-list', mount: ruleList },
  { slot: 'diag-api-base', mount: diagApiBase },
  { slot: 'diagnostics', mount: diagnostics },
].map((view) => Object.freeze(view)));
