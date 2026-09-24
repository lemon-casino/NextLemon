# 能力差距收口记录（2026-09-24）

## 1. 背景与范围

本轮按能力差距评估完成 6 个改进包：安全密钥、Agent 会话面板、画布性能交互、PPT 与执行器、Agent 工具与循环、数据与构建。本文逐包记录改动摘要与文件、包内自查、统一门禁结果与完整延后清单。

同日第二批运行按评估的「未覆盖清单」再完成 8 个改进包：实时桥、Rust 加固、Agent 面板扩展、最近项目与深链、画布裁剪与批量栈、生成参数与 PPT 取消、图片编辑工具链、WebDAV 媒体同步（见 3.7–3.14）。第 4.1 节运行级延后清单已按第二批结果复核更新：已实现的标记为完成并指向对应小节，未做的保留原因。

参考项目设计吸收对照的同步更新（含 skills 端点调用方状态的措辞修正与第二批回填）见 `docs/nextlemon-agentic-canvas-enhancement-plan.md` 第 6.2 节。

说明：本文各包的"包内自查"为各改进包在本运行内执行并上报的记录；第 2 节与第 2.1 节门禁结果分别为第一、第二批运行统一门禁第 1 轮的执行记录（由各运行提供）。本文档收尾环节未重新执行这些命令。

## 2. 门禁结果（第一批运行统一门禁第 1 轮）

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

### 2.1 第二批运行统一门禁第 1 轮

| 门禁项 | 结果 |
| --- | --- |
| node --check（新增桥脚本语法检查） | 通过 |
| test（单测） | 通过 |
| build（构建） | 通过 |
| verify:mcp | 通过 |
| verify:local-bridge | 通过 |
| verify:brand:templates | 通过 |
| verify:release:local | 通过 |
| 密钥扫描 | 通过 |
| 端到端 | 通过 |

结论：第二批第 1 轮全绿，端到端通过。Rust 改动不在门禁覆盖范围内（本机无 cargo，见 3.8 延后），需桌面端 CI 构建确认。

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

### 3.7 实时桥（本地 Agent/MCP 桥的 SSE 实时双向通道）

改动摘要：

- 新建 `scripts/nextlemon-agent-bridge.mjs`：零依赖本地实时桥 hub，仅绑定 127.0.0.1 的 SSE hub，支持 page/agent 双通道转发 snapshot/tool-call/tool-result/approval、心跳 keep-alive、断线清理、requestId 配对、全路由 token 校验与 localhost-only CORS；`--port`/`--token` 及环境变量可配，`node --check` 通过。
- 新建 `src/services/agentRealtimeBridge.ts`：EventSource 连接 hub；tool-call 走 `window.nextlemonAgentBridge` 同源的受控执行路径——写操作仅经 `requestLocalAgentBridgeApproval` 审批队列（`agentRealtimeBridge.ts:7,20,224`），绝不直接执行；定期上报画布/会话摘要快照；指数退避重连；`useSyncExternalStore` 状态源（:234 起）。
- `LocalAgentBridgePanel` 增加实时桥状态（连接状态/端口/token 掩码/复制启动命令/自动连接开关/重连）；`LocalAgentBridgeRuntime` 在桥启用时按配置自动连接、配置变更时重连。
- `package.json` 新增 `bridge:local` 启动脚本（`package.json:26`）。
- hub 纯函数（CLI 解析/token 校验/角色路由/requestId 配对）与页面侧解析入 `src/services/__tests__/agentRealtimeBridge.test.ts`。

涉及文件：

- `scripts/nextlemon-agent-bridge.mjs`（新增）
- `src/services/agentRealtimeBridge.ts`（新增）
- `src/components/agent/LocalAgentBridgePanel.tsx`
- `src/components/agent/LocalAgentBridgeRuntime.tsx`
- `package.json`
- `src/services/__tests__/agentRealtimeBridge.test.ts`（新增）

包内自查：

- `node --check` 通过；本文件单测 17 例通过；全量 vitest 350/350 通过；hub 真实起服的 12 项端到端冒烟全部通过。

延后：

