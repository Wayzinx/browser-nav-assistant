# DEMO UI 测试用例分片

> 仅测试设计；本次不生成脚本、不执行产品、不声称产品 PASS。JSON 为本分片结构化来源。

## 范围与配方

F-DEMO-01（一条命令启动后端）和 F-DEMO-02（样例导入）的 layers 均只有 BE；没有 inScope 且 layers 含 FE 的 Feature，也没有关联 C-FE 代码点。故 UI 分片为 `{"cases":[],"waivers":[]}`，UI AC 分母为 0（不适用）。

后端启动、端口覆盖、样例导入与旧页面检查由既有 API-DEMO 分片负责；UI 空片没有豁免任何后端 AC 或正例要求。

## Feature → Case 覆盖

| Feature | AC | Case |
|---|---|---|
| 无适用 FE Feature | 0（不适用） | 0 |

## C-FE → Case 覆盖

| Code | Case |
|---|---|
| 无适用 C-FE | 0 |

## 类别分布统计

以下按本分片 UI Feature/Case 范围调用技能 checkCases 取得 stats 与 matrix；仅是设计统计，完整模块门禁另行运行，不是执行通过率。

| 类别 | 条数 |
|---|---:|
| 不适用 | 0 |

用例 0 条；UI AC 覆盖 0/0（不适用）；必需类别缺口 0；waiver 0 条。

优先级分布：{}。
