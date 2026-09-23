# 能力差距收口记录（2026-09-24）

## 1. 背景与范围

本轮按能力差距评估完成 6 个改进包：安全密钥、Agent 会话面板、画布性能交互、PPT 与执行器、Agent 工具与循环、数据与构建。本文逐包记录改动摘要与文件、包内自查、统一门禁结果与完整延后清单。

参考项目设计吸收对照的同步更新（含 skills 端点调用方状态的措辞修正）见 `docs/nextlemon-agentic-canvas-enhancement-plan.md` 第 6.2 节。

说明：本文各包的"包内自查"为各改进包在本运行内执行并上报的记录；第 2 节门禁结果为本次运行统一门禁第 1 轮的执行记录。本文档收尾环节未重新执行这些命令。

## 2. 门禁结果（本次运行统一门禁第 1 轮）

| 门禁项 | 结果 |
| --- | --- |
| test（单测） | 通过 |
| build（构建） | 通过 |
| verify:mcp | 通过 |
| verify:local-bridge | 通过 |
| verify:brand:templates | 通过 |
| verify:release:local | 通过 |
| 密钥扫描 | 通过 |
| 端到端 | 通过 |

结论：第 1 轮全绿，端到端通过。

## 3. 逐包改动记录

### 3.1 安全密钥

改动摘要：

- `src/config/lemonApi.ts:7` 的硬编码密钥 `"cat_768976896896464896"` 默认值改为空字符串并附说明注释。
- 用 grep 在 `src/config/` 全目录（lemonApi.ts、nodeConfig.ts、presetModels.ts、promptConfig.ts）检索 `apikey|api_key|secret|token|password|cat_[0-9]|sk-` 模式，确认无其他硬编码密钥（nodeConfig.ts:91 是 maxTokens 数值、promptConfig.ts:137-146 是 "Victoria's Secret" 提示词模板文案，均为误报）。
- 核实引用方：`llmService.ts:61` 与 `imageService.ts:46` 仅将其作为默认 provider 的 apiKey，空字符串为合法 string，类型安全；当时 agentToolLoop 中对内置密钥的兜底引用按本包任务要求未动，随后由"Agent 工具与循环"包移除（最终代码仅保留 `LEMON_API_CONFIG.baseUrl` 兜底，`agentToolLoop.ts:298`，不再引用内置 apiKey），见 3.5。

涉及文件：

- `src/config/lemonApi.ts`

包内自查：

- grep 配置目录密钥模式检索完成，仅命中上述两处误报。
- 本次改动为同类型字面量替换，无新增纯函数逻辑，未新增单元测试。

延后：无。

### 3.2 Agent 会话面板

改动摘要（5 项全部完成）：

1. `AgentPanel` 以 2 秒周期持续轮询激活 muapi 会话的未完成远端 job（增量事件 + `getJobStatus` 状态），终态 done/error/cancelled 或 6 分钟死空停滞时自动清理定时器；原 :276-285 的单次续拉 effect 被该循环取代。
2. 新增恢复逻辑：应用加载/切回 muapi 会话时经 `listSessionJobs` 查询服务端 pending/processing 任务并对齐 metadata；适配器新增导出 `listMuApiSessionJobs` / `fetchMuApiJobStatus` / `findActiveMuApiJob`（`muApiAgentAdapter.ts:989-1007`），使原零调用方的两个方法有了调用方。
3. job 终态后 RemoteJobCard 收敛为摘要+同步（隐藏批准/拒绝/取消）；`approval_required` 事件在后续批准/拒绝/取消 `tool_result` 或任务终态到达后收敛为已解决徽标。
4. text 分支与助手消息内容改用 react-markdown 渲染（`skipHtml` 禁用原始 HTML）。
5. `agentStore` 新增 `renameSession`（会话列表双击/铅笔图标行内编辑），`lastRollback` 单槽改为 3 步内存环形历史（保留 `lastRollback` 兼容字段供范围外 canvasAgentRuntime 读取），回滚弹出最近一步。

涉及文件：

- `src/components/agent/AgentPanel.tsx`
- `src/stores/agentStore.ts`
- `src/services/muApiAgentAdapter.ts`
- `src/services/muApiEventStream.ts`
- `src/services/muApiJobRecovery.ts`（新增）
- `src/services/__tests__/muApiEventStream.test.ts`
- `src/services/__tests__/muApiAgentAdapter.test.ts`
- `src/services/__tests__/agentStore.test.ts`（新增）

包内自查：

- node 直调本地 `tsc --noEmit`：本包改动文件 0 错误。
- node 直调本地 vitest 跑改动相关 3 个测试文件：23 passed；既有 agentToolLoop/agentRollback/agentOps 测试 19 passed，无回归。

