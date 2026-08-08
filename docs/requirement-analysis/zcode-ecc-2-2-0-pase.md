# PASE - ECC 2.2.0 全量适配 ZCode

## 1. 需求来源

- 用户需求：Fork 当前 ECC 2.2.0 为 `ZCodeECC`，把 Agents、Skills、Commands、Hooks、Rules、MCP 与安装维护能力逐项适配到 ZCode，并完成实现、测试与 GitHub 交付。
- 参考文档：ZCode 本机 `diagnosing-plugins`、`diagnosing-skills`、`diagnosing-hooks` 指南；ECC 根目录 `AGENTS.md`、插件清单、安装清单与现有多 Harness 适配器。
- 代码证据：上游 `affaan-m/ECC` 的 `main` 固定于提交 `59a99d669f5466d99d5be8b6fce8c5f2677766d0`；`.claude-plugin/plugin.json` 和 `package.json` 均为 `2.2.0`。

## 2. 扫描范围

- 前端范围：无独立业务前端；仅覆盖 ZCode Desktop/CLI 中插件、Skill、Command 和 Hook 的可发现性与展示结果。
- 后端范围：无业务后端；覆盖 ECC Node.js 安装器、适配生成器、Hooks 运行脚本及可选 MCP 配置。
- 共享范围：`.zcode-plugin/`、`.zcode/`、`agents/`、`commands/`、`skills/`、`rules/`、`hooks/`、`mcp-configs/`、`manifests/`、`scripts/lib/install-*`、测试与发布文档。

## 3. 核心结论

- 总体状态：ECC 2.2.0 已具备多 Harness 安装架构，但没有 ZCode 插件清单、安装目标、能力目录、逐项兼容清单或真实 ZCode 验证。
- 主要缺口：67 Agents 不能由 ZCode 原生执行；284 Skills 虽大多可解析但含 Claude 路径/术语；94 Commands 与 122 Rules 缺少 ZCode 投影；21 Hooks 中有不受支持的事件、无效通配 matcher 和被忽略的异步语义。
- 最高风险：ZCode 的第三方插件 Hooks 安装后立即可运行。未经事件、matcher、超时和非阻塞策略适配就直接复用 `hooks/hooks.json`，可能阻塞正常会话或产生与 ECC 原语义不同的副作用。

## 4. 差异总表

| 分类 | 需求点 | 当前现状 | 差异/缺口 | 影响 | 证据 | 责任归属 |
| --- | --- | --- | --- | --- | --- | --- |
| 基线 | 固定 ECC 2.2.0 | `main` 清单版本 2.2.0 | 正式 Release 仍为 2.1.0，必须固定提交而非 Release tag | 上游同步和复现 | `.claude-plugin/plugin.json`、Git 提交 `59a99d6` | 仓库/发布 |
| Plugin | ZCode 原生插件入口 | 仅有 Claude/Codex 等入口 | 缺少 `.zcode-plugin/plugin.json` | ZCode 不能按原生优先级识别 | `.claude-plugin/`、`.codex-plugin/` | ZCode 适配层 |
| Installer | `--target zcode` | 14 个目标，无 ZCode | 缺适配器、目标根、能力目录、清单 target | 无法安装/更新/修复/卸载 | `scripts/lib/install-manifests.js`、`install-targets/registry.js` | 安装器 |
| Agents | 67 个 Agent 能力 | ZCode 记录但不执行 manifest `agents` | 需转为可触发的 Agent-role Skills | 专家能力不可用 | `agents/*.md`、ZCode 插件指南 | 生成器 |
| Skills | 284 个 Skill | 结构大多可被 ZCode 解析 | Frontmatter 与正文含 Claude 专属字段、路径和工具名 | 触发或执行偏差 | `skills/*/SKILL.md` | 生成器/人工例外 |
| Commands | 94 个 Command | Markdown 结构接近 ZCode | `.claude`、`CLAUDE.md`、Task/子代理等假设未统一 | 命令行为不稳定 | `commands/*.md` | 生成器/人工例外 |
| Rules | 122 条规则 | ZCode 无 ECC rules 原生入口 | 需转换为按技术域触发的 Rule-pack Skills | 规则能力缺失 | `rules/**/*.md` | 生成器 |
| Hooks | 21 个 Hook | Claude Hook 清单 | `PreCompact`、`SessionEnd` 不支持；`*` 不是有效正则；`async` 无效；`MultiEdit` 需归一化 | 可能不触发、阻塞或语义漂移 | `hooks/hooks.json`、ZCode Hooks 指南 | Hook bridge |
| MCP | 可选 MCP 能力 | 主插件默认不声明 MCP；仓库有配置样例 | ZCode 插件 MCP 会自动接入，敏感配置又不能在 UI 持久化 | 不应默认启用外部服务 | `.mcp.json`、`mcp-configs/mcp-servers.json` | MCP 边界 |
| Parity | 所有功能逐项有归宿 | 当前只有目录级描述 | 缺机器可读逐文件清单与 CI 守卫 | 上游更新容易漏项 | 全部能力目录 | 兼容清单/CI |
| Runtime | 真实 ZCode 验证 | 无 | 缺隔离 settings、插件/Skill/Command 列表与 Hook schema 冒烟 | 静态通过不代表可用 | ZCode CLI 0.16.1 | 测试 |