- 跨包契约中的 5 个 Tauri 命令与 `agentStore.createSessionFromBrief` 本包 4 项任务均不需要（写操作经审批队列自建本地会话，进程/PPT 命令属其他包职责），不引入无用耦合。
- 任务 2 的"token/端口从现有桥配置读取"降级为新增 localStorage 配置键 `nextlemon-agent-realtime-bridge`（`agentRealtimeBridge.ts:31`，默认端口 8765、默认 token 与 hub 一致，面板可改）：现有桥配置（localAgentBridgeStore）不含端口/token 且文件不在本包可编辑范围，属降级实现而非缺口。
- EventSource 无法携带自定义请求头，`GET /events` 在 `x-bridge-token` 头之外等价接受 token 查询参数（hub 与代码注释均已标注），其余 POST 路由仍只认请求头。

### 3.8 Rust 加固（路径白名单 / PPT 取消注册表 / 引擎子进程）

改动摘要（5 项全部完成）：

- `storage.rs`：`read_image`/`delete_image` 增加 `AppHandle` 并按 `delete_media_file` 的 `starts_with` 模式限定应用数据目录；新增 `sanitize_canvas_id`（`storage.rs:104`，拒绝空串/路径分隔符/`.`/`..`/空字符），应用于 `save_image`/`delete_canvas_images`/`list_canvas_images` 三处拼接点（:147,235,385）；新增 media 目录白名单的 `read_media_file`（:644）。
- `ocr_inpaint.rs`：新增静态 `Mutex<Option<HashMap<String, Arc<AtomicBool>>>>` 取消注册表与 `cancel_ppt_assembly` 命令（:163）；`process_ppt_page` 每次调用（即前端分页循环的每次迭代）在 OCR 前与进入修复前各检查一次 cancel token，命中即返回 `cancelled: true` 的结构化结果。
- 新建 `agent_process.rs`：`spawn_agent_process`（`std::process::Command`，stdin 句柄托管于 Mutex 注册表，stdout/stderr 按行读出经 `app_handle.emit("agent-engine-event", { processId, data })` 推送（:77），stderr 加 `[stderr]` 前缀防管道阻塞）与 `kill_agent_process`（关 stdin → kill → wait 并回收，:155）。
- 四个命令全部在 `lib.rs` invoke_handler 注册（`lib.rs:41-44`）。
- 与已落地的 TS 消费端逐一核对签名一致：`agentEngines.ts:136-163`、`imageEditService.ts:372-375`、`mediaSyncService.ts:268-274`、`generation.ts:9,82`。

涉及文件：

- `src-tauri/src/storage.rs`
- `src-tauri/src/ocr_inpaint.rs`
- `src-tauri/src/agent_process.rs`（新增）
- `src-tauri/src/lib.rs`

包内自查：

- 新增 8 个 `#[cfg(test)]` 单测（`sanitize_canvas_id` 5 个、取消标志 2 个、注册表 1 个，如 `storage.rs:660-687`）。

延后：

- **无法执行 `cargo check`/`cargo test`：本机无 cargo/rustc**（已运行 `cargo --version` 与 `rustc --version` 确认 command not found），编译验证未做。已按保守写法替代：仅复用仓库既有模式（Emitter 用法同 stream_helper.rs、命令签名同 storage.rs、const 静态注册表用 `Mutex::new(None)` 包裹以规避 `HashMap::new` 非 const 问题），未引入任何新依赖。**需桌面端 CI 构建确认。**

### 3.9 Agent 面板扩展（双引擎会话 / Skills UI / 快照回写 / 会话级密钥）

改动摘要：

