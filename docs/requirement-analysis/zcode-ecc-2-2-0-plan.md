# PLAN - ECC 2.2.0 全量适配 ZCode

## 输入文档

- PASE: `/Users/feigao/project/Project/ZCodeECC/docs/requirement-analysis/zcode-ecc-2-2-0-pase.md`

## Step 1 - /develop

### 命令

`/develop /Users/feigao/project/Project/ZCodeECC/docs/requirement-analysis/zcode-ecc-2-2-0-pase.md`

### 目标

- 基于 PASE 中的缺口完成开发实现。
- 新增 ZCode 原生插件入口、`zcode` 安装目标和可重复运行的能力投影生成器。
- 为 67 Agents、284 Skills、94 Commands、122 Rules、21 Hooks 与 MCP 配置生成逐项兼容记录，不允许未分类遗漏。

### 输入

- PASE 文档。
- 当前工作目录代码。
- ZCode 本机插件、Skill、Command、Hook 规范和 CLI 0.16.1。

### 输出

- `.zcode-plugin/` 与 `.zcode/` 原生适配产物。
- 生成器、例外映射、兼容清单和 ZCode 安装适配器。
- 必要的文档、配置、测试更新。

### 完成判定

- PASE 中 P0/P1 缺口已实现或以机器可读 `limited` 状态明确关闭。
- 兼容清单与源目录计数完全一致，重复生成无差异。
- 关键假设已落地或被消除。

### 进入下一步条件

- 开发结果可进入 review。

## Step 2 - /review

### 命令

`/review`

### 目标

- 检查实现质量、范围偏差、潜在回归和遗漏。
- 重点审查 Hook 自动执行、目标根路径约束、秘密处理、生成器确定性与 Agent-to-Skill 语义降级。

### 输入

- Step 1 产出的代码改动。
- PASE 文档。
- 全量兼容清单与测试结果。

### 输出

- review 结论。
- 必要修正项。
- 已知限制和不可等价项列表。

### 完成判定

- 高风险问题已解决或明确接受。
- 没有源能力未映射、路径越界、默认秘密写入或未声明的外部服务启动。
- 代码质量达到可测试状态。

### 进入下一步条件

- review 无阻塞问题。

## Step 3 - /test

### 命令

`/test`

### 目标

- 验证生成器、安装/修复/卸载生命周期、插件发现、Skills/Commands 发现、Hook schema 与上游回归。

### 输入

- review 后代码。
- Node.js 测试入口、ECC 全套测试入口与本机 ZCode CLI。

### 输出

- 静态、单元、集成和隔离 ZCode 冒烟测试结果。
- 是否通过的结论及未执行门禁。

### 完成判定

- ZCode 专项测试通过，生成器二次运行保持工作区不变。
- 隔离 settings 下 `zcode-ecc` 插件、全部 Skill 投影和全部 Command 投影可被 ZCode 列出。
- ECC 相关回归测试通过；若全仓测试受上游或环境限制，精确记录失败和边界。
- 结果满意，满足分支推送条件。

### 后续动作

- 满意就提交并推送 `feat/zcode-native-adapter` 到 `lenaelelle672-beep/ZCodeECC`。
- 不满意则回到 `/develop` 或 `/review` 补齐。
- 未经额外授权，不向 `affaan-m/ECC` 上游创建 PR，也不修改用户全局 ZCode 配置。
