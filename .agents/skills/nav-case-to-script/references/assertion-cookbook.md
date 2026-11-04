# 断言速查

## 1. 规则

1. 用例 `expected` 第 n 条至少对应一个断言，断言消息以 `[En]` 开头。一条 expected 包含多个事实时，拆成多个断言，每个都带 `[En]`。
2. 断言**具体值**，而不是「存在」：能写 `toBe(8)` 就不写 `toBeTruthy()`。
3. 每个断言只表达一个事实，这样失败消息就能说明到底哪里不对。
4. 先断言状态码，再断言响应体；先断言长度，再取元素（否则会变成 CONTRACT 类的 TypeError，而不是清楚的断言失败）。

## 2. expected 句式 → 匹配器

| 用例 expected 的写法 | 断言 |
|---|---|
| 返回 200 / 201 / 400 | `expect(r.status, '[E1] …').toBe(200)` |
| 错误码为 VALIDATION_FAILED | `expect(r.body.error.code, '[E2] …').toBe('VALIDATION_FAILED')` |
| 返回 10 条 | `expect(r.body.pages, '[E1] …').toHaveLength(10)` |
| 包含某几个字段和值 | `expect(obj, '[E1] …').toMatchObject({ type: 'never_archive', domain: 'docs.internal.com' })` |
| 完全等于 | `expect(obj).toEqual({...})`（响应字段只增不减，一般优先用 toMatchObject） |
| 按 score 降序 | `expect(scores, '[E2] …').toEqual([...scores].sort((a, b) => b - a))` |
| 首条是 X | `expect(list[0].url, '[E1] …').toBe(X)` |
| 包含 / 不包含 X | `expect(urls).toContain(X)` / `expect(urls).not.toContain(X)` |
| 包含这些（顺序不限） | `expect(urls).toEqual(expect.arrayContaining([A, B]))` |
| 集合完全相同（顺序不限） | `expect([...a].sort()).toEqual([...b].sort())` |
| 取值范围 [0, 1] | `toBeGreaterThanOrEqual(0)` + `toBeLessThanOrEqual(1)` |
| 浮点数约等于 | `expect(score).toBeCloseTo(0.91, 2)` |
| 理由非空 | `expect(reason).toMatch(/\S/)`（不要用 `toBeTruthy`，空格串也会通过） |
| 理由提到 7 天规则 | `expect(reason).toMatch(/7\s*天/)` |
| 时间戳等于平移后的值 | `expect(page.lastVisitedAt).toBe(shiftedTime(url, now))` |
| 每一项都满足 | `for (const p of pages) expect(p.reason, \`[E3] ${p.url} …\`).toMatch(/\S/)` |
| 没有副作用 | 再查一次：`expect((await api.get('/api/health')).body.ruleCount).toBe(0)` |
| UI 显示文本 | `await expect(page.getByTestId('sync-status'), '[E2] …').toContainText('同步成功')` |
| UI 数量 | `await expect(page.getByTestId('rec-item'), '[E1] …').toHaveCount(3)` |
| UI 不显示 | `await expect(page.getByTestId('offline-badge')).toBeHidden()` |
| 后端最终状态 | `await expect.poll(fn, { message: '[E4] …' }).toBe(2)` |

## 3. 强弱对照（lint L15 / L21，以及变异检查会发现的问题）

| 弱（能被变异杀不死） | 强 |
|---|---|
| `expect(r.ok).toBeTruthy()` | `expect(r.status).toBe(200)` |
| `expect(r.body.pages.length).toBeGreaterThan(0)` | `expect(r.body.pages).toHaveLength(10)` |
| `expect(issue).toBeTruthy()` | `expect(issue).toMatchObject({ url: ISSUE, visitCount: 8 })` |
| `expect(rec.reason).toBeDefined()` | `expect(rec.reason).toMatch(/PR|CI/)` |
| `expect(r.body.error).toBeDefined()` | `expect(r.body.error.code).toBe('INVALID_JSON')` |
| 只断言状态码 | 状态码 + 关键字段 + 副作用 |
| `if (list.length) expect(list[0]…)` | `expect(list).toHaveLength(n)`，然后再断言 `list[0]` |

## 4. 变异算子与对应的断言

| 存活的算子 | 说明缺了什么断言 | 补强方式 |
|---|---|---|
| status | 没有检查状态码 | `expect(r.status).toBe(…)` |
| drop-item | 没有检查数量或具体元素 | `toHaveLength`、断言具体元素 |
| reverse | 没有检查顺序 | 断言排序或首条；如果本用例确实不关心顺序，就写 `// mutation-ignore: reverse —— 理由` |
| num-shift | 没有检查具体数值或范围 | `toBe(8)`、范围断言、`toBeCloseTo` |
| str-blank | 没有检查文本或标识 | `toBe('github.com')`、`toMatch(/\S/)` |
| drop-key | 没有检查字段存在 | `toMatchObject({ … })`、`toHaveProperty('x')` |