- 新建 `src/services/agentEngines.ts`：Codex（`exec --json` 旧/新形态 + app-server JSON-RPC 通知）与 Claude Code（stream-json）两个 CLI 适配器，按行解析为 Agent 事件（失败降级 raw 行）；经契约命令 `spawn_agent_process`/`kill_agent_process`（`agentEngines.ts:207-230,182-183`）与事件 `agent-engine-event`（:189-191）驱动回合；线程绑定会话 `metadata.engineCwd`（回退 Provider 配置、再回退用户主目录）；内含 Skills 规范化/必填输入映射与 muapi 快照回写负载纯函数。
- `AgentPanel` 的 Local Provider 增加四选引擎（本地规则/模型工具循环/Codex/Claude Code）与可执行文件路径、工作目录、`--model` 配置；引擎输出映射为会话事件并在 metadata 记录 `engineSessionId`/`engineProcessId`（`AgentPanel.tsx:462,481`）。
- muapi 技能经 `listAgentSkills` 拉取为输入区上方可钉选 chip（`AgentPanel.tsx:390-403`），钉选后一句话发起自动映射必填输入并切换 `runSkill` 端点（:543-588）。
- muapi 会话任务到达终态后调用 `updateSession`（PATCH）回写消息快照（:420,600-608），失败静默记入事件流。
- `agentStore` 导出契约函数 `createSessionFromBrief`（:35,161：建会话 + 写首条用户消息 + 返回 id）；新增「仅本会话保存 API Key」开关，勾选 provider 的 apiKey 经 `stripSessionOnlyProviderApiKeys` 不进 partialize 持久化（:403,415），内存保留、刷新即清。

涉及文件：

- `src/services/agentEngines.ts`（新增）
- `src/services/__tests__/agentEngines.test.ts`（新增，38 个用例）
- `src/types/agent.ts`
- `src/stores/agentStore.ts`
- `src/components/agent/AgentPanel.tsx`

包内自查：

- agentEngines.test.ts 38 个用例通过（运行内上报）。

延后：

- Codex/Claude CLI 实机联调未做：本机无这两个 CLI，解析与启动参数按官方公开协议格式最佳实现，实际子进程行为（尤其 codex exec resume 参数位置、claude --resume 行为）待跨包联调验证。
- 契约中的 `cancel_ppt_assembly` 与 `read_media_file` 分别属 PPT 管线包与媒体包职责，Agent 面板包无对应场景，未消费。

### 3.10 最近项目与深链

改动摘要：

- 新建 `src/components/RecentProjectsPanel.tsx` 浮层：从 `agentStore.sessions` + `creativeStore.assets` 聚合最近项目；卡片用会话关联图片素材的 2×2 马赛克封面（不足 4 张用渐变占位补齐），显示标题/相对时间/素材数；点击卡片经现有 API（`setActiveSession` + `setMode("creative")`）回访会话；导出纯函数 `collectSessionAssets`/`collectRecentProjects`/`buildCoverTiles`/`formatRelativeTime`。
- 入口：Sidebar 图标轨新增「最近项目」按钮（受控开关，`Sidebar.tsx:320-336`），浮层由 App 常驻渲染（`App.tsx:271`）。
- `App.tsx` 实现 `?q=` 深链幂等消费：agentStore hydration 完成后解析 `location.search`，宽松调用契约方法 `createSessionFromBrief`（暂缺时回退 `createSession`+`addMessage` 等价组合），随后 `history.replaceState` 清参，模块级 flag 保证只消费一次（`App.tsx:27,45-52,141`）。
- 未修改 agentStore/creativeStore/工作流/创作画布/src-tauri 任何文件。

涉及文件：

