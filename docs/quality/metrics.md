> 本区块由 `collect-metrics.mjs` 自动生成（2026-11-03T00:06:33.965Z），请勿手改。指标口径见 `.agents/skills/nav-quality-report/references/metrics.md`。

### 准出结论：**准出**

| 编号 | 类型 | 指标 | 阈值 | 实际 | 达标 |
|---|---|---|---|---|---|
| H1 | 硬性 | P0 Feature 验证率 | = 100% | 100.0%（57/57） | ✅ |
| H2 | 硬性 | mandatory 需求点覆盖率 | = 100% | 100.0%（96/96） | ✅ |
| H3 | 硬性 | P0 用例通过率 | = 100% | 100.0%（106/106） | ✅ |
| H4 | 硬性 | 整体用例通过率 | ≥ 95% | 100.0%（370/370） | ✅ |
| H5 | 硬性 | Code ID 用例覆盖率 | = 100% | 100.0%（118/118） | ✅ |
| H6 | 硬性 | @code 标注率 | = 100% | 100.0%（118/118） | ✅ |
| H7 | 硬性 | 证据完整率 | = 100% | 100.0%（370/370） | ✅ |
| T1 | 目标 | 后端行覆盖率 | ≥ 80% | 92.4%（2960/3202） | ✅ |
| T2 | 目标 | 后端分支覆盖率 | ≥ 65% | 88.3%（964/1092） | ✅ |
| T3 | 目标 | 前端行覆盖率 | ≥ 60% | 83.7%（2042/2441） | ✅ |
| T4 | 目标 | 变异杀死率（API / E2E） | ≥ 80% | 85.9%（1136/1323） | ✅ |
| T5 | 目标 | [En] 断言标签覆盖率 | = 100% | 100.0%（1634/1634） | ✅ |
| T6 | 目标 | spec-check error 数（BE + FE） | ≤ 0 | 0 | ✅ |

### 需求覆盖

| 指标 | 数值 |
|---|---|
| 需求点（REQ）覆盖率 | 100.0%（121/121） |
| mandatory 需求点覆盖率 | 100.0%（96/96） |
| 需求点验证率 | 100.0%（121/121） |
| Feature 设计覆盖率（代码点） | 100.0%（70/70） |
| Feature 用例覆盖率 | 100.0%（70/70） |
| Feature 验证通过率 | 100.0%（70/70） |
| P0 Feature 验证率 | 100.0%（57/57） |
| 验收标准（AC）覆盖率 | 100.0%（190/190） |
| 验收标准（AC）验证率 | 100.0%（190/190） |

按优先级：

| 优先级 | inScope | 设计覆盖 | 用例覆盖 | 已验证 |
|---|---|---|---|---|
| P0 | 57 | 57/57 | 57/57 | 57/57 |
| P1 | 13 | 13/13 | 13/13 | 13/13 |

按模块：

| 模块 | inScope | 设计覆盖 | 用例覆盖 | 已验证 |
|---|---|---|---|---|
| CACHE | 2 | 2/2 | 2/2 | 2/2 |
| CLEAN | 8 | 8/8 | 8/8 | 8/8 |
| CTX | 7 | 7/7 | 7/7 | 7/7 |
| DEMO | 2 | 2/2 | 2/2 | 2/2 |
| DIAG | 11 | 11/11 | 11/11 | 11/11 |
| INCR | 1 | 1/1 | 1/1 | 1/1 |
| MENU | 1 | 1/1 | 1/1 | 1/1 |
| PERF | 2 | 2/2 | 2/2 | 2/2 |
| PERSIST | 1 | 1/1 | 1/1 | 1/1 |
| PRIV | 5 | 5/5 | 5/5 | 5/5 |
| RANK | 5 | 5/5 | 5/5 | 5/5 |
| REC | 8 | 8/8 | 8/8 | 8/8 |
| RULE | 10 | 10/10 | 10/10 | 10/10 |
| SYNC | 7 | 7/7 | 7/7 | 7/7 |

### 代码追溯（Code ID）

| 指标 | 全部 | BE | FE |
|---|---|---|---|
| 用例覆盖率 | 100.0%（118/118） | 100.0%（60/60） | 100.0%（58/58） |
| 验证通过率 | 100.0%（118/118） | 100.0%（60/60） | 100.0%（58/58） |
| @code 标注率 | 100.0%（118/118） | 100.0%（60/60） | 100.0%（58/58） |

### 测试执行

| 总数 | 通过 | 失败 | 不稳定 | 未执行 | 通过率 | P0 通过率 |
|---|---|---|---|---|---|---|
| 370 | 370 | 0 | 0 | 0 | 100.0%（370/370） | 100.0%（106/106） |

