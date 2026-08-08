# ZCodeECC 2.2.0

ZCodeECC 是 ECC 2.2.0 的 ZCode 原生适配分支。它固定上游基线
`59a99d669f5466d99d5be8b6fce8c5f2677766d0`，通过可重复生成器把 ECC
能力投影到 ZCode 支持的 Plugin、Skill、Command、Hook 与 MCP 配置格式。

## 当前覆盖

| ECC 源能力 | 数量 | ZCode 结果 | 状态 |
| --- | ---: | --- | --- |
| Agents | 67 | 67 个 `ecc-agent-*` 角色 Skill | limited：保留角色流程，不宣称独立模型、工具白名单或隔离子代理等价 |
| Skills | 284 | 284 个 ZCode Skill | adapted |
| Commands | 94 | 94 个 ZCode Command | adapted |
| Rules | 122 | 22 个按技术域组织的 `ecc-rules-*` Skill，逐规则保留 122 条记录 | adapted |
| Hooks | 21 | 20 个可加载 Hook group，21 条来源兼容记录 | adapted/limited |
| MCP | 36 | 36 个 `enabled: false` 的独立片段；主插件启用 0 个 | opt-in |

机器可读的逐项结果位于
[`plugins/zcode-ecc/compatibility-manifest.json`](../plugins/zcode-ecc/compatibility-manifest.json)。
源目录增加、删除或转换结果漂移时，`npm run check:zcode` 会失败。

## 推荐安装：ZCode 原生插件

1. 在 ZCode 打开 **Settings → Plugin Management → Discover**。
2. 点击 **`+`**，添加 GitHub 仓库
   `https://github.com/lenaelelle672-beep/ZCodeECC`。
3. 选择并安装 **`zcode-ecc`**。不要选择同一 Marketplace 中面向 Claude
   兼容路径的 `ecc`。
4. 在 Installed 页确认插件 ID 为 `zcode-ecc`，再到 Skills 和 `/` 菜单检查能力。

Marketplace 条目指向隔离目录 `plugins/zcode-ecc/`。这是必要的安全边界：
ZCode 会自动探测插件根中的传统 `skills/`、`commands/`、`hooks/hooks.json`
和 `.mcp.json`。如果把整个上游仓库根当成 ZCode 插件，会同时加载未经适配的
Claude 组件和 MCP；隔离插件根避免了这种重复与误启用。

> [!WARNING]
> ZCode 启用带 Hook 的插件后会立即加载其 Hook，没有单独的信任确认门。
> 安装前请先审查 `plugins/zcode-ecc/hooks/hooks.json` 和兼容清单。主插件不会
> 启用任何 MCP，但 Hook 会随插件启用。

### 本地目录开发安装

克隆后，可在 Plugin Management 的 `+` 中选择本地目录，并指向：

```text
/path/to/ZCodeECC/plugins/zcode-ecc
```

不要把 `/path/to/ZCodeECC` 仓库根直接作为 ZCode 插件目录。

## 可选安装：受管文件投影

不想启用插件 Hook 时，可以只把生成后的 Skill、Command 和兼容清单安装到
`~/.zcode`。先查看计划，再执行：

```bash
./install.sh --target zcode --profile full --dry-run
./install.sh --target zcode --profile full
```

ZCode 的受管安装目标不配置 `hooks-runtime`；需要 Hook 时请安装上面的原生
`zcode-ecc` 插件。这样不会把只在插件上下文有效的 `ZCODE_PLUGIN_ROOT` 误用于
用户配置 Hook。安装器只管理它写入且记录在
`~/.zcode/ecc-install-state.json` 中的文件，不应覆盖其他 ZCode 配置。

只安装一个 Skill：

```bash
./install.sh --target zcode --skills continuous-learning-v2 --dry-run
./install.sh --target zcode --skills continuous-learning-v2
```

不要把原生插件安装与同一套受管 Skill/Command 投影叠加，否则 ZCode 会发现
重复能力。

## MCP：逐个显式启用

主插件清单中的 `mcpServers` 为空。36 个模板位于
`plugins/zcode-ecc/mcp/servers/`，每个模板均使用 `mcp.servers` 结构并以
`enabled: false` 开始。

启用前必须逐项完成：

1. 审查命令、下载来源、网络目标与数据边界。
2. 把需要的单个 server 合并到用户 `~/.zcode/cli/config.json` 或可信项目的
   `.zcode/config.json`，不要覆盖原文件。
3. 通过环境变量或本地安全配置提供秘密，不要提交凭据。
4. 最后才把该 server 的 `enabled` 改为 `true`。

ZCode 会自动连接各作用域中已配置的 MCP，所以 ZCodeECC 不做批量默认启用。

## Hook 兼容边界

- `PreCompact` 没有原生等价事件，映射到 `SessionStart(compact)`，因此发生在
  压缩之后。
- `SessionEnd` 没有原生事件；会话持久化保留在现有 `Stop` 流程中，但无法保证
  最终退出清理的等价时机。
- ZCode CLI 0.16.1 忽略 `async`，相关 Hook 会内联等待并在兼容清单中标记
  `limited`。
- `*` matcher 已转换为 `.*`，`MultiEdit` 已归一化为 `Edit`。
- Hook stdout 经过 bridge 白名单过滤，只返回 ZCode 接受的事件输出字段。
- Hook 状态默认写入 `~/.zcode/ecc-data`，不会落到 `~/.claude`；可用
  `ECC_AGENT_DATA_HOME` 显式覆盖。

## 构建与验证

```bash
npm ci
npm run build:zcode
npm run check:zcode
node tests/zcode/zcode-adapter.test.js
node tests/zcode/zcode-install-target.test.js
node tests/zcode/zcode-hook-bridge.test.js
npm run smoke:zcode
```

`smoke:zcode` 使用临时 HOME 和临时工作区调用真实 ZCode CLI，不读取或修改
`~/.zcode/cli/config.json`，也不发起模型请求。当前本机验收基线为 ZCode Desktop
3.7.3 / CLI 0.16.1；期望结果为 373 Skills、94 Commands、20 Hook groups、
0 个启用的 MCP、0 条诊断。

## 同步上游

```bash
git fetch upstream
git rebase upstream/main
npm ci
npm run build:zcode
npm run check:zcode
npm test
npm run smoke:zcode
```

生成器当前故意固定 ECC `2.2.0`。上游版本变化时，应先审查 ZCode 契约和兼容
清单，再有意识地更新版本与基线提交；不要绕过版本守卫。