- `src/components/RecentProjectsPanel.tsx`（新增）
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/services/__tests__/recentProjects.test.ts`（新增，17 个用例）

包内自查：

- `npx vitest run src/services/__tests__/recentProjects.test.ts` 17/17 通过；`npx tsc --noEmit` 本包改动 4 文件 0 错误（现存 19 行错误均在范围外的并行同事文件）。

延后：

- `recentProjects.css` 未创建：马赛克网格、占位渐变与浮层全部用现有 tailwind 工具类实现，无自定义样式需求（任务标注「如需」）。
- Tauri `onOpenUrl` 未接入：`src-tauri/Cargo.toml` 与 `package.json` 均无 deep-link 插件依赖，按任务要求只做 web 侧消费，接入方式已在 `App.tsx` `consumeBriefFromUrl` 注释中说明。
- 会话-资产显式关联字段当前不存在（两 store 均未写入 sessionId/assetIds）：面板采用只读启发式关联（`session.metadata.assetIds` → `asset.metadata.sessionId` → agent 来源 + 60s 活跃窗口兜底），未改动 store 本体；未来并行包写入显式字段后自动优先生效。

### 3.11 画布裁剪与批量栈

改动摘要：

- 视口裁剪：新增纯函数 `isItemVisibleInViewport`（约 200 屏幕像素缓冲、按 zoom 换算），`CreativeCanvasSurface` 用 ResizeObserver 跟踪容器尺寸后只渲染视口内实例（`CreativeWorkspace.tsx:525`），选中/拖拽中实例强制保留；store 数据保持全量（框选/导出/小地图仍读全量），与既有 rAF 合帧、空格/中键平移、锁定/隐藏交互兼容。
- 批量栈：`CreativeCanvasItem` 声明在范围外的 `types/creative.ts`，按任务允许的"等价设计"在 `types/index.ts` 用 `declare module` 扩充 `isBatchRoot`/`batchChildIds`/`parentBatchRootId`/`batchExpanded` 可选字段；store 新增多图落位契约入口 `addImageBatchToCanvas(images[])`/`addAssetBatchToCanvas(assetIds[])`（`creativeStore.ts:53,55,574,586`）与 `setBatchExpanded`（:57,604，展开为主图原位起算的网格/收起叠放）；`moveItem` 主图拖动整体跟随；`removeItems`/`removeAssets` 删除子图自动重选主图、删除主图自动晋升首个存活子图；主图 zIndex 置顶保证折叠态导出由主图覆盖子图（导出服务零改动即兼容）。
- 修复一个派生 bug：主图拖动时排除自身子图参与吸附，否则会被跟随中的子图参考线吸住无法拖动。

涉及文件：

- `src/types/index.ts`
- `src/stores/creativeStore.ts`
- `src/components/creative/CreativeWorkspace.tsx`
- `src/services/__tests__/creativeBatchStack.test.ts`（新增）

包内自查：

- 定向验证（运行内上报）；铁律禁止 npm 命令，全量 test/build 由统一门禁执行（第 1 轮全绿）。

延后：

- `creativeAutoSink.ts`（范围外只读）现有的逐张 `addAssetToCanvas` 落位未切换为建栈：按契约由生成参数包改传 images 数组后调用新入口 `addImageBatchToCanvas` 即自动折叠成栈，本包不改对方文件。

### 3.12 生成参数与 PPT 取消

改动摘要：

- 新建 `src/types/generation.ts`：张数参数（`ImageCount`、`normalizeImageCount` :66、`planImageCountRequests` :81）与 PPT 取消纯函数（`createAssemblyCancelToken` :94、`buildAssemblyCancelMessage` :105）。
- `imageService` 为 `generateImage`/`editImage` 增加张数：`n` 直传分支已实现（candidateCount），当前三条通道均不支持 n（`IMAGE_GEN_UPSTREAM_SUPPORTS_N = false`，`imageService.ts:24`），故按张数拆分请求并复用 `mapWithConcurrency` 的 ≤3 信号量（:535），聚合返回 images 数组（imageData 兼容首图）。
- `ImageGeneratorNode` 属性面板新增 1-4 张数选择并处理多图落盘/展示；`nodeExecutor` 透传 count，在节点数据（outputImages/outputImagePaths/outputCount）与执行结果（output.images/imagePaths）产出 images 数组供画布批量栈落位。
- `PPTAssemblerNode` 停止按钮改为生成随机取消 token 随任务保存（`index.tsx:231`）、停止时 `invoke("cancel_ppt_assembly", { token })`（宽松对象参数+契约注释，:100,489；Rust 缺失时回退本地停止），返回 `{ cancelled: true }` 时以「已取消，已完成 N 页」提示。

涉及文件：

- `src/types/generation.ts`（新增）
- `src/services/imageService.ts`
- `src/services/nodeExecutor.ts`
- `src/components/nodes/ImageGeneratorNode.tsx`
- `src/components/nodes/PPTAssemblerNode/index.tsx`
- `src/services/__tests__/generation.test.ts`（新增）
- `src/services/__tests__/imageGenerationCount.test.ts`（新增）
- `src/services/__tests__/nodeExecutorImageCount.test.ts`（新增）

包内自查：

- node 直调本地 `tsc --noEmit` 通过（EXIT=0）；新增 3 个测试文件 20/20 通过，相关既有 5 个测试文件 47/47 通过（均以 node 直调 vitest 运行，未使用 npm/git）。

延后：

- 画布批量图组折叠栈渲染本身按契约为画布包职责（见 3.11），本包只产出 images 数组；`workflowAssetService.createCreativeAssetDraftsFromWorkflowNode` 目前仍读单图字段（outputImage/outputImagePath），该文件不在本包范围，需画布包按新数组字段接线。
- 「n 直传」分支当前不可达：Google generateContent 图片模型仅单候选、Lemon 流式 chat 无 n、Tauri 代理契约参数固定，故 `IMAGE_GEN_UPSTREAM_SUPPORTS_N=false`；分支与 `planImageCountRequests` 已实现并有单测，上游支持后翻转开关即生效。
- PPTAssembler 组件级 UI 测试未补：仓库无组件测试设施（无 testing-library/jsdom，vitest 为 node 环境），取消文案与 token 生成已以纯函数单测覆盖。

### 3.13 图片编辑工具链

改动摘要：

- 新建 `src/services/imageEditService.ts`：裁剪/旋转/九宫格/尺寸格式导出的 canvas 实现全部下沉为可单测纯函数（`computeCropRect`、`computeRotatedSize`、`computeGridSlices`、`computeResizedSize`、`pickClosestAspectRatio`、dataUrl/base64 工具）；放大走既有 `imageService.editImage` img2img 通道、反推词走 `llmService.generateText` 视觉输入、局部重绘转发 `ocrInpaintService`（`imageEditService.ts:700`）；支持 dataUrl/http/本地路径（`read_image` 失败回退跨包契约 `read_media_file`）的输入归一化。
- `ocrInpaintService` 泛化：新增通用入口 `inpaintRegion`（mask+prompt→inpaint，`ocrInpaintService.ts:97`），优先调用契约命令 `inpaint_region`（宽松对象参数+注释；Rust 侧 invoke_handler 尚未注册该命令，:93 注释已标注），缺失/失败时回退直连 IOPaint HTTP API（请求/响应格式与 `src-tauri/src/ocr_inpaint.rs` 的 `call_inpaint_service` 一致，:124,137）；PPT 既有导出全部未动。
- 新建 `src/components/creative/ImageDetailModal.tsx`（现存同名组件在 ui/ 下且不在允许范围，此为新建）：裁剪框选/旋转/九宫格/尺寸导出/放大/反推词/局部重绘画笔工具条；产出经 `creativeStore.addAsset` 入素材库（Tauri 下落盘 creative-canvas）、可选落画布；所有失败均 toast 明确错误。

涉及文件：

- `src/services/imageEditService.ts`（新增）
- `src/services/ocrInpaintService.ts`（新增通用 `inpaintRegion` 入口，既有 PPT 导出未动）
- `src/components/creative/ImageDetailModal.tsx`（新建）
- `src/services/__tests__/imageEditService.test.ts`（新增，39 用例）

包内自查：

- `node node_modules/vitest/vitest.mjs run src/services/__tests__/imageEditService.test.ts` 39/39 通过；整个 `__tests__` 目录 36 文件 350 用例全过；`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 本包 4 个文件零错误（现存报错均在范围外既有文件）。

