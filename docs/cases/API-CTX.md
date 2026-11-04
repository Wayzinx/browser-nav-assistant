# CTX — API 用例分片

本分片为 `docs/trace/cases/API-CTX.json`，内容为 `{"cases":[],"waivers":[]}`。
CTX 的7个 inScope Feature 均为 `layers=["FE"]`，没有后端代码点或HTTP接口，故API用例数为0；不创建虚构接口，不引用 C-FE 冒充API覆盖。
当前页面、窗口标签页、浏览历史、manifest、插件加载和系统页降级需由UI分片验证；本交付不表示其已覆盖或已执行。

## Feature → Case 覆盖表

| Feature | AC | BE/API适用性 | API Case |
|---|---|---|---|
| F-CTX-01 | AC1–AC3 | 仅FE | 不适用 |
| F-CTX-02 | AC1–AC2 | 仅FE | 不适用 |
| F-CTX-03 | AC1–AC2 | 仅FE | 不适用 |
| F-CTX-04 | AC1–AC2 | 仅FE | 不适用 |
| F-CTX-05 | AC1–AC2 | 仅FE | 不适用 |
| F-CTX-06 | AC1–AC3 | 仅FE | 不适用 |
| F-CTX-07 | AC1–AC2 | 仅FE | 不适用 |

## 类别分布统计

统计来源：`node .agents/skills/nav-test-case-design/scripts/check-cases.mjs --root=.workflow/context/logs/case-API-CTX+MENU/stats-root/CTX --json` 的 `stats`；仅用于本API分片计数，完整根目录门禁另行运行。

| 类别 | 用例数 |
|---|---:|
| positive | 0 |
| negative | 0 |
| boundary | 0 |
| exception | 0 |
| security | 0 |
| performance | 0 |
| compatibility | 0 |
| state | 0 |
| 合计 | 0 |

优先级分布：{}；waivers=0。

## 待办 / openQuestions

- 无API待设计事项；全部FE验收交由UI负责人，API范围不为其声明PASS。
- 本任务仅完成测试用例设计和静态检查，没有启动后端或执行产品API。