延后：无。

### 3.3 画布性能交互

改动摘要（5 项全部完成）：

1. `CreativeWorkspace.tsx:474-578` 指针拖拽/视口更新改为 requestAnimationFrame 合帧（同帧只应用最后一次坐标，pointerup 前同步 flush 待应用坐标）。
2. `CreativeWorkspace.tsx:615-647,676-687` 实现按住空格与鼠标中键平移（不改变选区、阻止中键自动滚动、文本输入控件内空格不受影响）。
3. `tauriStorage.ts` 新增 `createDebouncedSaver`（:26）：Tauri 路径 store.set 立即生效但 save() 落盘按 300ms 防抖合并，并在 visibilitychange(hidden)/pagehide/beforeunload 时 flush；浏览器 localStorage 路径保持同步写。
4. `CreativeCanvasMinimap` 改为 pointerdown/move/up 拖拽取景（setPointerCapture 支持 svg 外拖拽，stopPropagation 避免误触画布平移）。
5. 新建 `src/utils/mediaLoadStrategy.ts`（cors→direct→failed 阶段机 + `useResilientMedia` hook）：先带 crossOrigin=anonymous 加载、onError 去 CORS 重试、视频/音频加 8s 超时兜底；已接入 CreativeWorkspace 画布 item 与 CreativeAssetLibrary 缩略图/预览。

涉及文件：

- `src/utils/tauriStorage.ts`
- `src/utils/mediaLoadStrategy.ts`（新增）
- `src/components/creative/CreativeWorkspace.tsx`
- `src/components/creative/CreativeCanvasMinimap.tsx`
- `src/components/creative/CreativeAssetLibrary.tsx`
- `src/services/__tests__/tauriStorage.test.ts`（新增）
- `src/services/__tests__/mediaLoadStrategy.test.ts`（新增）

包内自查：

- vitest 定向运行新增 2 个测试文件 11 例，含相邻回归共 22/22 通过。
- `tsc --noEmit` 本包改动文件零错误。

延后：无。

### 3.4 PPT 与执行器

改动摘要（4 项全部完成）：

1. `usePPTContentExecution.startGeneration` 改用新纯函数 `mapWithConcurrency` 信号量并发（`PPT_PAGE_MAX_PARALLEL=3`，逐镜像 workflowEngine.executeLayer:459-514 的主循环占位模式），并修复了首版"任务体内计数导致同步循环全部放行"的并发漏洞。
2. `PageItemRow.tsx` 正式解构 `onSkip`（删除 `_onSkip`/void 占位）并在 pending 页渲染跳过按钮，接通 index.tsx:311 → PagesTab.tsx:207 → `skipPage` 链路。
3. `nodeExecutor.ts` 的 `executePPTContentNode`（:593 起）移除硬编码拒绝，实现两阶段自动执行——大纲未就绪时走与手动按钮相同的 generateText + buildSystemPrompt + PPT_OUTLINE_JSON_SCHEMA + parseOutlineContent 路径，随后逐页走与手动按钮相同的 editImage + buildPageImagePrompt 路径（信号量并发 ≤3、画布感知读写、保存/缩略图/取消处理齐全），成功返回 output、失败返回既有 `{success:false,error}` 结构。
4. `getConnectedInputDataFromCanvas` 两条画布读取路径统一经 `finalizeGenerationInput`（:189）还原 `@[asset_N]`：命中图片素材按出现顺序追加为图片参考输入（storagePath 优先、dataUrl 回退），并把 token 替换为【图1】【图2】式引用；无命中行为不变。

涉及文件：

- `src/components/nodes/PPTContentNode/executionCore.ts`（新增：并发/大纲解析/提及还原纯函数）
- `src/components/nodes/PPTContentNode/usePPTContentExecution.ts`
- `src/components/nodes/PPTContentNode/PageItemRow.tsx`
- `src/services/nodeExecutor.ts`
- `src/services/__tests__/pptExecutionCore.test.ts`（新增：16 个用例）

包内自查：

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 退出码 0（strict + noUnusedLocals）。
- `node node_modules/vitest/vitest.mjs run src/services/__tests__/pptExecutionCore.test.ts` 16/16 通过（并发上限、顺序保持、大纲解析、提及还原/回退等）。
- 按铁律未运行完整测试套件/构建/e2e，由统一门禁执行（第 1 轮全绿）。

延后：

- 评估中的"pptOutline 节点"：代码库不存在独立 pptOutlineNode 类型（全仓 grep 无结果，`src/types/workflow.ts:45` 的 EXECUTABLE_NODE_TYPES 仅含 pptContentNode 等 5 类），按 pptContentNode 的大纲阶段实现，与评估引用的 nodeExecutor 大纲检查位置一致。
- `@[asset_N]` 还原仅接入工作流自动执行的输入组装（nodeExecutor）；手动按钮路径走 flowStore.getConnectedInputData，不在本包可编辑范围，未改动。
- PPTAssemblerNode/index.tsx 未改动（4 项任务均不涉及，仅处于允许范围）。