延后：

- 编辑工具条的挂载接线：`CreativeAssetLibrary.tsx`/`CreativeWorkspace.tsx` 在允许范围外（只读），新弹窗组件已交付但未接入预览入口；接入方需在素材卡片/预览弹窗处挂载 `ImageDetailModal` 并传入 asset（可选 `onPlaceAssets` 自定义多图落位）。
- 通用局部重绘的 Rust 命令 `inpaint_region` 不在本次跨包契约清单中：TS 侧已按契约注释以宽松对象参数调用，且命令缺失时自动回退直连 IOPaint HTTP，功能不阻塞于该命令落地。

### 3.14 WebDAV 媒体同步

改动摘要：

- 新建 `src/services/mediaSyncService.ts`：按契约 `invoke("read_media_file")` 读素材媒体字节，WebCrypto sha-256 作内容 key，固定并发 3 上传 PUT 到 `/media/<sha256>.<ext>`（PROPFIND+长度一致则跳过）；远端 mediaManifest 有而本地缺的按 key GET 并经既有 `save_media_file` 写回并重写素材 storagePath；全程 `onProgress` 回调；浏览器环境自动降级。
- `webDavSyncService` 暴露通用 `webDavRequest`（PUT/GET/PROPFIND，:102）与媒体目录 URL 构造；既有单 JSON 同步行为与状态机不变；上传前差量同步并把 mediaManifest（sha/ext/bytes/originPaths）合入包 JSON；导入/合并后触发缺失回填（结果追加进 warnings）。
- `projectPackageService` 增加可选 mediaManifest 字段（schemaVersion 1 兼容扩展，`projectPackageService.ts:33-35,107`）与按 sha256 的清单合并（:341,376）。
- `ProjectPackagePanel` 加「同步媒体文件」开关、分阶段进度显示、浏览器降级说明；文件导入也触发回填。

