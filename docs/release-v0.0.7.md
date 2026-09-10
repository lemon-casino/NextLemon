# NextLemon v0.0.7 发布说明

## 发布结论

当前版本可以作为 Web 预发布包分发，用于验证双模式创作、素材库、品牌模板、本地 Agent/MCP、项目包导入导出和 MuAPI 合约适配。

严格生产发布仍需要真实 MuAPI 远端服务验证。当前机器没有配置 `MUAPI_API_KEY`，因此 `muapi-real` 在总体验收报告中被标记为 `blocked`，不能把 mock 合约报告视为真实远端验收。

## 发布物

- Web 包：`releases/NextLemon-v0.0.7-web.zip`
- Web 包 SHA-256：`f571d07fe568acb08c910ae3aa0dea886cb9e203dead98b12727db7ce105d75b`
- 总体验收报告：`releases/agentic-readiness-report.json`
- 本地 MCP 报告：`releases/local-mcp-verification-report.json`
- 品牌模板目录报告：`releases/brand-template-verification-report.json`
- MuAPI mock 合约报告：`releases/muapi-mock-verification-report.json`
- MuAPI 缺少密钥报告：`releases/muapi-missing-key-report.json`

## 已落地能力

- 保留 React Flow 工作流画布，并新增 `workflow` / `creative` 双模式入口。
- 新增素材创作画布，支持文本、图片、视频、音频素材的布局、选择、移动、缩放、层级、锁定、隐藏、删除和导出。
- 新增素材库与生成历史复用，支持搜索、标签、来源、预览、下载、工作流结果保存为素材，以及素材拖回工作流生成输入节点。
- 新增 Agent Provider、Agent 会话、事件流、审批队列和 `CanvasAgentOp` 受控操作目录。
- 新增本地 Agent 桥与 stdio MCP 代理，支持只读快照、操作目录、品牌模板目录读取、品牌模板变体读取、品牌规范生成、MuAPI 环境脱敏前置检查、MuAPI 真实报告断言、综合发布状态读取、审批请求校验和文件型审批导入；stdio 代理操作目录会从应用内 `CANVAS_AGENT_OP_SPECS` 解析，并通过自检防止 MCP 与应用内目录漂移；审批工具暴露 15 个 `CanvasAgentOp` 的 `oneOf` 参数 schema；品牌模板工具可暴露 15 个模板变体、15 个应用后模板摘要，并可为指定品牌/模板/变体输出同源品牌规范。
- `nextlemon.read_verification_reports` 和 `nextlemon.get_release_status` 已同步输出 readiness 中的 `brand-templates`、`local-bridge`、`local-mcp` 结构化摘要，外部 Agent 可直接读取模板 ID、ready 模板 ID、每模板变体/节点/交付物明细、本地桥写工具、本地 MCP 15 个操作类型、操作分类计数、审批 schema oneOf、审批 hash、审批策略、发布状态和严格发布 blocker。
- 应用内 `window.nextlemonAgentBridge` 与 stdio MCP 代理保持品牌能力对齐，均可读取模板目录、应用模板变体并生成品牌规范；写操作仍统一进入审批队列。
- 新增 `verify:local-bridge` 独立验收，检查应用内桥的 6 个工具、15 个 `CanvasAgentOp`、品牌模板读取、品牌规范生成和审批型写操作安全边界。
- 应用内本地 Agent 桥导入外部 MCP 审批文件时，会保留 `opCount`、`opSummary`、`operationTypes`、`approvalPolicy` 和 `requestHash` 审计字段，并在审批卡片中展示来源、操作类型、hash 和审批策略。
- 新增设计计划规划器，支持 brief 生成可编辑 `DesignPlan`，审批后创建素材和工作流节点。
- 新增品牌套件和模板能力，覆盖品牌色、字体、Logo、参考图、语气、模板变体、模板能力矩阵、交付物、推荐工作流节点、验收标准和内置模板目录硬校验；模板验证会检查 5 个内置模板、5 个 ready 模板和 15 个变体的生成与合并结果。
- 品牌模板面板会展示模板能力矩阵摘要、全局节点类型、当前模板必需节点、必需交付物、变体和逐项 capability checks；品牌规范 JSON 导出包含 `templateCapability` 与 `templateCatalog`，外部 Agent 可直接读取模板能力颗粒度。
- 新增 MuAPI 可选适配器、mock 合约验证器和真实服务验证器。
- 应用内 MuAPI 验证结果与 CLI 对齐，导出和 UI 均包含 `strictEvidenceReady`、18 项 `evidenceChecklist`、`blockingEvidenceIds`、`stepEvidence`、`endpointEvidence`、缺失/失败 step 与 endpoint 2xx 清单。
- 新增项目包导入导出、素材文件清单和可选 WebDAV 同步基础能力。
- 项目包面板导入 readiness 报告后，会展开 MuAPI 阻塞原因、失败环境项、真实证据 blocker、下一步命令和 strict evidence 计数。
- 项目包面板和本地 MCP 报告摘要会展开 `brand-spec` 颗粒度，包括品牌规范分数、当前模板 capability、必需工作流节点、全局模板目录 ready 数、15 个模板变体和目录 workflow node 覆盖；导入 readiness 报告时也会展开 `brand-templates` 颗粒度，包括 5 个模板、模板 ID、ready 模板 ID、必需类型、类型计数、每模板变体 ID、每模板节点/交付物、5 个 ready 模板、能力矩阵节点覆盖和失败模板清单；同时展开 `local-bridge` 颗粒度，包括 6 个应用内桥工具、15 个 `CanvasAgentOp`、5 个 ready 品牌模板、15 个模板变体、品牌只读工具和唯一写工具 `nextlemon.requestApproval`；还会展开 `local-mcp` 颗粒度，包括 11 个 MCP 工具、15 个操作 schema、15 个操作类型、分类计数、审批工具 `oneOf` 数、传输格式、审批文件 hash、安全审批策略和严格发布 blocker。