状态来源：validator 370，run-cases 0，evidence 0，无记录 0

| 类型 | 总数 | 通过 | 失败 | 不稳定 | 未执行 |
|---|---|---|---|---|---|
| API | 219 | 219 | 0 | 0 | 0 |
| E2E | 8 | 8 | 0 | 0 | 0 |
| UI | 143 | 143 | 0 | 0 | 0 |

| 优先级 | 总数 | 通过 | 失败 | 不稳定 | 未执行 |
|---|---|---|---|---|---|
| P0 | 106 | 106 | 0 | 0 | 0 |
| P1 | 205 | 205 | 0 | 0 | 0 |
| P2 | 59 | 59 | 0 | 0 | 0 |

| 用例类别 | 总数 | 通过 | 失败 | 不稳定 | 未执行 |
|---|---|---|---|---|---|
| boundary | 75 | 75 | 0 | 0 | 0 |
| compatibility | 1 | 1 | 0 | 0 | 0 |
| exception | 54 | 54 | 0 | 0 | 0 |
| negative | 66 | 66 | 0 | 0 | 0 |
| performance | 5 | 5 | 0 | 0 | 0 |
| positive | 140 | 140 | 0 | 0 | 0 |
| security | 5 | 5 | 0 | 0 | 0 |
| state | 24 | 24 | 0 | 0 | 0 |

| 模块 | 总数 | 通过 | 失败 | 不稳定 | 未执行 |
|---|---|---|---|---|---|
| CACHE | 7 | 7 | 0 | 0 | 0 |
| CLEAN | 41 | 41 | 0 | 0 | 0 |
| CTX | 21 | 21 | 0 | 0 | 0 |
| DEMO | 8 | 8 | 0 | 0 | 0 |
| DIAG | 43 | 43 | 0 | 0 | 0 |
| FLOW | 8 | 8 | 0 | 0 | 0 |
| INCR | 7 | 7 | 0 | 0 | 0 |
| MENU | 21 | 21 | 0 | 0 | 0 |
| PERF | 4 | 4 | 0 | 0 | 0 |
| PERSIST | 6 | 6 | 0 | 0 | 0 |
| PRIV | 27 | 27 | 0 | 0 | 0 |
| RANK | 33 | 33 | 0 | 0 | 0 |
| REC | 37 | 37 | 0 | 0 | 0 |
| RULE | 70 | 70 | 0 | 0 | 0 |
| SYNC | 37 | 37 | 0 | 0 | 0 |

### 代码行覆盖率

| 端 | 行 | 分支 | 函数 | 语句 | 文件数 |
|---|---|---|---|---|---|
| 后端 server/ | 92.4%（2960/3202） | 88.3%（964/1092） | 91.0%（212/233） | 92.4%（2960/3202） | 65 |
| 前端 extension/ | 83.7%（2042/2441） | 64.9%（1508/2323） | 84.4%（532/630） | 78.5%（2317/2951） | 63 |

采集运行：388/389 个测试通过（2026-11-03T00:05:04.957Z）

行覆盖率低于 50% 的文件：

| 文件 | 行覆盖率 |
|---|---|
| server/src/store/snapshot-loader.js | 0.0% |
| server/src/store/snapshot-writer.js | 41.0% |
| extension/background/handlers/cleanup-actions.js | 2.5% |
- ⚠ 覆盖率采集运行中有 1 个测试失败，覆盖率可能偏低（失败用例没有执行完）

### 断言有效性

| 指标 | 数值 |
|---|---|
| [En] 断言标签覆盖率 | 100.0%（1634/1634） |
| 弱断言数 | 0 |
| 脚本 lint 错误 / 警告 | 0 / 0 |
| 变异杀死率（API / E2E） | 85.9%（1136/1323） |

存活的变异（断言没有约束住对应属性）：