### 3.5 Agent 工具与循环

改动摘要：

- 任务 1：`agentToolLoop.ts:298` 起不再回退 `LEMON_API_CONFIG.apiKey`；无可用密钥时 `runAgentToolLoop` 立即中止本轮、向会话写入「请在 Agent 面板配置 API Key」提示消息并返回错误（`callAgentChat` 亦加同闸门）。
- 任务 2：`canvasAgentRuntime` 新增 `generate_image_flow` 组合工具（入参 prompt + 可选参考素材，内部展开为「提示词素材 → 提示词节点 → 生成节点 → 连线 → 触发运行」共 5 个既有受控 op，复用 `validateCanvasAgentOpsAgainstState` 与审批路径，不新增 op 类型），并加入 loop 工具 schema 与系统提示词。
- 任务 4：新建 `promptMarketService.ts`（GitHub 清单拉取、1 小时内存缓存、并发去重、任何失败静默回退内置库）；Sidebar 提示词面板新增「在线提示词」入口与刷新按钮。
- 任务 3（MCP 侧暴露 generate_image_flow）按自检结论降级为仅应用内侧，见延后。
- 补齐 3 个测试文件，并用本地 tsc 全量类型自查确认本包文件 0 错误。

涉及文件：

- `src/services/agentToolLoop.ts`
- `src/services/canvasAgentRuntime.ts`
- `src/services/promptMarketService.ts`（新增）
- `src/components/Sidebar.tsx`
- `src/services/__tests__/agentToolLoop.test.ts`
- `src/services/__tests__/generateImageFlow.test.ts`（新增）
- `src/services/__tests__/promptMarketService.test.ts`（新增）

包内自查：

- 本地 tsc 全量类型自查（`node node_modules/typescript/bin/tsc --noEmit`）：本包文件 0 错误。
- 基线 `node ./scripts/verify-local-mcp.mjs`：全部 13 步通过，确认不改 MCP 脚本时自检保持绿色。

延后：

- 任务 3（MCP 侧暴露 generate_image_flow）：自检链路把本地 MCP 工具数钉死为 11——`scripts/verify-agentic-readiness.mjs:466` 的 `report?.toolCount === 11`、`scripts/verify-local-mcp.mjs:538` 的 `readinessLocalMcp.toolCount === 11`，且已提交的 `releases/agentic-readiness-report.json` 与 `local-mcp-verification-report.json` 同样记录 11；这两个脚本与报告均不在本包可编辑范围，新增第 12 个工具后下次重新生成 readiness 报告时 `npm run verify:mcp` 的 reports 步骤必然失败。按任务指示仅保留应用内循环侧（组合工具不新增 CanvasAgentOp 类型，op 目录防漂移检查不受影响）。

### 3.6 数据与构建

改动摘要：

- 修正 `webDavSyncService.ts:66-69` 与 `projectPackageService.ts:247-252` 的墓碑注释，使其与 `applyTombstones` 实现（projectPackageService.ts:361）一致。
- 工作流画布合并升级为节点/边级（`mergeWorkflowCanvases` :409 起 + `mergeCanvasNodesAndEdges` :446）：按 id 并集、同 id 冲突以所在画布 updatedAt 新者为准、端点缺失的悬挂边丢弃；按现有 mergeById 测试风格新增 2 个场景单测。
- `creativeAutoSink` 重写为按精确 assetId/itemId 追踪占位（素材附加节点专属标签 `auto-sink-node:${nodeId}` 支持重启后回收），`addAssetToCanvas` 失败时回收素材，无法精确匹配时跳过删除而非模糊匹配；导出纯函数 `resolveAutoSinkPlaceholder` 并补充单测与真实 store 集成测试。
- `vite.config.ts` 新增 manualChunks（:63 起）拆分 react/react-dom、@xyflow、markdown 生态、pptxgenjs、@google/genai，并将 creativeStore 独立成块以消除其静态+动态混合导入导致的分割失效告警。

涉及文件：

- `src/services/webDavSyncService.ts`
- `src/services/projectPackageService.ts`
- `src/services/creativeAutoSink.ts`
- `vite.config.ts`
- `src/services/__tests__/projectPackageService.test.ts`
- `src/services/__tests__/creativeAutoSink.test.ts`（新增）

包内自查：