- 新增同步墓碑机制：素材、画布实例与品牌套件删除时记录 `CreativeTombstone`（上限 500 条）并进入项目包/WebDAV 合并，按 "删除时间晚于实体更新时间即删除" 裁决，删除操作可跨端传播；删除后又有更新的实体自动复活。
- 创作画布新增框选与图片导出：Shift+拖拽框选多选（支持反向拖拽与追加选择）；一键导出 PNG/JPG（可见素材外包边界重绘，长边上限 4096，桌面端走保存对话框）。
- 新增 asset_label 规范寻址：素材自动分配 `asset_N` 规范标签并注入 Agent 工作区快照，工具调用支持按标签引用素材（`findAssetIdByRef`），模型无需再处理内部 UUID。
- 新增 ask_user 人机回路：真实模型工具循环新增 `ask_user` 工具，模型提问即挂起并在 Agent 面板展示问题卡片与编号选项，用户回答自动回填续跑；挂起状态随会话持久化。
- 新增 MuAPI 事件游标断点续传与死空看门狗：`muApiEventStream` 纯函数状态机（`?since=` 游标、事件 id 去重、6 分钟无事件判停滞），远端 job 事件支持增量续拉、会话切换自动重连、RemoteJobCard 手动同步。
- 新增媒体文件存储与孤儿文件 GC：桌面端上传视频/音频改为写入应用数据 media 目录（storagePath 引用，dataUrl 不再进入持久化 JSON）；新增 Rust 命令 `save_media_file` / `list_media_files` / `delete_media_file`；素材库面板新增"清理未引用文件"，按引用计数清理 media/ 与 images/creative-canvas/ 中的孤儿文件并报告释放空间（纯函数 `collectOrphanCreativeFiles` 可测）。
- WebDAV 拉取升级为合并同步：`mergeProjectPackages` 按 id 并集、updatedAt 最新者胜合并工作流画布、素材、画布实例与品牌套件（Agent 会话保持本地），拉取不再整包覆盖；无墓碑机制，删除操作暂无法跨端同步。
- 新增 Local Provider 真实模型工具调用循环：OpenAI 兼容 `tools` + `tool_choice: required→auto` 两阶段循环（`src/services/agentToolLoop.ts`），自然语言驱动 8 个受控工具，工作区快照随消息注入，工具结果与校验失败原因回填给模型自我修正，写操作审批通过后自动续跑；Agent 面板 Local Provider 提供"真实模型工具调用"开关及模型/Base URL/API Key 配置（默认走 Lemon API），未启用时保持本地规则路由和设计计划生成。
- 新增派生素材并排落位：Agent 创建素材或放入创作画布时若省略坐标，自动放在同源素材最右侧实例右边 32px（`computeNextToSourcePosition`），保持源与派生并排可对比。
- 新增创作画布撤销/重做：纯函数历史栈（上限 50 步、拖拽/缩放按 tag 合并、撤销不回退视口），工具栏按钮 + `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` 快捷键，历史仅存内存。
- 新增 Agent 写操作单步回滚：审批执行前捕获素材库 + 创作画布 + 工作流快照，Agent 面板可一键回滚上一次执行并写入 `agent.rollback` 审计事件；回滚仅保留一步，应用重启后失效。
- 新增设计计划成本预估与 DAG 可视化：计划步骤填充 无/低/中/高 成本档位并汇总整单成本，计划卡片按依赖分层横向渲染步骤（`layoutDesignPlanDag` 纯函数 + `DesignPlanDagView` 组件），依赖存在环时给出修正提示。
- 修复验收流水线自引用污染：`verify:release:local` 运行中 MCP 自检会读取磁盘上的上一轮 readiness 报告，上一轮若因任何原因失败会让本轮 `local-mcp` 步骤连带失败并无限循环；`buildReleaseStatus` 与 `read_verification_reports` 现在识别"唯一失败步骤恰为 local-mcp"的自污染报告并豁免 `local-prerelease`/`ready` 判定，MCP 真实健康度仍由本轮全新 MCP 报告独立硬校验（工具数、操作数、无漂移、审批 schema 等不受豁免影响）。
- 方案文档新增"参考项目设计吸收对照与未吸收清单"（`docs/nextlemon-agentic-canvas-enhancement-plan.md` 6.2 节），逐项核对 Open-AI-Design-Agent 与 infinite-canvas 的设计吸收状态。