涉及文件：

- `src/services/mediaSyncService.ts`（新增）
- `src/services/webDavSyncService.ts`
- `src/services/projectPackageService.ts`
- `src/components/creative/ProjectPackagePanel.tsx`
- `src/services/__tests__/mediaSyncService.test.ts`（新增）

包内自查：

- `npx tsc --noEmit` 范围内文件 0 错误（仓库另有 14 行既有错误均在范围外文件）；`npx vitest run mediaSyncService.test.ts projectPackageService.test.ts` 32/32 通过——两项为只读自检，统一门禁仍复跑（第 1 轮全绿）。

延后：

- `projectPackageService` 内私有的 `mergeMediaManifests` 未直接单测：其测试文件 `projectPackageService.test.ts` 不在可编辑范围；manifest diff、key 计算、并发、PROPFIND 解析等核心纯函数已在 `mediaSyncService.test.ts` 覆盖（20 个用例）。
- `syncMedia` 开关以宽松对象写入 `WebDavSyncConfig`（契约字段，`types/projectPackage.ts` 范围外只读，已注释标注）；若类型包最终字段名不同需对齐一处。
- `read_media_file` Rust 命令按跨包契约以宽松对象消费，本环境无法验证 Rust 侧实际实现；若命令缺失则单条媒体计失败并记 warnings，不阻塞 JSON 同步。
- 上传接口返回值保持 boolean，媒体汇总经进度回调与回填 warnings 呈现，未扩展返回结构以避免波及调用方。

## 4. 完整延后清单及延后原因

### 4.1 运行级延后清单（第二批收口后复核更新）

第二批已实现的项标记为完成并指向第 3 节对应小节；未做的保留原因。多事项合并的行拆为子行（9a/9b/9c、10a/10b/10c）以便分别标注状态。