- 本包铁律禁止运行 git/npm 命令，未运行 vite build / vitest / tsc；类型正确性为人工自查（CustomEdge/Edge 含 id/source/target/label，CustomNode 为 Node&lt;CustomNodeData&gt;），非 tsc 实测。
- 新增测试与分包效果（含既有 projectPackageService 测试回归、creativeAutoSink 集成测试）由统一门禁执行验证（第 1 轮全绿）。

延后：

- `creativeStore` 双重导入的根因修复（`creativeAssetService.ts:190` 的 `await import("@/stores/creativeStore")` 改为静态导入）：creativeAssetService.ts 不在本包允许编辑范围内，已通过 vite.config.ts manualChunks 将 creativeStore 独立成块作为范围内缓解。
- 构建产物 chunk 体积与告警消除的实测验证未在本包内执行（见包内自查），以统一门禁构建结果为准。

## 4. 完整延后清单及延后原因

### 4.1 运行级明确延后

| # | 延后项 | 原因 |
| --- | --- | --- |
| 1 | 本地 Agent/MCP 桥的 SSE 实时双向通道 | 需常驻本地服务，跨 TS/Rust/协议三层，单次运行无法验证 |
| 2 | 双引擎本地 Agent 会话（Codex app-server / Claude Code stream-json 子进程对接） | 单次运行无法完成子进程对接与验证 |
| 3 | 节点级图片编辑工具链（反推提示词/裁剪/九宫格拆分/放大超分/通用局部重绘） | 功能面大，超出本轮包范围 |
| 4 | 批量图组折叠栈与生成节点多图张数参数 | 需新数据结构 + 整套交互 |
| 5 | WebDAV 媒体文件差量同步 | 需 Rust 端配合与协议设计 |
| 6 | 画布视口外实例裁剪渲染 | 本轮未排入 |
| 7 | PPT 组装节点后端协作取消 | 需 Rust 侧取消令牌 |
| 8 | `src-tauri/src/storage.rs` 文件命令路径白名单 | 本机无 cargo，无法编译验证；不推送未验证的 Rust 代码，留待有 Rust 工具链时处理 |
| 9 | 嵌入模式（embed code 分发）、URL 深链握手、首页会话卡片马赛克预览 | 应用当前无首页结构，属产品级新功能 |
| 10 | Skills 专家工作流 UI、会话消息快照回写服务端、密钥服务端保管/Tauri 安全存储 | 依赖远端 MuAPI 真实验收，当前 blocked |

### 4.2 包级延后与口径澄清

| # | 延后项 | 原因 |
| --- | --- | --- |
| 11 | MCP 侧暴露 `generate_image_flow` | readiness 脚本把本地 MCP 工具数钉死为 11（`scripts/verify-agentic-readiness.mjs:466`、`scripts/verify-local-mcp.mjs:538`），已提交报告同样记录 11；脚本与报告不在包可编辑范围，贸然新增工具会使 `npm run verify:mcp` reports 步骤失败。已运行基线 `node ./scripts/verify-local-mcp.mjs` 全部 13 步通过 |
| 12 | `@[asset_N]` 还原接入手动按钮路径 | 手动按钮走 `flowStore.getConnectedInputData`，不在 PPT 包可编辑范围；本轮仅接入工作流自动执行输入组装（nodeExecutor） |
| 13 | `creativeStore` 双重导入根因修复（`creativeAssetService.ts:190` 改静态导入） | creativeAssetService.ts 不在包允许编辑范围；以 vite manualChunks 将 creativeStore 独立分包作为范围内缓解 |
| 14 | 独立 `pptOutlineNode` 节点类型 | 代码库不存在该类型（全仓 grep 无结果，`src/types/workflow.ts:45` EXECUTABLE_NODE_TYPES 仅含 pptContentNode 等 5 类）；按 pptContentNode 的大纲阶段实现 |
| 15 | PPTAssemblerNode/index.tsx 改动 | 4 项任务均不涉及，虽在允许范围内但未改动 |

## 5. 边界说明

- 本文档为收尾记录：第 3 节包内自查与第 2 节门禁结果均为本运行内的执行记录，收尾环节未重跑。
- Skills 端点现状（与 plan 文档 6.2 节修正一致）：`muApiAgentAdapter.ts:222,226,232` 已实现 `agent-skills` / `run-skill` / `account/balance` 端点，但仅 `listAgentSkills`、`getAccountBalance` 被适配器内验证流程调用（:349-350），`runSkill` 无任何调用方；应用内未接入 Skills UI 或工具循环。
- 默认 API Key 已置空（`src/config/lemonApi.ts:7`），Agent 工具循环在无密钥时中止并提示（`agentToolLoop.ts:291` 起的 `AGENT_MISSING_API_KEY_MESSAGE` 与 ：392 安全闸门），不再回退任何内置密钥。