## 发布验收命令

重新生成 Web 包：

```bash
npm run build
npm run release:web -- --output releases\NextLemon-v0.0.7-web.zip
```

本地可发布验收允许 MuAPI 真实服务暂时阻塞，用于生成 Web 预发布报告：

```bash
npm run verify:release:local -- --json --report releases\agentic-readiness-report.json
```

`verify:release:local` 会自动运行 build 并重新生成 Web zip。

严格发布验收要求真实 MuAPI 远端通过，缺少 API Key 或 chat/job events 证据时必须失败：

```bash
npm run verify:release -- --json --report releases\agentic-readiness-report.json
```

单独验证 MuAPI 真实远端：

```bash
copy .env.example .env.local
# 填写 MUAPI_API_KEY、MUAPI_CHAT_PROBE，并设置 MUAPI_REQUIRE_CHAT=1
npm run verify:muapi:env -- --json --require-real --require-chat --report releases\muapi-env-report.json
npm run verify:muapi -- --json --require-chat --report releases\muapi-real-verification-report.json
npm run verify:muapi:assert-real -- --json --report releases\muapi-real-verification-report.json
```

## 当前未闭环项

- MuAPI 真实远端服务：缺少 `MUAPI_API_KEY`，尚未产生非 localhost 的 account、skills、session、chat 和 job events 调用证据。
- 严格 MuAPI 验收：chat 响应必须返回 job id，且必须成功拉取 job events；必需 endpoint 还必须有 2xx HTTP 状态证据，缺少任一证据时 `verify:release` 不会通过；`verify:muapi` 和 `verify:muapi:assert-real` 都会输出 `strictEvidenceReady`、`evidenceChecklist` 和 `blockingEvidenceIds`，用于定位缺少报告、远端 job、endpoint 2xx、localhost/mock 或脱敏证据。
- 真实报告脱敏：严格 MuAPI 报告必须通过 `verify:muapi:assert-real` 的脱敏扫描，不能包含 API Key、Authorization header、chat 探针原文或敏感字段名。
- MuAPI env 前置检查：`verify:muapi:env` 会输出 `missingEnvKeys`、`failedEnvKeys` 和脱敏状态，placeholder API Key 不会被视为已配置。
- 桌面安装包：当前发布物是 Web zip；Tauri 桌面安装包仍依赖本机 Rust/Cargo 环境完成打包。
- UI 自动化：已有单元测试和构建验证，但素材画布、Agent 面板、品牌模板面板仍需要 Playwright 级别 smoke/e2e 覆盖。
- 同步真实环境：WebDAV 基础服务已实现，仍需要真实 WebDAV 服务、多端同步和冲突处理验收。
- 参考项目设计未吸收项：@提及引用、Agent 执行占位、画布小地图/吸附参考线，已在方案文档 6.2 节列为后续增强路线。
- 桌面端 Rust 命令：本轮新增的 `save_media_file` / `list_media_files` / `delete_media_file` 需要在具备 Rust/Cargo 环境的机器上执行 `npm run tauri build` 打包桌面安装包后生效；Web 包不受影响（媒体入库逻辑有环境守卫）。