| Case | 存活算子 |
|---|---|
| TC-API-CLEAN-002 | str-blank |
| TC-API-CLEAN-003 | reverse |
| TC-API-CLEAN-004 | drop-item, reverse |
| TC-API-CLEAN-005 | reverse, drop-key |
| TC-API-CLEAN-008 | reverse |
| TC-API-CLEAN-009 | reverse |
| TC-API-CLEAN-010 | str-blank |
| TC-API-CLEAN-011 | reverse |
| TC-API-CLEAN-013 | reverse |
| TC-API-CLEAN-015 | reverse |
| TC-API-CLEAN-016 | reverse |
| TC-API-CLEAN-017 | reverse |
| TC-API-CLEAN-018 | drop-item, str-blank |
| TC-API-CLEAN-019 | reverse |
| TC-API-CLEAN-020 | drop-item, str-blank |
| TC-API-CLEAN-022 | reverse |
| TC-API-CLEAN-023 | drop-item, reverse, str-blank |
| TC-API-CLEAN-024 | drop-item, reverse |
| TC-API-CLEAN-025 | reverse |
| TC-API-CLEAN-026 | reverse |
| TC-API-CLEAN-027 | reverse |
| TC-API-CLEAN-028 | reverse |
| TC-API-CLEAN-029 | drop-item, reverse |
| TC-API-DEMO-001 | num-shift |
| TC-API-DEMO-002 | num-shift |
| TC-API-DEMO-004 | str-blank, drop-key |
| TC-API-DEMO-005 | reverse |
| TC-API-DEMO-006 | reverse, num-shift, drop-key |
| TC-API-DEMO-007 | str-blank, drop-key |
| TC-API-DEMO-008 | str-blank, drop-key |
| TC-API-DIAG-002 | reverse |
| TC-API-DIAG-004 | drop-item, reverse |
| TC-API-DIAG-005 | num-shift, str-blank, drop-key |
| TC-API-DIAG-007 | num-shift, drop-key |
| TC-API-DIAG-009 | drop-key |
| TC-API-DIAG-011 | drop-item, reverse |
| TC-API-DIAG-012 | drop-item, reverse |
| TC-API-DIAG-013 | reverse |
| TC-API-MENU-001 | reverse |
| TC-API-MENU-002 | reverse |
| TC-API-MENU-003 | reverse |
| TC-API-MENU-005 | reverse |
| TC-API-MENU-006 | reverse, reverse, reverse, reverse, str-blank, str-blank, str-blank, str-blank |
| TC-API-MENU-007 | reverse, reverse, reverse, reverse, reverse, reverse, reverse, reverse, reverse, reverse |
| TC-API-MENU-008 | reverse, reverse, reverse, reverse |
| TC-API-MENU-009 | reverse, reverse |
| TC-API-MENU-010 | reverse, reverse |
| TC-API-MENU-011 | reverse |
| TC-API-PERF-001 | drop-item, reverse |
| TC-API-PERF-002 | reverse, str-blank |
| TC-API-PERF-004 | reverse |
| TC-API-PERSIST-001 | reverse |
| TC-API-PERSIST-005 | str-blank, drop-key |
| TC-API-PERSIST-006 | drop-key |
| TC-API-PRIV-001 | str-blank |
| TC-API-PRIV-002 | str-blank, drop-key |
| TC-API-PRIV-005 | str-blank |
| TC-API-PRIV-006 | drop-item, reverse, str-blank, drop-key |
| TC-API-PRIV-008 | drop-item, str-blank |
| TC-API-PRIV-011 | num-shift |
| TC-API-PRIV-014 | drop-item, reverse |
| TC-API-PRIV-015 | reverse |
| TC-API-RANK-005 | str-blank |
| TC-API-RANK-006 | reverse |
| TC-API-RANK-007 | reverse |
| TC-API-RANK-008 | reverse |
| TC-API-RANK-010 | reverse |
| TC-API-RANK-011 | reverse |
| TC-API-RANK-012 | drop-item, reverse |
| TC-API-RANK-013 | reverse, str-blank |
| TC-API-RANK-016 | status, reverse, num-shift |
| TC-API-RANK-017 | status, drop-item, reverse, num-shift |
| TC-API-RANK-018 | status, reverse, num-shift |
| TC-API-RANK-019 | reverse |
| TC-API-RANK-020 | status, reverse, num-shift |
| TC-API-RANK-022 | reverse |
| TC-API-RANK-024 | reverse |
| TC-API-REC-009 | str-blank |
| TC-API-REC-011 | str-blank |
| TC-API-REC-012 | reverse |
| TC-API-REC-013 | reverse |
| TC-API-REC-014 | drop-item, reverse |
| TC-API-REC-022 | drop-item, reverse, str-blank |
| TC-API-REC-025 | reverse |
| TC-API-REC-031 | reverse |
| TC-API-RULE-002 | reverse |
| TC-API-RULE-012 | num-shift |
| TC-API-RULE-013 | reverse |
| TC-API-RULE-014 | reverse |
| TC-API-RULE-018 | reverse |
| TC-API-RULE-019 | reverse |
| TC-API-RULE-020 | drop-item |
| TC-API-RULE-021 | drop-item |
| TC-API-RULE-022 | drop-item |
| TC-API-RULE-023 | reverse |
| TC-API-RULE-025 | drop-item |
| TC-API-RULE-027 | drop-item |
| TC-API-RULE-028 | drop-item |
| TC-API-RULE-029 | drop-item, reverse |
| TC-API-RULE-030 | drop-item |
| TC-API-RULE-032 | str-blank |
| TC-API-RULE-033 | reverse |
| TC-API-RULE-034 | drop-item |
| TC-API-RULE-037 | reverse |
| TC-API-RULE-038 | reverse |
| TC-API-RULE-039 | drop-item |
| TC-API-RULE-042 | str-blank |
| TC-API-RULE-043 | reverse |
| TC-API-RULE-045 | reverse |
| TC-API-SYNC-002 | reverse |
| TC-API-SYNC-003 | reverse |
| TC-API-SYNC-005 | reverse |
| TC-API-SYNC-007 | reverse |
| TC-API-SYNC-009 | reverse |
| TC-API-SYNC-011 | reverse |
| TC-API-SYNC-012 | reverse |
| TC-API-SYNC-013 | reverse |
| TC-API-SYNC-014 | reverse |
| TC-API-SYNC-015 | reverse |
| TC-API-SYNC-016 | reverse |
| TC-API-SYNC-018 | reverse |
| TC-API-SYNC-019 | reverse |
| TC-API-SYNC-021 | reverse |
| TC-API-SYNC-024 | drop-item, reverse |
| TC-API-SYNC-027 | drop-item |
| TC-API-SYNC-028 | reverse |