| # | 延后项 | 第二批状态 | 说明/原因 |
| --- | --- | --- | --- |
| 1 | 本地 Agent/MCP 桥的 SSE 实时双向通道 | ✅ 已完成（3.7） | 零依赖 hub（127.0.0.1 SSE、双通道转发、心跳、requestId 配对、全路由 token 校验）+ `agentRealtimeBridge.ts` 受控执行；EventSource 无法带自定义头，`GET /events` 等价接受 token 查询参数 |
| 2 | 双引擎本地 Agent 会话（Codex app-server / Claude Code stream-json 子进程对接） | ✅ 已完成（3.8、3.9） | `agentEngines.ts` 双适配器 + `agent_process.rs` 子进程托管；CLI 实机联调待跨包验证，Rust 侧待 CI 编译验证 |
| 3 | 节点级图片编辑工具链（反推提示词/裁剪/九宫格拆分/放大超分/通用局部重绘） | ✅ 已完成（3.13） | `imageEditService` 纯函数 + `ImageDetailModal`；编辑工具条尚未接入素材库/画布预览入口（接入点文件范围外，见 4.3 #18） |
| 4 | 批量图组折叠栈与生成节点多图张数参数 | ✅ 已完成（3.11、3.12） | 折叠栈交互 + 张数 1-4 拆分请求；`n` 直传分支不可达（上游均不支持 n）；`workflowAssetService` 仍读单图字段待接线（见 4.3 #19） |
| 5 | WebDAV 媒体文件差量同步 | ✅ 已完成（3.14、3.8） | `mediaSyncService` sha-256 内容寻址差量上传/缺失回填 + mediaManifest 入包；Rust `read_media_file` 待 CI 编译验证 |
| 6 | 画布视口外实例裁剪渲染 | ✅ 已完成（3.11） | `isItemVisibleInViewport` + ResizeObserver；store 数据保持全量 |
| 7 | PPT 组装节点后端协作取消 | ✅ 已完成（3.8、3.12） | Rust 取消注册表 + `cancel_ppt_assembly` 命令 + 前端 token；Rust 侧待 CI 编译验证 |
| 8 | `src-tauri/src/storage.rs` 文件命令路径白名单 | ✅ 已完成（3.8） | `sanitize_canvas_id` + `AppHandle` 目录限定 + `read_media_file` 白名单；本机无 cargo 未编译验证，待桌面端 CI 确认 |
| 9a | 嵌入模式（embed code 分发） | ❌ 明确不做 | 需托管 Web 部署与服务端 header 鉴权语境，桌面单机应用没有对应载体；实现等于发明一个新产品面，未来做 Web 版再立项 |
| 9b | URL 深链握手 | ✅ web 侧已完成（3.10） | `App.tsx` `?q=` 幂等消费（hydration 后解析、`history.replaceState` 清参、模块级 flag 只消费一次）；Tauri `onOpenUrl` 未接入（无 deep-link 插件依赖，见 plan 6.2 未吸收清单） |
| 9c | 首页会话卡片马赛克预览 | ✅ 已完成（3.10） | `RecentProjectsPanel` 2×2 马赛克封面（不足 4 张渐变占位）；会话-资产当前为只读启发式关联（无显式字段） |
| 10a | Skills 专家工作流 UI | ✅ 已完成（3.9） | 技能 chip 钉选 + 必填输入自动映射 + 钉选后切换 `runSkill` 端点；真实 MuAPI 实机验收仍待用户配置密钥 |
| 10b | 会话消息快照回写服务端 | ✅ 已完成（3.9） | muapi 会话任务终态后 `updateSession`（PATCH）回写消息快照，失败静默记入事件流 |
| 10c | 密钥服务端保管/Tauri 安全存储 | ◐ 部分完成 | 已落地「仅本会话保存 API Key」（`agentStore` 会话级开关：apiKey 不进持久化、内存保留、刷新即清，见 3.9）；服务端保管/Tauri 安全存储仍未做，依赖远端 MuAPI 真实验收与安全存储设施 |

### 4.2 包级延后与口径澄清

| # | 延后项 | 原因 |
| --- | --- | --- |
| 11 | MCP 侧暴露 `generate_image_flow` | readiness 脚本把本地 MCP 工具数钉死为 11（`scripts/verify-agentic-readiness.mjs:466`、`scripts/verify-local-mcp.mjs:538`），已提交报告同样记录 11；脚本与报告不在包可编辑范围，贸然新增工具会使 `npm run verify:mcp` reports 步骤失败。已运行基线 `node ./scripts/verify-local-mcp.mjs` 全部 13 步通过 |
| 12 | `@[asset_N]` 还原接入手动按钮路径 | 手动按钮走 `flowStore.getConnectedInputData`，不在 PPT 包可编辑范围；本轮仅接入工作流自动执行输入组装（nodeExecutor） |
| 13 | `creativeStore` 双重导入根因修复（`creativeAssetService.ts:190` 改静态导入） | creativeAssetService.ts 不在包允许编辑范围；以 vite manualChunks 将 creativeStore 独立分包作为范围内缓解 |
| 14 | 独立 `pptOutlineNode` 节点类型 | 代码库不存在该类型（全仓 grep 无结果，`src/types/workflow.ts:45` EXECUTABLE_NODE_TYPES 仅含 pptContentNode 等 5 类）；按 pptContentNode 的大纲阶段实现 |
| 15 | PPTAssemblerNode/index.tsx 改动 | 4 项任务均不涉及，虽在允许范围内但未改动（第二批生成参数与 PPT 取消包已对其改动，见 3.12） |

### 4.3 第二批包级延后与范围外事项

第二批各包任务内延后已随包记录（3.7–3.14），跨包接线与待验证事项汇总如下：