## 5. 前端缺口

### 5.1 已发现缺口

- [P1] 需求：在 ZCode Desktop/CLI 中展示并启用 ZCodeECC。
  当前：无原生清单，界面不会以 `zcode-ecc` 插件呈现。
  差异：缺少插件身份、组件根和本机发现验证。
  证据：仓库没有 `.zcode-plugin/`；ZCode 优先探测 `.zcode-plugin/plugin.json`。
  建议动作：创建原生清单，并用隔离 `plugins.dirs` 配置运行 `plugins list`、`skills list`、`commands list`。

### 5.2 待确认项

- ZCode Desktop 插件商店的正式 Marketplace 上架不在本阶段范围；本阶段交付可添加的 GitHub Fork 与本地/CLI 安装能力。

## 6. 后端缺口

### 6.1 已发现缺口

- [P0] 需求：Hooks 在 ZCode 中安全、可预测地运行。
  当前：Claude Hook 事件与执行模型被直接假定。
  差异：两个事件不支持、七个异步 Hook 会同步等待、通配 matcher 和工具别名不兼容。
  证据：`hooks/hooks.json`；ZCode 仅支持 7 个事件且 `async` 当前无效。
  建议动作：生成 ZCode 专用 Hook 清单，保留逐 Hook 来源映射，显式标注降级语义，并测试 schema/matcher/超时。

- [P1] 需求：安装、升级、修复、卸载遵循 ECC 现有生命周期。
  当前：目标注册表与能力目录没有 `zcode`。
  差异：无法形成受目标根约束的安装计划。
  证据：`SUPPORTED_INSTALL_TARGETS` 与 `install-targets/registry.js`。
  建议动作：增加 `zcode-home` 适配器，目标根为 `~/.zcode`，状态文件放在 `~/.zcode/ecc-install-state.json`，只管理归属文件。

### 6.2 待确认项

- MCP 服务器是否默认开启：本阶段采用安全默认值“不自动开启”，只交付经过模板变量和秘密边界审查的 opt-in 配置。

## 7. 共享 / 联调问题

- 接口契约：ZCode plugin manifest 支持 `commands`、`skills`、`hooks`、`mcpServers`；`agents` 等字段只记录不执行。
- 数据结构：生成 `compatibility-manifest.json`，为每个源 Agent、Skill、Command、Rule、Hook、MCP 配置记录目标路径、转换方式、状态与限制。
- 权限 / 鉴权：Fork/分支推送使用当前 GitHub 身份；不读取、复制或提交本机登录凭据。ZCode 测试使用隔离 settings，不修改 `~/.zcode/cli/config.json`。
- 测试 / 发布依赖：Node.js/npm、ZCode Desktop CLI 0.16.1；正式 ZCode Marketplace 上架与远端 CI 结果作为后续发布门禁。

## 8. 风险与阻塞

- P0：插件 Hook 无信任门且自动启用；必须在安装说明中显著告知，并让默认行为可审计。
- P1：机械替换不能正确处理所有 Claude 专属行为；生成器必须支持显式 override/limited 状态，CI 禁止未分类遗漏。
- P1：Agent 转 Skill 后不再拥有独立模型、工具白名单或真正的并行子代理隔离；只能保留角色工作流，不能宣称完全等价。
- P1：`PreCompact` 无等价的“压缩前”事件，`SessionEnd` 无原生事件；需采用可解释的降级映射并在兼容清单中公开。
- P2：上游 `main` 会快速变化；必须保留 `upstream` remote、固定基线 SHA，并用生成器/清单减少同步漂移。

## 9. 建议优先级

1. 建立 `.zcode-plugin`、全量兼容清单与隔离 CLI 验证，先证明 ZCode 能发现全部投影能力。
2. 完成安装目标、Agents/Rules 转 Skill、Skills/Commands 术语与路径适配。
3. 完成 Hook bridge 与 opt-in MCP，运行全套回归、推送分支并记录不可等价项。

## 10. 实施闭环

- 已采用隔离插件根 `plugins/zcode-ecc/`。真实验证发现，把仓库根直接交给 ZCode 会自动探测上游 `skills/`、`commands/`、`hooks/hooks.json` 与 `.mcp.json`，因此根级 `.zcode-plugin` 方案被否决。
- 624 个源能力记录均已映射且受确定性生成器保护；Agents 转为角色 Skills，Rules 转为 22 个技术域 Rule-pack Skills。
- 21 个 Hook 来源形成 20 个 ZCode Hook groups：`PreCompact` 降级到 `SessionStart(compact)`，`SessionEnd` 最终清理没有原生等价，异步语义标为 `limited`。
- 36 个 MCP 定义全部生成为 `enabled: false` 的独立片段，原生插件清单启用数为 0。
- 受管 `~/.zcode` 安装只提供 Skills、Commands 与兼容清单，不配置 Hook；完整 Hook 能力通过原生插件交付，避免在用户配置 Hook 中错误使用仅插件上下文有效的根变量。
- 全量回归为 3727/3727，通过真实 ZCode CLI 0.16.1 验证：373 Skills、94 Commands、20 Hook groups、0 个启用 MCP、0 条 warning/error diagnostics。