变异检查中基线未通过：TC-API-PERF-001, TC-API-PERF-002, TC-API-SYNC-001, TC-API-SYNC-025

### 证据完整性

已执行用例 370 个，证据完整率 100.0%（370/370）。证据索引：`evidence/index.json`。

### 缺陷与过程

TDD 门禁轮次：8；UI 探索结论：pass 143，product_bug 0，script_stale 0，无记录 0；validate final：通过

| 轮次 | 门禁 | 测试总数 | 通过 | 失败 | 校验错误 |
|---|---|---|---|---|---|
| 1 | ❌ | 389 | 57 | 332 | 64 |
| 2 | ❌ | 389 | 120 | 269 | 45 |
| 3 | ❌ | 389 | 120 | 269 | 45 |
| 4 | ❌ | 389 | 314 | 75 | 32 |
| 5 | ❌ | 389 | 318 | 71 | 32 |
| 6 | ✅ | 389 | 389 | 0 | 0 |
| 7 | ✅ | 389 | 389 | 0 | 0 |
| 8 | ✅ | 389 | 389 | 0 | 0 |

### 规范符合度

| 端 | 结果 |
|---|---|
| 后端 specs/backend.spec.md | ✅ error 0 / warning 0 |
| 前端 specs/frontend.spec.md | ✅ error 0 / warning 0 |

### 性能指标

| Case | 指标 | 数值 |
|---|---|---|
| TC-API-DIAG-009 | health.maxMs | 1 ms |
| TC-API-PERF-001 | recommendations.p50 | 0.6 ms |
| TC-API-PERF-001 | recommendations.p95 | 1.8 ms |
| TC-API-PERF-001 | recommendations.max | 1.8 ms |
| TC-API-PERF-002 | ranked.p50 | 0.7 ms |
| TC-API-PERF-002 | ranked.p95 | 1.2 ms |
| TC-API-PERF-002 | ranked.max | 1.4 ms |
| TC-API-PERSIST-005 | sigterm.afterSyncStarted | 105.63037500000064 ms |

### 数据来源

| 文件 | 存在 | 更新时间 |
|---|---|---|
| docs/trace/features.json | 是 | 2026-11-02T10:53:22.517Z |
| docs/trace/requirements.json | 是 | 2026-11-02T09:04:03.114Z |
| docs/trace/code-points-be.json | 是 | 2026-11-02T14:28:19.516Z |
| docs/trace/code-points-fe.json | 是 | 2026-11-02T22:05:58.889Z |
| docs/trace/cases-api.json | 是 | 2026-11-02T23:50:07.042Z |
| docs/trace/cases-ui.json | 是 | 2026-11-02T23:50:07.043Z |
| .workflow/reports/case-status.json | 是 | 2026-11-02T23:53:50.280Z |
| evidence/_runs/latest.json | 是 | 2026-11-02T23:39:47.133Z |
| coverage/summary.json | 是 | 2026-11-03T00:05:04.958Z |
| evidence/_runs/mutation-latest.json | 是 | 2026-11-02T23:39:46.256Z |
| .workflow/reports/validate-final.json | 是 | 2026-11-02T23:53:50.318Z |
| docs/quality/spec-check-be.json | 是 | 2026-11-02T23:50:09.861Z |
| docs/quality/spec-check-fe.json | 是 | 2026-11-02T23:50:09.862Z |
| docs/quality/exit-criteria.json | 否 | - |
| evidence/index.json | 是 | 2026-11-03T00:06:33.965Z |
