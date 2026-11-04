import { handlers as context } from './context.js';
import { handlers as sync } from './sync.js';
import { handlers as ranked } from './ranked.js';
import { handlers as recommend } from './recommend.js';
import { handlers as openUrl } from './open-url.js';
import { handlers as cleanup } from './cleanup.js';
import { handlers as cleanupActions } from './cleanup-actions.js';
import { handlers as rules } from './rules.js';
import { handlers as diagnostics } from './diagnostics.js';
import { handlers as apiBase } from './api-base.js';
import { handlers as recovery } from './recovery.js';
import { handlers as important } from './important.js';

// @code C-FE-CORE-02
// 无原型表避免把 constructor 等继承属性误当成已登记消息。
export const handlers = Object.freeze(Object.assign(Object.create(null),
  context, sync, ranked, recommend, openUrl, cleanup, cleanupActions,
  rules, diagnostics, apiBase, recovery, important,
));