## 通过标准

- `npm test` 通过。
- `npm run build` 通过。
- `npm run release:web` 生成 Web zip，并在总体验收报告中记录 SHA-256。
- `npm run verify:local-bridge` 通过，且应用内桥暴露 6 个工具，其中品牌模板读取和品牌规范生成都是只读工具，唯一写工具为 `nextlemon.requestApproval`。
- `npm run verify:mcp` 通过，且 MCP 操作目录与应用内 `CANVAS_AGENT_OP_SPECS` 无漂移，两个审批工具都暴露 15 个 `CanvasAgentOp` 的细粒度 `oneOf` schema，品牌模板工具可读到 5 个模板、5 个 ready 模板、15 个变体、15 个应用后模板摘要、模板能力矩阵、PPT `executive` 变体和视频 `motion-hook` 变体；`nextlemon.create_brand_spec` 必须能为指定品牌、模板和变体生成 100 分品牌规范；`nextlemon.read_verification_reports` 必须能摘要 readiness 中的 `brandSpec.ready`、100 分品牌规范、当前模板 3 个变体、全局 5 ready / 15 variants、模板 ID/变体 ID 分布和本地桥品牌工具状态；总体验收中的 `local-mcp` step 必须结构化记录工具数、操作数、15 个操作类型、操作分类计数、审批 schema oneOf、操作分类、品牌模板 ready/variant 数、MuAPI env/real evidence 状态、发布状态、审批 hash、审批策略和 blocker；MCP 自检期间综合发布状态使用本轮 `currentLocalMcpReport` 摘要，blocker 列表不能包含过期的 `local-mcp` 项；文件型审批请求必须包含 `opCount`、`opSummary`、`operationTypes`、`approvalPolicy` 和 64 位 `requestHash`。
- `npm run brand:spec` 可导出完整品牌规范，且品牌校验分数为 100。
- `npm run verify:brand:templates` 通过，证明内置模板覆盖社媒图、海报、品牌板、PPT、视频封面，并包含交付物、推荐节点、验收标准、模型建议、能力矩阵、5 个 ready 模板和至少 15 个可应用模板变体；品牌规范导出必须包含当前模板 `templateCapability` 和全局 `templateCatalog`。
- `npm run verify:muapi:env -- --require-real --require-chat` 通过真实 MuAPI 前置环境检查。
- `npm run verify:muapi:mock` 通过，只作为适配器合约证明；mock verifier 报告应为 `ok: true` 但 `strictEvidenceReady: false`，且 `blockingEvidenceIds` 包含 `non-localhost-base-url`。
- `npm run verify:muapi:assert-real` 必须基于真实 MuAPI 报告通过，且报告脱敏扫描通过，才算远端 Agent 闭环；失败时 `blockingEvidenceIds` 必须能指出具体阻塞项。
- `npm run verify:release` 通过，才算完整严格发布。
