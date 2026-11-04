## PERSIST 持久化：UI 适用范围核查

本分片只负责 PERSIST 模块的 UI 测试设计。依据 `.workflow/context/briefs/case-UI-CLEAN+PERSIST.md`、`.workflow/context/packs/PERSIST.md`、`.workflow/CONVENTIONS.md` 和 `nav-test-case-design` 技能，UI 责任由 `inScope=true` 且 `layers` 含 `FE` 的 Feature、其 AC 以及 C-FE 代码点确定。

对本快照的 `docs/trace/features.json`、`docs/trace/code-points-fe.json` 和 `docs/trace/ui-contract.json` 逐项核实后，PERSIST 的 UI 适用 Feature=0、UI AC 责任=0、C-FE 责任=0，UI 契约中的 element、message、storageKey 均未登记 PERSIST 关联。

### Feature、层级与范围

| Feature | 内容 | layers | inScope | AC | 本分片责任 |
|---|---|---|---|---|---|
| F-PERSIST-01 | 后端 JSON 快照持久化 | BE | true | AC1、AC2 | 无 UI 责任；重启恢复与残留临时文件回退由 API/E2E 角色覆盖 |
| F-PERSIST-02 | SQLite 持久化实现 | BE | false | AC1 | 不在本期实现范围，无 UI 责任 |

`C-BE-PERSIST-01`（快照写入）和 `C-BE-PERSIST-02`（快照加载）仍属于 BE 验证责任。本分片不修改其范围，也不以其他模块的诊断界面替代持久化链路验证。

### Feature → UI Case 覆盖

UI 适用 Feature 集合为空，覆盖映射为空，没有 Case ID。`docs/trace/cases/UI-PERSIST.json` 因此保留 `cases: []` 和 `waivers: []`。BE-only Feature 不需要 UI 类别豁免，其 API/E2E 正例、异常与 AC 覆盖义务仍然保留。

| UI 适用 Feature | UI AC | 覆盖用例 | 类别分布 | waiver |
|---|---|---|---|---|
| 无（适用集合为空） | 0 | 无 | 无 | 0 |

### 类别分布与自检

以下数字取自本隔离快照运行 `node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --json` 的 `stats`，并核对 validator 合并结果：本快照仅有 `UI-PERSIST.json` 一个分片，合并后的 API/E2E=0、UI=0。因此用例分布只反映本分片；空分布对象中未出现的类别按 0 展示。

| category | 数量 |
|---|---:|
| positive | 0 |
| negative | 0 |
| boundary | 0 |
| exception | 0 |
| security | 0 |
| performance | 0 |
| compatibility | 0 |
| state | 0 |

技能原始统计为 `cases=0`、`byType={}`、`byCategory={}`、`byPriority={}`、`byTechnique={}`、`waivers=0`。UI AC 适用=0、覆盖=0，覆盖率不适用；不能将空集合表述成 100% 产品通过率。

| 自检 | 原始退出码 | 结果与范围 |
|---|---:|---|
| `node .workflow/validators/validate.mjs cases --module=PERSIST --brief` | 1 | 首次报告 4 错误，其中 1 项为技能子进程 JSON 输出截断；不作为完整语义结果 |
| 同一模块校验，通过临时 `NODE_OPTIONS` 预加载启用 stdout/stderr 阻塞输出 | 1 | 7 错误、0 警告；UI 相关错误=0，7 项均为 BE 测试覆盖缺口 |
| `node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --json` | 1 | 417 错误、0 警告；该脚本读取全部 Feature，隔离快照未包含其他角色分片。PERSIST 对应 4 项，均属于 BE 覆盖责任 |

模块校验保留的 7 项分别是：F-PERSIST-01 无用例、两个 C-BE 无用例引用、缺少 positive 与 exception 类别、AC1 与 AC2 无覆盖。技能检查对应其中后 4 项。这些缺口应交由 API/E2E 角色处理，本 UI 空分片不提供 BE 豁免。该隔离快照的全模块门禁未通过。

临时输出配置只影响本次校验进程，未修改 validator 或技能脚本。合并文件与校验报告由 validator 生成。

本交付是 UI 测试设计范围核查，不构成持久化功能已通过测试、后端链路已执行或产品可准出的结论。本次不启动浏览器，也不生成测试脚本或运行证据。