| # | 事项 | 原因/去向 |
| --- | --- | --- |
| 16 | Rust 全部改动（storage.rs / ocr_inpaint.rs / agent_process.rs / lib.rs）未编译验证 | 本机无 cargo/rustc（`cargo --version`、`rustc --version` 均 command not found，见 3.8）；需桌面端 CI 构建确认 |
| 17 | Codex/Claude CLI 实机联调 | 本机无这两个 CLI；解析与启动参数按官方公开协议最佳实现，实际子进程行为待联调（见 3.9） |
| 18 | `ImageDetailModal` 编辑工具条未接入素材库/画布预览入口 | `CreativeAssetLibrary.tsx`/`CreativeWorkspace.tsx` 在该包允许范围外（只读），组件已交付待接线（见 3.13） |
| 19 | `workflowAssetService.createCreativeAssetDraftsFromWorkflowNode` 仍读单图字段；`creativeAutoSink` 逐张落位未切换建栈 | 两文件均在对应包允许范围外；生成侧已产出 images 数组（3.12），按契约改传后调用 `addImageBatchToCanvas` 批量栈即自动生效 |
| 20 | `inpaint_region` Rust 命令未注册 | 不在第二批跨包契约清单；TS 侧宽松调用并在缺失/失败时回退直连 IOPaint HTTP，功能不阻塞（见 3.13） |
| 21 | `n` 直传分支不可达 | `IMAGE_GEN_UPSTREAM_SUPPORTS_N=false`（`imageService.ts:24`）：Google generateContent 图片模型仅单候选、Lemon 流式 chat 无 n、Tauri 代理契约参数固定；上游支持后翻转开关即生效（见 3.12） |
| 22 | 实时桥 token/端口为新增 localStorage 配置键 | 现有桥配置不含端口/token 且文件范围外；键 `nextlemon-agent-realtime-bridge`（`agentRealtimeBridge.ts:31`），属降级实现而非缺口（见 3.7） |
| 23 | `syncMedia` 开关以宽松对象写 `WebDavSyncConfig` | `types/projectPackage.ts` 范围外只读，已注释标注；若最终字段名不同需对齐一处（见 3.14） |
| 24 | 最近项目面板会话-资产启发式关联 | 两 store 无显式关联字段；面板只读启发式（`session.metadata.assetIds` → `asset.metadata.sessionId` → agent 来源 + 60s 窗口兜底），未改 store 本体（见 3.10） |
| 25 | PPTAssembler 组件级 UI 测试未补 | 仓库无组件测试设施（无 testing-library/jsdom，vitest 为 node 环境）；取消文案与 token 生成已以纯函数单测覆盖（见 3.12） |

明确不做：嵌入模式（embed code 分发），见 4.1 第 9a 行。

## 5. 边界说明

- 本文档为收尾记录：第 3 节包内自查与第 2、2.1 节门禁结果均为两批运行内的执行记录，收尾环节未重跑。
- Skills 端点现状（与 plan 文档 6.2 节一致）：`muApiAgentAdapter.ts:222,226,232` 已实现 `agent-skills` / `run-skill` / `account/balance` 端点；第一批收口时 `runSkill` 无调用方、应用内未接入 Skills UI（当时核实修正）。第二批更新：Skills UI 已接入 Agent 面板——`listAgentSkills` 拉取技能为可钉选 chip，钉选后自动映射必填输入并切换 `runSkill` 端点（`AgentPanel.tsx:390-403,543-588`），`runSkill` 现有应用内调用方；真实 MuAPI 实机验收仍待用户配置密钥。
- Rust 改动（storage.rs / ocr_inpaint.rs / agent_process.rs / lib.rs）本机无 cargo 未编译验证（见 3.8 延后与 4.3 #16），需桌面端 CI 构建确认后才算闭环。
- 嵌入模式（embed code 分发）明确不做：需托管 Web 部署与服务端 header 鉴权语境，桌面单机应用没有对应载体；未来做 Web 版再立项（见 4.1 第 9a 行）。
- 默认 API Key 已置空（`src/config/lemonApi.ts:7`），Agent 工具循环在无密钥时中止并提示（`agentToolLoop.ts:291` 起的 `AGENT_MISSING_API_KEY_MESSAGE` 与 ：392 安全闸门），不再回退任何内置密钥。第二批新增「仅本会话保存 API Key」开关：勾选 provider 的 apiKey 不进持久化、刷新即清（见 3.9），属会话级内存保管，非服务端/Tauri 安全存储。
