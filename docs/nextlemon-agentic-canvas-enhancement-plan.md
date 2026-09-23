# NextLemon 双模式智能创作增强落地方案

## 1. 背景与目标

NextLemon 当前是以 React Flow 为核心的 AI 内容生成工作流桌面应用，已经具备多画布、节点编排、Prompt 库、图片/视频/LLM/PPT 节点、Tauri 本地文件存储和批量工作流执行能力。本轮增强不替换现有工作流核心，而是在其旁边新增“素材创作画布”模式，让用户可以像素材白板一样收集、摆放、复用和整理生成结果。

两个参考项目的主要价值如下：

| 项目 | 可吸收优点 | NextLemon 落地方式 |
| --- | --- | --- |
| Open-AI-Design-Agent | brief 到设计计划、计划可视化、审批执行、会话资产、job/event 流 | 通过 Agent Provider 抽象接入，默认复用现有供应商，可选适配 MuAPI |
| infinite-canvas | 自由素材画布、素材库、工具化画布助手、画布操作 schema、本地 Agent/MCP、WebDAV 同步 | 新增素材创作画布、素材 Store、CanvasAgentOp 协议和后续本地 Agent 桥 |

目标是形成双模式工作区：

- 工作流模式：保留现有 React Flow 节点工作流，继续承担可重复执行的生成管线。
- 创作画布模式：面向素材整理、视觉探索、自由排版和结果沉淀。
- 共享素材域：两个模式通过统一素材库互通，支持工作流结果保存为素材，素材拖回工作流成为输入节点。

## 2. 目标架构

### 顶层模式

- 新增 `WorkspaceMode = "workflow" | "creative"`。
- 默认进入 `workflow`，不改变老用户使用路径。
- 顶层提供轻量模式切换器。

### 素材域

核心类型：

- `CreativeAsset`：素材库实体，支持 `text`、`image`、`video`、`audio`，记录标题、标签、来源、mimeType、文件路径或 dataUrl。
- `CreativeCanvasItem`：画布上的素材实例，记录位置、尺寸、层级、锁定、隐藏和扩展元数据。
- `CreativeCanvasData`：创作画布状态，包含 viewport、items、更新时间。
- `CreativeCanvasStore`：素材和创作画布的 Zustand Store，持久化到现有 `tauriStorage`。

存储原则：

- 图片在 Tauri 环境优先保存为本地文件路径，避免把大 base64 写入 Store。
- 浏览器环境保留 dataUrl 作为 fallback。
- 视频/音频先作为 MVP 使用 dataUrl/URL 预览，后续扩展通用媒体文件存储。

### Agent 域

核心类型：

- `AgentProvider`：`local` 与 `muapi` 两种 provider 形态。
- `AgentSession`：会话、消息和事件容器。
- `AgentEvent`：统一事件流，覆盖 text、tool_call、tool_result、plan_propose、approval_required、error。
- `DesignPlan` / `DesignPlanStep`：brief 到可审批执行计划。
- `CanvasAgentOp`：可验证的画布/工作流操作协议。

默认策略：

- 读操作可以直接执行。
- 写操作默认需要用户确认。
- MuAPI 仅作为可选 provider，不能成为核心运行依赖。

## 3. PR 拆分

### PR 0：方案文档

- 新增本文件。
- 明确参考项目优点、目标架构、接口、任务拆分与验收标准。

验收：

- 文档位于 `docs/nextlemon-agentic-canvas-enhancement-plan.md`。
- 能解释为什么采用双模式而不是替换现有画布。

### PR 1：App 双模式壳

- 新增 `workspaceStore`。
- 顶层 App 支持 `workflow` 与 `creative` 切换。
- 工作流模式保持原 Toolbar、Sidebar、FlowCanvas 行为。

验收：

- 默认进入工作流模式。
- 切换到创作模式不卸载/破坏已持久化的工作流画布数据。

### PR 2：素材存储层

- 新增 `creativeStore`。
- 支持新增、更新、删除素材。
- 支持新增、移动、缩放、删除画布实例。
- 图片素材在 Tauri 环境可引用文件路径。

验收：

- 刷新或重启后素材和创作画布可恢复。
- 有文件路径的图片不会重复持久化大 base64。

### PR 3：素材创作画布 MVP

- 新增自由画布 UI。
- 支持拖拽平移、滚轮缩放、网格背景、选择、移动、缩放、层级、锁定、隐藏、删除。
- 支持上传图片、视频、音频，支持创建文本素材。
- 支持导出创作画布 JSON。

验收：

- 用户可以在创作画布完成素材收集和基础布局。
- 图片、视频、音频、文本都能以合适方式预览。

### PR 4：双画布互通

- 工作流节点支持“保存为素材”。
- 素材库面板支持将素材拖回工作流画布。
- 映射规则：
  - 文本素材 -> `promptNode`
  - 图片素材 -> `imageInputNode`
  - 视频/音频素材 -> `fileUploadNode`

验收：

- 工作流生成图片可保存到素材库。
- 素材拖入工作流后可以继续被下游节点读取。

### PR 5：素材库与生成历史 UI

- 增强素材面板，支持搜索、标签、来源、预览、下载。
- 将图片、视频、PPT 页面结果沉淀为素材。

验收：

- 用户能从素材库快速复用历史结果。
- 素材搜索不会影响画布交互性能。

### PR 6：Agent Provider 抽象

- 新增 provider 接口、事件协议、会话存储和 approval 状态。
- Local Provider 复用现有供应商配置。
- MuAPI Provider 仅实现适配器边界，不强制启用。

验收：

- Agent 层不直接依赖具体模型供应商。
- 所有写操作可以被拦截、预览和确认。

### PR 7：在线画布助手

- 参考 infinite-canvas 工具化助手，把模型输出限制为可验证工具调用。
- 支持读取当前工作区快照。
- 支持创建素材、更新素材、创建工作流节点、连接节点、运行节点。

验收：

- 模型不能通过任意 JSON 直接改状态。
- 无效节点 ID 或非法参数会被拒绝并显示错误。

### PR 8：MuAPI 适配器

- 适配 session、assets、jobs、events、approve、reject、cancel。
- 映射 Open-AI-Design-Agent 的 `plan_propose`、`tool_call`、`tool_result` 到统一事件。

验收：

- 不配置 MuAPI 时应用完全可用。
- 配置 MuAPI 后能显示计划、审批和事件流。

### PR 9：设计 Agent 规划器

- 实现 brief -> DesignPlan -> 可视化计划 -> 审批 -> 创建素材/工作流任务。
- 计划节点支持依赖、产物类型、模型建议、状态。

验收：

- 用户输入自然语言 brief 后能看到可编辑计划。
- 审批后计划能转成素材画布布局或工作流节点。

### PR 10：模板与品牌套件

- 新增品牌色、字体、Logo、语气、参考图。
- 内置社媒图、海报、品牌板、PPT、视频封面模板。

验收：

- 品牌套件可以影响后续设计计划和生成提示词。
- 模板可以创建一组可执行工作流或创作画布素材。

### PR 11：本地 Agent/MCP 桥

- 参考 infinite-canvas 的 canvas-agent。
- 提供只读快照和受控写操作。
- 作为可选本地能力，不影响普通启动。

验收：

- 本地 Agent 可读取当前画布快照。
- 写操作仍走确认机制。

### PR 12：同步与导入导出

- 增加完整项目包导出。
- 增加素材文件清单。
- 增加可选 WebDAV 同步。

验收：

- 旧画布数据无需破坏性迁移。
- 项目包导入后素材引用可恢复或给出明确缺失提示。

## 4. 测试与验收

- 每个实现批次至少运行 `npm run build`。
- 纯函数优先测试：
  - Agent op 校验。
  - 计划拓扑依赖。
  - 素材清理。
  - Provider event 映射。
- 手动验收：
  - 现有工作流创建、运行、导入、导出不回归。
  - 创作画布可添加、编辑、导出。
  - 素材和工作流互通成功。
  - Agent 写操作需要确认。
  - 大图片不会造成持久化 JSON 暴涨。

## 5. 当前实现边界与状态

本轮已落地 PR 0 到 PR 12 的基础能力。路线图中的双模式画布、素材域、Agent 域、品牌模板、本地桥和项目包同步能力均已有可构建的基础实现；后续可继续在更深的自动化、同步冲突处理和视觉体验上迭代。

| PR | 方案颗粒度 | 当前代码状态 | 说明 |
| --- | --- | --- | --- |
| PR 0 方案文档 | 已拆清楚 | 已落地 | 本文件已记录参考分析、架构、接口、路线图和验收标准 |
| PR 1 App 双模式壳 | 已拆清楚 | 已落地基础版 | 已新增 `workflow` / `creative` 顶层模式切换 |
| PR 2 素材存储层 | 已拆清楚 | 已落地基础版 | 已新增素材 Store、画布数据、素材增删改和持久化 |
| PR 3 素材创作画布 MVP | 已拆清楚 | 已落地 MVP | 已支持素材自由画布、上传、文本、拖拽、缩放、层级、锁定、隐藏、删除、导出 |
| PR 4 双画布互通 | 已拆清楚 | 已落地基础版 | 已支持工作流节点保存为素材、素材拖回工作流生成输入节点 |
| PR 5 素材库与生成历史 UI | 已拆清楚 | 已落地基础版 | 已支持搜索、类型筛选、标签筛选、来源筛选、预览、下载、素材信息编辑，并补齐 PPT 页面保存为素材 |
| PR 6 Agent Provider 抽象 | 已拆清楚 | 已落地基础版 | 已新增 Agent Store、Provider 配置、会话、消息、事件、审批队列和助手面板；真实工具执行进入 PR 7 |
| PR 7 在线画布助手 | 已拆清楚 | 已落地基础版 | 已新增受控工具 schema、工作区快照、工具调用参数校验、无效 ID 拒绝、审批后执行 CanvasAgentOp |
| PR 8 MuAPI 适配器 | 已拆清楚 | 已落地基础版 | 已新增可选 MuAPI HTTP 客户端、事件映射、远端会话、chat/events、approve/reject/cancel 和 UI 配置入口 |
| PR 9 设计 Agent 规划器 | 已拆清楚 | 已落地基础版 | 已支持 brief 生成 DesignPlan、计划可视化编辑、依赖校验、稳定节点 ID、计划转 CanvasAgentOp 并进入审批执行 |
| PR 10 模板与品牌套件 | 已拆清楚 | 已落地基础版 | 已新增品牌套件 Store、品牌/模板面板、内置模板、品牌/模板计划元数据和提示词注入 |
| PR 11 本地 Agent/MCP 桥 | 已拆清楚 | 已落地基础版 | 已新增可选本地桥、只读快照、受控写请求、审批前校验和 UI 开关 |
| PR 12 同步与导入导出 | 已拆清楚 | 已落地基础版 | 已新增完整项目包导入导出、素材文件清单、合并导入和可选 WebDAV 上传/拉取 |

## 6. 文档完整性核对

本方案已把用户原始计划中的关键块全部落到 md：

- `Summary`：对应第 1 节背景与目标、第 2 节目标架构。
- 参考项目分析：对应第 1 节的优点矩阵。
- `Key Interfaces`：对应第 2 节的顶层模式、素材域、Agent 域和操作协议说明。
- `PR Roadmap`：对应第 3 节 PR 0 到 PR 12。
- `Test Plan`：对应第 4 节测试与验收。
- `Assumptions`：对应第 8 节假设与边界。
- 当前状态：对应第 5 节当前实现边界与状态。

结论：文档层面已经完整罗列；代码层面 PR 0 到 PR 12 的基础能力已经全部落地，并通过构建验证。

## 6.1 当前实现记录

PR 5 已落地的文件：

- `src/services/creativeAssetService.ts`：统一素材预览 URL、文件名、标签规范化、下载逻辑和类型/来源标签。
- `src/components/creative/CreativeAssetLibrary.tsx`：统一素材库 UI，支持搜索、类型筛选、来源筛选、标签筛选、预览、下载、编辑标题/标签/备注、删除和拖拽复用。
- `src/components/creative/CreativeWorkspace.tsx`：创作画布右侧栏接入统一素材库，并新增素材库/画布助手切换。
- `src/components/Sidebar.tsx`：工作流侧边栏素材页接入统一素材库，保留拖拽到工作流的互通能力。
- `src/components/FlowCanvas.tsx`：工作流节点保存素材增强为多素材保存，PPT 内容节点和 PPT 组装节点可将页面图片沉淀为素材。

PR 6 已落地的文件：

- `src/stores/agentStore.ts`：新增 Agent 会话 Store，持久化 provider 配置、session、message、event、pendingOps 和审批状态。
- `src/components/agent/AgentPanel.tsx`：新增画布助手面板，展示 Local/MuAPI provider 状态、会话列表、事件流和待审批操作。
- `src/services/agentOps.ts`：继续作为 CanvasAgentOp 的校验、写操作识别和摘要入口。
- `src/types/agent.ts`、`src/types/creative.ts`：承载 Agent Provider、AgentSession、AgentEvent、DesignPlan、CanvasAgentOp 等类型协议。

PR 7 已落地的文件：

- `src/services/workflowAssetService.ts`：抽出工作流节点转素材逻辑，供右键保存和 Agent 执行器复用。
- `src/services/canvasAgentRuntime.ts`：新增 Canvas Agent 工具运行时，包含工具 schema、工作区快照、工具调用解析、参数转 CanvasAgentOp、当前状态校验和审批后执行。
- `src/components/agent/AgentPanel.tsx`：接入工具选择、JSON 参数执行、自然语言到受控工具的本地路由、tool_result 详情展开和批准后执行。
- `src/components/FlowCanvas.tsx`：改为复用 `workflowAssetService` 保存素材逻辑。

PR 7 当前边界：

- 已支持工具：读取工作区快照、创建素材、更新素材、素材放入创作画布、创建工作流节点、连接工作流节点、运行工作流节点、选择工作流节点。
- 写操作默认只进入审批队列；批准后才执行 Store 写入或节点运行。
- 无效素材 ID、画布 item ID、工作流 node ID、非法节点类型和非法连接会在进入审批前被拒绝。
- 本轮先实现本地受控工具运行时；真实 LLM function calling、MuAPI event stream 和复杂多步规划进入 PR 8/PR 9。

PR 8 已落地的文件：

- `src/services/muApiAgentAdapter.ts`：新增 MuAPI HTTP 客户端、AgentProvider 封装、session/assets/jobs/events/approve/reject/cancel/run-skill/account 接口边界和事件映射。
- `src/types/agent.ts`：新增 `MuApiSession`、`MuApiAsset`、`MuApiJob`、`MuApiRawEvent` 类型。
- `src/stores/agentStore.ts`：新增远端会话插入、会话 patch、metadata 更新和状态更新能力。
- `src/components/agent/AgentPanel.tsx`：新增 MuAPI provider 选择、Base URL/API Key/model 配置、远端会话创建、远端 chat、事件同步和远端 job 批准/拒绝/取消。

PR 8 当前边界：

- MuAPI 完全可选；未配置 Base URL/API Key 时 Local Provider 和本地工具助手仍可正常使用。
- 已覆盖 Open-AI-Design-Agent 参考代理中的 `/sessions`、`/sessions/{id}/assets`、`/sessions/{id}/chat`、`/sessions/{id}/jobs`、`/jobs/{id}/events`、`approve`、`reject`、`cancel`、`run-skill`、`agent-skills`、`account/balance` 边界。
- 事件映射兼容 `plan_propose`、`tool_call`、`tool_result`、`approval_required`、`error` 和普通文本事件。
- 当前实现优先保证协议边界和 UI 可见性；更复杂的 brief -> DesignPlan -> 自动创建工作流/素材任务进入 PR 9。

PR 9 已落地的文件：

- `src/services/designPlanPlanner.ts`：新增本地规划器，支持 brief -> `DesignPlan`、计划类型识别、步骤依赖拓扑校验、计划编辑 helper、计划转 `CanvasAgentOp`。
- `src/components/agent/AgentPanel.tsx`：新增设计计划卡片，可编辑计划标题、brief、步骤标题、步骤描述、步骤状态和模型建议，并支持提交计划审批。
- `src/types/creative.ts`：为 `workflow.addNode` 增加可选 `nodeId`，方便计划先生成稳定节点 ID，再创建连接。
- `src/stores/flowStore.ts`：`addNode` 支持可选指定节点 ID，保持原有自动 ID 行为兼容。
- `src/services/canvasAgentRuntime.ts`：审批前校验支持顺序模拟本批待创建节点和连接，计划生成的连接不会被误判为不存在。

PR 9 当前边界：

- 本地 Provider 下，自然语言 brief 会生成可编辑 `DesignPlan`；工具 JSON 仍走 PR 7 的受控工具调用。
- 已支持图片、视频、PPT、品牌视觉和通用创作计划的基础识别。
- 审批后会创建 brief 文本素材、Prompt 节点、生成节点或 PPT 节点，并自动连接相关工作流节点。
- 默认不自动运行高成本生成节点；用户批准计划后先得到可执行工作流，再自行运行节点或工作流。
- 更细的模板资产自动排版仍可在后续增强中继续扩展；品牌规范校验和模板变体已在增强批次中落地基础版。

PR 10 已落地的文件：

- `src/types/brand.ts`：新增 `BrandKit`、`BrandFonts`、`DesignTemplate`、`DesignTemplateDeliverable`、`DesignTemplateWorkflowNode`、`BrandKitSummary`、`DesignTemplateSummary` 等品牌与模板协议。
- `src/stores/brandKitStore.ts`：新增品牌套件持久化 Store，支持创建、切换、编辑、删除品牌套件，记录品牌色、字体、Logo、语气和参考素材。
- `src/services/designTemplateService.ts`：新增内置模板定义，覆盖社媒方图、竖版海报、品牌板、商务 PPT、视频封面/短片，并提供模板 brief、交付物、推荐工作流节点、验收标准、变体与摘要生成。
- `src/services/designPlanPlanner.ts`：`createDesignPlanFromBrief` 支持品牌套件和模板参数；`DesignPlan.metadata` 写入 `brandKitId`、`templateId`、品牌摘要和模板摘要；生成提示词自动注入品牌色、字体、Logo、语气、参考图、模板画幅、交付物、推荐节点、验收标准和模板执行要求；计划转操作时新增规格文本素材，并按模板设置图片画幅、视频尺寸和 PPT 页数。
- `src/components/creative/BrandKitPanel.tsx`：新增品牌/模板侧栏，支持编辑品牌名称、颜色、字体、语气、Logo、参考图，选择内置模板，生成设计计划或直接提交审批。
- `src/components/creative/CreativeWorkspace.tsx`：创作画布右侧栏新增品牌模板标签，与素材库、画布助手并列。
- `src/components/agent/AgentPanel.tsx`：Local Provider 的普通 brief 规划会自动带入当前激活品牌套件。

PR 10 当前边界：

- 品牌套件通过素材 ID 引用 Logo 和参考图，不复制大文件进入品牌 Store。
- 模板已能创建可审批的工作流节点和创作画布规格素材，且结构化记录交付物、推荐节点和验收标准，先覆盖基础模板闭环。
- 当前不自动运行高成本生成任务；用户批准后得到可执行工作流，再自行运行节点或工作流。
- 更高级的品牌资产自动排版和质量评分留给后续增强；品牌规范检查、模板变体、结构化交付物、验收标准和完整度评分已落地基础版。

PR 11 已落地的文件：

- `src/types/localAgentBridge.ts`：新增本地 Agent 桥协议，包含桥工具、操作目录、状态、快照、审批请求、审批校验和审批结果类型。
- `src/stores/localAgentBridgeStore.ts`：新增本地桥持久化 Store，支持启用/关闭、写请求开关、挂载时间、最近快照、最近写请求和错误记录。
- `src/services/localAgentBridge.ts`：新增可选本地桥服务，暴露 `window.nextlemonAgentBridge`，提供 `readSnapshot`、`listCanvasAgentOps`、`listBrandTemplates`、`createBrandSpec`、`validateApprovalRequest` 与 `requestApproval`；品牌模板读取和品牌规范生成复用真实 `designTemplateService.ts`，写请求复用 `CanvasAgentOp` 操作目录、批量 schema 校验和运行时状态校验，再进入现有 Agent 审批队列。
- `src/components/agent/LocalAgentBridgeRuntime.tsx`：新增运行时挂载组件，仅在用户启用桥时安装全局入口，关闭后卸载。
- `src/components/agent/LocalAgentBridgePanel.tsx`：新增 Agent 面板中的本地桥 UI，支持开关、写请求开关、读取快照、测试审批、操作清单展示、manifest/config 导出和外部审批请求导入。
- `src/components/agent/AgentPanel.tsx`：接入本地桥控制面板。
- `src/App.tsx`：接入本地桥运行时，普通用户未启用时不暴露桥入口。
- `src/services/canvasAgentRuntime.ts`：导出 `validateCanvasAgentOpsAgainstState`，供本地桥复用同一套状态校验。

PR 11 当前边界：

- 本轮实现的是浏览器/Tauri 本机可选桥协议，后续可以由真正的 MCP server 或本地 agent 进程包装调用。
- 只读快照可直接读取；写请求永远不会直接执行，必须进入 NextLemon 现有审批队列。
- 本地桥默认关闭，不影响普通用户启动，也不引入外部进程依赖。
- 本地桥写请求先做 schema 校验、操作目录校验和当前状态校验；无效素材、画布实例、节点和连接会被拒绝。

增强批次已落地：

- Playwright e2e 冒烟：`playwright.config.ts` + `e2e/smoke.spec.ts` 三条用例（默认工作流模式与模式切换器可见、创作画布添加文本素材并 Ctrl+Z 撤销、画布助手面板空状态），`npm run test:e2e` 本地起 Vite dev server（127.0.0.1 绑定规避 IPv6 localhost 解析问题）实跑通过；e2e 揪出并修复创作模式下模式切换浮窗遮挡右侧面板切换按钮的真实缺陷（浮窗左移 22rem 避让）。
- 自动沉淀与执行占位 + @提及输入 UI：`creativeStore` 新增 `autoSinkEnabled` 开关（创作画布工具栏 Wand2 按钮切换，默认关闭）；`creativeAutoSink` 在 `flowStore.executeFromNode` 前后挂钩——开启时执行先放"生成中…"占位实例，完成后用 `workflowAssetService` 抽取节点产物素材替换占位（按索引并排落位），失败或无产物移除占位；`AssetMentionTextarea` 组件在创作画布文本素材编辑中支持输入 `@` 弹出素材选择列表（label/标题过滤、↑↓/回车/点击插入、portal 渲染规避画布 transform），触发检测与插入由 `findActiveMentionTrigger`/`buildMentionInsertion` 纯函数驱动。
- @提及引用 + 吸附参考线 + 小地图：`creativeAssetService` 新增 `extractAssetMentions` / `findUnresolvedAssetMentions`（@[asset_N] 解析与校验）、`deriveUpstreamAssetRefs`（沿工作流入边反向遍历收集上游素材引用，带环守卫）与 `assetLabelMap`；Agent 工具循环创建文本素材时未解析提及直接拒绝并把错误回填模型修正，系统提示词说明提及语法；工作区快照每个工作流节点附带 `upstreamAssetLabels`；设计计划提示词按品牌 Logo/参考图自动注入 `@[asset_N]` 引用段。创作画布拖拽新增 `computeSnapAdjustment` 三边吸附（阈值 6px）与红色对齐参考线渲染；新增 `CreativeCanvasMinimap` 小地图组件（`computeMinimapFrame` 取景：可见实例 ∪ 视口，实例缩略、视口指示框、点击居中跳转）。
- 同步墓碑机制 + 画布体验件：`CreativeTombstone` 在 creativeStore（removeAssets 连带其画布实例、removeItems、clearCanvas）与 brandKitStore（deleteBrandKit，空列表兜底新建的默认套件不记墓碑）删除时记录并持久化；项目包导出/导入合并墓碑；`applyTombstones` 按 "deletedAt > updatedAt 即删除、删除后更新则复活" 裁决合并结果；`syncProjectPackage` 把合并后的墓碑写回两个 Store，删除操作从此可跨端传播。创作画布新增 Shift+拖拽框选（`findItemsInRect` 相交命中、支持反向拖拽与追加选择）与 PNG/JPG 导出（`computeCreativeCanvasExportBounds` 外包边界 + 离屏 canvas 重绘：图片走原始字节转 dataUrl 防跨域污染、文本逐字换行、视频/音频占位卡片，长边上限 4096，Tauri 保存对话框 / 浏览器下载）。
- asset_label 规范寻址 + ask_user 人机回路 + 事件游标断点续传：`CreativeAsset.label` 由 `nextAssetLabel` 自动分配（asset_N 递增），工作区快照携带 label，`findAssetIdByRef` 让 `asset.update` / `canvas.addAssetItem` 工具同时接受真实 ID 或规范标签，工具循环系统提示词引导模型优先引用标签；`agentToolLoop` 新增 `ask_user` 人机回路工具——模型提问即挂起并把 `pendingAskUser` 写入会话元数据，Agent 面板渲染问题卡片与编号选项，用户回答（点选项或直接输入）作为 tool 结果回填后自动续跑，会话元数据持久化使重启后问题仍在；`muApiEventStream` 纯函数状态机实现 `?since=` 游标断点续传、按 event id 去重（seenEventIds 上限 500）、6 分钟死空看门狗，`pollMuApiJobEvents` 断点续拉并回写会话元数据，chat 发送返回初始游标，切换到挂着远端 job 的会话自动静默续拉一次，RemoteJobCard 新增"同步"按钮。
- 媒体文件存储与孤儿文件 GC：Rust 端 `storage.rs` 新增 `save_media_file`（base64 写入 app_data/media/，扩展名过滤为字母数字防路径注入）、`list_media_files`、`delete_media_file`（删除限定在 media 目录内）三个命令并注册；`fileStorageService` 暴露对应封装；创作画布上传视频/音频在 Tauri 环境改为写本地文件（storagePath + 剥离 dataUrl），图片管线不变；`creativeAssetService.collectOrphanCreativeFiles` 纯函数按"未被任何素材 storagePath 引用"判定孤儿，`cleanupOrphanCreativeFiles` 运行时清理 media/ 与 images/creative-canvas/ 两个创作素材专属目录（不触碰工作流画布图片）；素材库面板新增"清理未引用文件"按钮并报告清理数量与释放空间。
- WebDAV 分域合并同步：`projectPackageService.mergeProjectPackages` 纯函数按 id 并集 + updatedAt 最新者胜合并工作流画布（画布级）、素材、画布实例与品牌套件，Agent 会话保持本地优先，manifest 计数重算；`syncProjectPackage` 直接应用合并结果（不再走"冲突改名追加"避免同 id 重复副本）并重置画布历史；`webDavSyncService.syncProjectPackageFromWebDav` 让 WebDAV 拉取从整包覆盖升级为合并同步；项目包面板拉取按钮已切换到合并同步并提示合并语义。
- 真实模型工具调用循环：`src/services/agentToolLoop.ts` 参考 infinite-canvas 在线助手实现 OpenAI 兼容 function calling 循环，第一轮强制 `tool_choice: "required"`、后续轮 `auto`；系统提示词约束模型只能引用快照真实 ID、禁止编造执行结果；8 个受控工具带完整 JSON Schema；工具执行结果（成功、审批挂起、校验失败原因）均以 `role:"tool"` 消息回填，模型可自我修正；写操作经用户审批后 `resumeAgentToolLoopAfterApproval` 自动续跑并保持同一对话上下文；循环上下文仅存内存，轮数上限 4。`AgentPanel` Local Provider 新增"真实模型工具调用"开关（metadata.modelToolLoop）与模型/Base URL/API Key 配置，默认复用 Lemon API；未启用时自然语言仍走本地规则路由与设计计划生成，行为不变。
- 派生素材并排落位：`creativeAssetService.computeNextToSourcePosition` 参考 Open-AI-Design-Agent `placeNextToSource`，Agent 的 `asset.add` / `canvas.addItem` 操作省略坐标时自动落在同源素材最右侧实例右边 32px，空画布回退默认起点；受控工具 `asset.create` 的 `position` 参数改为可选。
- 创作画布撤销/重做：`src/services/creativeHistory.ts` 提供纯函数历史栈（上限 50 步、按 tag + 800ms 窗口合并拖拽/缩放连续变更、撤销不回退视口），`src/stores/creativeStore.ts` 的画布实例增删、移动、缩放、层级、锁定、隐藏全部走历史提交；创作画布工具栏新增撤销/重做按钮，并支持 `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` 快捷键；历史仅存内存不持久化，rehydrate 后自动重置。
- Agent 写操作单步回滚：`src/services/agentRollback.ts` 在审批执行前捕获创作素材库 + 画布 + 工作流节点/边的深拷贝快照（`captureRollbackSnapshot`），`approveAndExecuteAgentOps` 执行后记录到 `agentStore.lastRollback`（仅内存，不持久化）；`rollbackLastAgentExecution` 一键恢复快照、重置画布历史并写入 `agent.rollback` 审计事件；Agent 面板新增"上一次 Agent 执行可回滚"卡片，回滚只保留一步，参考 infinite-canvas 的 `agentUndoSnapshot` 设计。
- 计划成本预估 + DAG 可视化：`designPlanPlanner` 为每个计划步骤填充 `estimatedCost`（无/低/中/高，视频与 PPT 内容生成标为高成本），新增 `estimateDesignPlanCost` 汇总整单成本档位与高成本步骤；新增 `layoutDesignPlanDag` 最长路径分层布局纯函数（带环守卫，参考 Open-AI-Design-Agent 的 `PlanVisualizer`）；`src/components/agent/DesignPlanDagView.tsx` 在计划卡片内按依赖分层横向渲染步骤卡片（状态点、成本档、模型建议），存在依赖环时给出修正提示。
- 本地 Agent/MCP：`src/types/localAgentBridge.ts`、`src/stores/localAgentBridgeStore.ts`、`src/services/localAgentBridge.ts`、`src/components/agent/LocalAgentBridgePanel.tsx`、`scripts/nextlemon-mcp-stdio.mjs`、`scripts/verify-local-agent-bridge.mjs`、`scripts/verify-local-mcp.mjs`、`scripts/verify-agentic-readiness.mjs` 已新增 MCP-like manifest、完整 `CanvasAgentOp` 操作目录、品牌模板目录只读工具、品牌规范生成工具、MuAPI 环境脱敏前置检查工具、MuAPI 真实报告断言工具、综合发布状态工具、工具输入 JSON schema、只读 validate 工具、只读 verification report 汇总工具、品牌模板报告摘要、requestId、审计日志、清单导出、外部 Agent 配置包导出、兼容换行 JSON-RPC 与 `Content-Length` framed 输入的 stdio MCP 代理、文件型审批收件箱、审批请求导入、一键 MCP 自检报告、应用内桥自检报告和总体验收报告；stdio MCP 操作目录已改为优先从 `src/services/agentOps.ts` 解析，并在自检中校验与应用内 `CANVAS_AGENT_OP_SPECS` 无漂移；应用内桥和 stdio MCP 的审批工具都已暴露 15 个 `CanvasAgentOp` 的 `oneOf` 参数 schema；应用内桥独立验收会检查 6 个工具、15 个操作、品牌模板读取、品牌规范生成和唯一写工具 `nextlemon.requestApproval`；总体验收报告会把本地桥的工具数、操作数、品牌模板 ready 数、模板变体数、品牌只读工具、写工具和失败 step 写成结构化字段，也会把 stdio MCP 的工具数、操作数、15 个操作类型、操作分类计数、审批 schema `oneOf` 数、传输格式、操作分类、品牌模板 ready/variant 数、MuAPI env/real evidence 状态、发布状态、审批 hash、审批策略和 blocker 写成结构化字段，项目包面板导入 readiness 报告时能直接展开这些颗粒度；stdio MCP 生成的审批请求文件已新增 `opCount`、`opSummary`、`operationTypes`、`approvalPolicy` 和 `requestHash` 审计字段，应用内导入解析会保留这些字段，自检会验证写操作不会直接执行；`nextlemon.get_manifest` 会声明品牌模板变体能力、能力矩阵能力、品牌规范生成能力和推荐调用参数；`nextlemon.list_brand_templates` 已可通过 `includeVariants` / `includeAppliedVariants` 返回真实模板服务中的 15 个模板变体和 15 个应用后模板摘要，也可通过 `includeCapabilityMatrix` 返回 5 个 ready 模板的格式、必需交付物、必需节点、变体 ID 和逐项检查结果；`nextlemon.create_brand_spec` 已可为指定品牌、模板和变体生成同源 `BrandSpecDocument`，并在自检中校验 100 分、当前模板 capability 和全局 5 ready / 15 variants；`nextlemon.read_verification_reports` 会摘要 readiness 中的 `brandSpec.ready`、`readinessBrandTemplates.ready`、`readinessLocalBridge.ready`、`readinessLocalMcp.ready`、品牌规范分数、当前模板 capability、必需工作流节点、全局 5 ready / 15 variants、模板 ID/变体 ID 分布、本地桥品牌工具、本地 MCP 15 个操作类型、分类计数、审批 schema、审批策略和 blocker；`nextlemon.get_release_status` 已支持本地 MCP 自检传入 `currentLocalMcpReport`，并会返回本地 MCP 的工具数、操作数、15 个操作类型、操作分类计数、品牌模板 ready/variant 数、发布状态和 blocker，避免综合发布状态读取上一轮旧 MCP 报告并误报 `local-mcp` blocker，且不改变 MuAPI 真实证据硬门槛。
- 品牌模板：`src/services/designTemplateService.ts`、`src/components/creative/BrandKitPanel.tsx`、`scripts/export-brand-spec.mjs`、`scripts/verify-brand-templates.mjs` 已新增品牌完整度评分、品牌色/字体/Logo/参考图校验、模板变体、变体提示词合并、模板交付物、推荐节点、验收标准、当前模板规格预览、应用内品牌规范 JSON 导出、CLI 品牌规范导出、模板能力矩阵和内置模板目录硬校验；模板验证脚本和本地 MCP 都会转译加载真实模板服务，验证或暴露 5 个内置模板、5 个 ready 模板和 15 个模板变体的合并结果；总体验收报告会把 `brand-templates` 的模板数、模板 ID、ready 模板 ID、必需类型数、类型计数、每模板变体 ID、每模板节点/交付物、通过/失败模板数、变体数、ready 数、能力矩阵节点/交付物覆盖、缺失类型和失败模板清单写成结构化字段，项目包面板导入 readiness 报告时可直接展开。
- MuAPI/远端 Agent：`src/services/muApiAgentAdapter.ts`、`src/components/agent/AgentPanel.tsx`、`scripts/verify-muapi.mjs` 已新增真实服务验证器；应用内验证和 CLI 验证都可用已配置的 Base URL/API Key 调用账户余额、Agent Skills、远端 session 创建，并可选发送 chat 探针；应用内和 CLI 均支持严格 chat 验收、端点调用证据、远端 session/job 记录和报告导出，验证结果写入 UI 和 Agent 事件流；CLI `verify:muapi` 报告会直接输出 `strictEvidenceReady`、`evidenceChecklist`、`blockingEvidenceIds`、`stepEvidence` 和 `endpointEvidence`，让缺密钥、缺 job、缺 endpoint 2xx 或 localhost/mock 的原因可机器读取。
- MuAPI 环境前置检查：`scripts/check-muapi-env.mjs` 已新增不联网检查，覆盖 `.env.example`、`.env.local` 密钥保护、Base URL、API Key、模型、严格 Chat 探针和真实服务 URL，帮助在真实握手前发现配置缺口；CLI 报告会输出 `missingEnvKeys`、`failedEnvKeys` 和脱敏状态，并拒绝 placeholder API Key。
- MuAPI 合约验收：`scripts/verify-muapi-mock.mjs` 已新增本机 mock MuAPI 服务，复用 `verify:muapi` 跑通 account、agent-skills、session、chat 和 job events，用于验证适配器合约；该报告不会替代真实 MuAPI 远端验收。
- MuAPI 真实报告断言：`scripts/assert-muapi-real-report.mjs` 已新增真实验收硬门槛，要求非 localhost、`account/skills/session/chat/events` 全部 passed、`remoteSessionId/remoteJobId` 存在并包含 endpointLog 证据。
- MuAPI 真实报告断言已继续加硬：必需 endpoint 证据不仅要存在，还必须至少包含一个 2xx HTTP 状态；断言函数已可被单元测试直接导入。
- MuAPI 真实报告断言已新增脱敏硬门槛：CLI 和应用内验证结果都会声明 `redaction.secretValuesReturned: false`，`verify:muapi:assert-real` 会拒绝包含 API Key、Authorization、chat 探针字段名或环境中真实密钥/探针原文的报告。
- MuAPI 真实报告断言已新增机器可读证据清单：`verify:muapi`、`verify:muapi:assert-real` 和 `nextlemon.assert_muapi_real_report` 会返回 `evidenceChecklist` 与 `blockingEvidenceIds`，覆盖报告可读性、真实服务、非 localhost、远端 session/job、6 个必需步骤、5 个 endpoint 2xx 证据和脱敏状态；`nextlemon.read_verification_reports` 会摘要 `strictEvidenceReady`、`evidenceChecklistCount` 和 `blockingEvidenceIds`，`nextlemon.get_release_status` 会把真实证据 blocker 汇总到 `muApi.realEvidenceBlockingIds`。
- 当前机器未配置可用 MuAPI API Key，因此本轮不能替用户完成真实远端握手；真实服务验收入口已经落地，配置密钥后可在 MuAPI 配置区一键执行，或运行 `MUAPI_API_KEY=... npm run verify:muapi`。
- `docs/agent-muapi-verification-guide.md`：新增本地 Agent/MCP、品牌模板和 MuAPI 真实服务验收说明；`.env.example` 提供 MuAPI 验收环境变量模板。

PR 12 已落地的文件：

- `src/types/projectPackage.ts`：新增 `NextLemonProjectPackage`、`ProjectAssetManifestItem`、`ImportProjectPackageResult`、`WebDavSyncConfig` 等项目包与同步协议。
- `src/services/projectPackageService.ts`：新增完整项目包生成、JSON 导出、JSON 解析、合并导入、素材文件清单生成和外部素材缺失提示；导出会同步当前激活工作流画布中的最新节点/边，避免只导出持久化快照。
- `src/stores/webDavSyncStore.ts`：新增可选 WebDAV 同步配置和状态 Store，记录 endpoint、remotePath、账号、最近同步时间、状态和错误。
- `src/services/webDavSyncService.ts`：新增 WebDAV 上传、拉取和拉取后合并导入能力，使用项目包 JSON 作为同步载体。
- `src/components/creative/ProjectPackagePanel.tsx`：新增项目包侧栏，支持本地导出/导入、素材清单预览、导入警告展示、WebDAV 配置、上传和拉取。
- `src/components/creative/ProjectPackagePanel.tsx`：同一侧栏新增验收报告导入与预览，支持查看 `agentic-readiness-report.json` 中的 passed / failed / blocked 计数、发布状态和逐项验收步骤。
- `src/components/creative/CreativeWorkspace.tsx`：创作画布右侧栏新增项目包标签，与素材库、品牌模板、画布助手并列。

PR 12 当前边界：

- 项目包采用 JSON 格式，包含工作流画布、创作素材库、创作画布实例、品牌套件、Agent 会话和素材文件清单。
- 导入默认合并到当前项目，不覆盖现有画布、素材和品牌套件；发生 ID 冲突时会生成导入 ID，并修正创作画布素材引用。
- 大文件不强制内嵌到 JSON；有 `storagePath` 或外部 URL 的素材会进入 `assetManifest`，导入时给出外部素材未内嵌的明确警告。
- WebDAV 为可选能力，默认关闭；当前基础版提供整包上传/拉取，不做多端冲突自动合并。

测试补充已落地：

- `package.json`：新增 `npm test`，使用 Vitest 运行纯函数测试。
- `src/services/__tests__/agentOps.test.ts`：覆盖 Agent op 字段校验、完整操作目录、批量校验、操作标签和摘要。
- `src/services/__tests__/designPlanPlanner.test.ts`：覆盖品牌/模板元数据注入、提示词注入、模板交付物/验收标准注入、计划规格素材和拓扑错误检测。
- `src/services/__tests__/projectPackageService.test.ts`：覆盖项目包 JSON 解析、非法项目包拒绝和外部素材未内嵌警告。
- `src/services/__tests__/localAgentBridge.test.ts`：覆盖 MCP-like manifest、操作目录、只读审批校验、外部 Agent 配置包、文件型审批请求解析和写操作审批约束。
- `src/services/__tests__/designTemplateService.test.ts`：覆盖内置模板目录完整性、模板变体合并、模板交付物/推荐节点/验收标准、品牌完整度校验、失效引用检测和品牌规范导出。
- `src/services/__tests__/muApiAgentAdapter.test.ts`：覆盖 MuAPI 事件映射、真实 endpoint 验证编排、严格 chat 探针、job events 拉取和未配置 API Key 的拒绝路径。

本轮验证：

- `npm test` 已通过，10 个测试文件、37 个测试用例全部通过。
- `npm run build` 已通过。
- `npm run mcp:local` 已通过基础 stdio 握手、`tools/list`、操作目录和审批请求校验验证。
- `npm run verify:mcp -- --json --report releases\local-mcp-verification-report.json` 已通过，覆盖 `Content-Length` framed 输入、换行 JSON-RPC、`initialize`、`tools/list`、manifest 安全边界与品牌模板变体/能力矩阵能力声明、审批工具细粒度 `oneOf` schema、操作目录源码解析、15 个操作类型、`asset/canvas/workflow/library` 分类计数、MCP 与应用内 `CANVAS_AGENT_OP_SPECS` 无漂移、品牌模板目录读取、PPT 专用节点、15 个模板变体、15 个应用后模板摘要、5 个 ready 模板、模板能力矩阵、PPT `executive` 变体、视频 `motion-hook` 变体、报告汇总中的品牌变体数量、`nextlemon.read_verification_reports` 对模板 ID/变体分布/操作类型/分类计数的硬校验、MuAPI 失败 key、endpoint 2xx 证据和脱敏状态摘要、MuAPI 真实服务前置条件脱敏读取、`missingEnvKeys`/`failedEnvKeys` 机器可读字段、MuAPI mock/localhost 和 missing-key 的 `strictEvidenceReady` / `evidenceChecklistCount` / `blockingEvidenceIds` 摘要、MuAPI mock/localhost 证据拒绝、`assert_muapi_real_report` 的 `stepEvidence` / `endpointEvidence` / `evidenceChecklist` / `blockingEvidenceIds` / 缺失 ID 结构化输出、综合发布状态读取、当前 MCP 自检摘要覆盖、严格 MuAPI blocker 保留、审批校验、审批请求文件写入、审批文件审计字段和 request hash。
- `npm run verify:brand:templates -- --json --report releases\brand-template-verification-report.json` 已通过，报告显示 5 个模板、5 个必需类型、15 个模板变体、5 个 ready 模板、11 个目录/能力检查全部 passed，并输出 `templateIds`、`readyTemplateIds`、`kindBreakdown`、`variantIdsByTemplate`、`workflowNodeTypesByTemplate`、`deliverableIdsByTemplate`、`capabilityCheckIdsByTemplate`；逐模板验证了交付物、推荐节点、验收标准、模型建议、PPT 专用节点、视频尺寸、图片画幅、变体应用结果和能力矩阵检查结果。
- `npm run verify:agentic -- --json --allow-blocked --include-build --report releases\agentic-readiness-report.json` 已通过本地发布验收，生产构建、单测、本地 MCP、品牌规范、品牌模板目录、MuAPI 环境模板/密钥保护、文档和 web 发布包均为 passed；发布包记录 SHA-256；MuAPI 真实服务因缺少 `MUAPI_API_KEY` 被明确标记为 blocked。
- `npm run verify:muapi:mock -- --json --report releases\muapi-mock-verification-report.json` 已通过，证明 MuAPI verifier 可跑通 session/chat/job events 合约链路；仍不等同于真实 MuAPI 服务验收。
- 应用内“项目包”面板已支持导入 `releases\agentic-readiness-report.json`，用于人工复核本地 MCP、品牌模板、MuAPI blocked 状态和发布包状态。
- `npm run release:web` 已作为 Web zip 打包入口；`npm run verify:release:local` 已作为 Web 预发布验收入口，会自动 build 并重新生成 Web zip，允许 MuAPI 真实服务在缺少密钥时保持 blocked；`npm run verify:release` 已作为严格发布验收入口，要求真实 MuAPI 通过。
- `docs/release-v0.0.7.md` 已新增发布说明，明确发布物、已落地能力、未闭环项和严格通过标准。
- `npm run brand:spec` 已通过临时输入文件导出品牌规范 JSON，校验分数为 100，导出结果包含模板交付物和验收标准。
- `npm run verify:muapi -- --json --require-chat --report releases\muapi-missing-key-report.json` 已执行，当前环境因缺少 `MUAPI_API_KEY` 在 `config` 步骤返回明确失败 JSON，报告包含 `strictEvidenceReady: false`、`realService: false`、空 `endpointLog`、18 项 `evidenceChecklist` 和 `blockingEvidenceIds`，未发生真实远端握手。
- `releases/NextLemon-v0.0.7-web.zip` 已在本轮构建后重新打包。
- 构建仅提示 daisyUI `@property` CSS warning 和 Vite 大 chunk warning，未阻断产物生成。

## 6.2 参考项目设计吸收对照与未吸收清单

对照 `Open-AI-Design-Agent` 与 `infinite-canvas` 的实际设计逐项核对，本方案的吸收情况如下。2026-09-24 能力差距收口后已复核本节：修正了此前对 skills 端点"已吸收"的夸大表述（实际无应用内调用方），并把本次收口新增吸收与明确延后项补入对照，逐包明细见 `docs/gap-closure-2026-09-24.md`。

已吸收并落地的设计：

| 参考项目设计 | 落地位置 |
| --- | --- |
| Open-AI-Design-Agent：brief -> 计划 -> 审批 -> 执行 | PR 9 `designPlanPlanner`，计划可视化编辑、依赖拓扑校验 |
| Open-AI-Design-Agent：审批协议（approve/reject/cancel） | PR 6/8 审批队列与 MuAPI 端点映射 |
| Open-AI-Design-Agent：job/event 事件流与 `?since=` 游标 | PR 8 `muApiAgentAdapter`（含增量拉取） |
| Open-AI-Design-Agent：skills / run-skill / account 端点边界 | PR 8 适配器已实现端点，且仅由 CLI/应用内验证器调用（`muApiAgentAdapter.ts:349-350` 调 `getAccountBalance`/`listAgentSkills`）；应用内无业务调用方——`runSkill`（`muApiAgentAdapter.ts:226`）目前零调用方，Skills 未接入 UI 与工具循环，2026-09-24 收口亦未实现 Skills UI（2026-09-24 核实修正，此前表述"端点覆盖"易被误读为已接入应用） |
| infinite-canvas：自由素材画布（平移/缩放/网格/变换） | PR 3 创作画布，且补充了参考项目没有的层级/锁定/隐藏 |
| infinite-canvas：JSON 状态与大文件分离存储 | 第 2 节存储原则 + PR 2 图片走 Tauri 文件路径 |
| infinite-canvas：受控画布助手 + 操作 schema | PR 7 `canvasAgentRuntime` 受控工具与参数校验 |
| infinite-canvas：一套 schema 多处复用 | `CANVAS_AGENT_OP_SPECS` -> JSON Schema -> stdio MCP，并增加无漂移自检 |
| infinite-canvas：本地 Agent 桥（只读快照 + 唯一受控写 + 审批） | PR 11 应用内桥与 stdio MCP |
| infinite-canvas：WebDAV 同步、项目包导入导出 | PR 12 基础版 |

此前批次新增吸收（对应当时"未吸收清单"中的高优先级项；2026-09-24 收口的增量以「收口更新」标注）：

| 参考项目设计 | 落地位置 |
| --- | --- |
| infinite-canvas：Agent 写操作单步回滚（`agentUndoSnapshot`） | `src/services/agentRollback.ts` + `agentStore.lastRollback` + Agent 面板回滚卡片（收口更新：`agentStore.ts:28,242-245` 的回滚历史升级为 3 步内存环形栈 `rollbackHistory`，保留 `lastRollback` 兼容字段，回滚弹出最近一步） |
| infinite-canvas：画布撤销/重做（历史合并、上限 50） | `src/services/creativeHistory.ts` + `creativeStore` 历史 + 工具栏按钮与快捷键 |
| Open-AI-Design-Agent：计划 DAG 分层可视化（`PlanVisualizer`） | `layoutDesignPlanDag` + `src/components/agent/DesignPlanDagView.tsx` |
| Open-AI-Design-Agent：计划成本显式化（`est_credits`/`total_credits`） | 步骤 `estimatedCost` 档位 + `estimateDesignPlanCost` 整单汇总 |
| infinite-canvas：真实 LLM function calling 强制工具循环 | `src/services/agentToolLoop.ts`：OpenAI 兼容 `tools` + `tool_choice: required→auto` 两阶段循环、工作区快照注入、工具结果（含校验失败原因）以 `role:"tool"` 回填自我修正、写操作审批通过后自动续跑；Local Provider 面板提供开关与模型/Base URL/API Key 配置，未启用时回退本地规则路由（收口更新：移除 `LEMON_API_CONFIG.apiKey` 兜底，`agentToolLoop.ts:290-309,391-397` 无密钥时中止本轮、写入提示消息并拒绝发模型请求，`callAgentChat`（:339 起）同闸门） |
| Open-AI-Design-Agent：派生素材非破坏性并排落位（`placeNextToSource`） | `computeNextToSourcePosition`：Agent 创建/放入素材缺省坐标时自动放在同源素材最右侧实例右边 32px |
| infinite-canvas：媒体 Blob 独立存储 + 引用计数 GC | Rust 端新增 `save_media_file` / `list_media_files` / `delete_media_file`（media 目录、扩展名白名单化、删除限定目录内）；上传视频/音频在 Tauri 环境写本地文件并剥离 dataUrl；`collectOrphanCreativeFiles` 纯函数 + `cleanupOrphanCreativeFiles` 运行时清理 media/ 与 images/creative-canvas/ 两个创作素材专属目录，素材库新增"清理未引用文件"入口 |
| infinite-canvas：分域清单式 WebDAV 合并（`mergeById`） | `mergeProjectPackages` 纯函数：工作流画布/素材/画布实例/品牌套件按 id 并集、updatedAt 最新者胜，Agent 会话保持本地；`syncProjectPackageFromWebDav` 拉取即合并替代整包覆盖（无墓碑机制，删除操作暂无法跨端同步）（收口更新：画布合并升级为节点/边级——`projectPackageService.ts:409,446` `mergeWorkflowCanvases`/`mergeCanvasNodesAndEdges` 按 id 并集、同 id 冲突以所在画布 updatedAt 新者胜、端点缺失的悬挂边丢弃） |
| Open-AI-Design-Agent：asset_label 规范寻址 | `CreativeAsset.label`（asset_N 自动分配）+ 工作区快照注入 label + `findAssetIdByRef` 工具引用解析（asset.update / canvas.addAssetItem 支持标签）+ 工具循环系统提示词引导模型优先用标签 |
| Open-AI-Design-Agent：ask_user 人机回路 | 工具循环新增 `ask_user` 工具：模型提问即挂起（`pendingAskUser` 写入会话元数据），Agent 面板渲染问题卡片与编号选项，用户回答作为 tool 结果回填并自动续跑 |
| Open-AI-Design-Agent：事件游标断点续传 + 死空看门狗 | `src/services/muApiEventStream.ts` 纯函数状态机（?since= 游标、按 event id 去重、6 分钟死空判 stalled）+ `pollMuApiJobEvents` 断点续拉 + 会话切换自动续传 + RemoteJobCard 手动同步按钮；chat 后返回初始游标写入会话元数据（收口更新：未完成远端 job 由"切会话单次续拉"升级为 AgentPanel 2 秒周期轮询——增量事件 + `getJobStatus` 状态对齐，终态 done/error/cancelled 或 6 分钟死空停滞自动清理定时器，原单次续拉 effect 被取代） |
| 同步墓碑机制（合并同步闭环） | `CreativeTombstone`（id/kind/deletedAt）在 creativeStore 与 brandKitStore 删除时记录（上限 500 条）并持久化；项目包导出/导入携带墓碑；`mergeProjectPackages` 合并墓碑后按 "deletedAt > updatedAt 即删除" 裁决素材、画布实例与品牌套件，删除后更新（晚于墓碑）则实体复活，删除操作从此可跨端传播 |
| infinite-canvas / Open-AI-Design-Agent：创作画布导出图片 | `creativeCanvasGeometry.computeCreativeCanvasExportBounds` 纯函数计算可见实例外包边界 + `creativeCanvasExport` 离屏 canvas 重绘（图片读原始字节转 dataUrl 防跨域污染、文本换行绘制、视频/音频占位卡片），支持 PNG/JPG 导出，长边上限 4096 |
| infinite-canvas：框选多选 | `creativeCanvasGeometry.findItemsInRect` 相交命中（支持反向拖拽），Shift+左键拖空白框选，支持在现有选择集上追加，画布实时渲染选框 |
| infinite-canvas：@提及引用 | `@[asset_N]` 内嵌语法：`extractAssetMentions`/`findUnresolvedAssetMentions` 解析与校验，`asset.create` 文本中未解析提及直接拒绝（模型自我修正），`deriveUpstreamAssetRefs` 沿连线拓扑推导节点上游素材并在快照中输出 `upstreamAssetLabels`，设计计划提示词自动注入品牌 Logo/参考图的可引用标签（收口更新：工作流自动执行的输入组装接入还原——`nodeExecutor.ts:60,181,189` `finalizeGenerationInput` 把 `@[asset_N]` 命中的图片素材按出现顺序追加为图片参考输入并把 token 替换为【图N】式引用；手动按钮路径 `flowStore.getConnectedInputData` 本轮未接入，见未吸收清单） |
| infinite-canvas：吸附参考线 + 小地图 | `computeSnapAdjustment` 纯函数（左/中/右、上/中/下三边对齐吸附，阈值 6px）+ 拖拽实时红色参考线；`computeMinimapFrame` 取景纯函数 + `CreativeCanvasMinimap` 组件（实例缩略、视口指示框、点击居中跳转） |
| Open-AI-Design-Agent：执行占位 + 生成结果落画布 | `creativeAutoSink`：创作画布工具栏"自动沉淀"开关（默认关闭），开启后工作流节点执行先放"生成中"占位实例，完成后用节点产物素材（复用 `workflowAssetService`）替换占位并按索引并排落位，失败/无产物移除占位；flowStore.executeFromNode 前后挂钩（收口更新：重写为按精确 assetId/itemId 追踪占位，素材附加节点专属标签 `auto-sink-node:${nodeId}` 支持应用重启后回收，`addAssetToCanvas` 失败时回收素材，无法精确匹配时跳过删除而非模糊匹配；`creativeAutoSink.ts:13-15,104-107` 导出纯函数 `resolveAutoSinkPlaceholder`） |
| infinite-canvas：@提及输入 UI | `AssetMentionTextarea`：文本素材编辑输入 `@` 弹出素材选择列表（label+标题过滤、↑↓/回车/点击插入，portal 渲染避免画布 transform 缩放），`findActiveMentionTrigger`/`buildMentionInsertion` 纯函数驱动 |

2026-09-24 能力差距收口新增吸收：

| 参考项目设计 | 收口落地 |
| --- | --- |
| Open-AI-Design-Agent：会话任务清单与远端 job 恢复（`GET /sessions/{id}/jobs`） | 应用加载/切回 muapi 会话时经 `listSessionJobs` 查询服务端 pending/processing 任务并对齐会话元数据；`src/services/muApiJobRecovery.ts` 的 `pollActiveMuApiJob` 驱动增量事件与 `getJobStatus` 状态对齐。适配器补齐导出 `listMuApiSessionJobs` / `fetchMuApiJobStatus` / `findActiveMuApiJob`（`muApiAgentAdapter.ts:989-1007`），使原有零调用方的 session jobs 方法有了调用方 |
| Open-AI-Design-Agent：job/审批生命周期终态收敛 | job 终态（done/error/cancelled）后 RemoteJobCard 收敛为摘要+同步（隐藏批准/拒绝/取消）；`approval_required` 事件在后续批准/拒绝/取消 `tool_result` 或任务终态到达后收敛为已解决徽标（`AgentPanel.tsx:1414`） |
| infinite-canvas：受控画布助手的组合编排扩展 | `generate_image_flow` 组合工具（`canvasAgentRuntime.ts:34,122,482-544`）：入参 prompt + 可选参考素材，内部展开为「提示词素材 → 提示词节点 → 生成节点 → 连线 → 触发运行」共 5 个既有受控 op，复用 `validateCanvasAgentOpsAgainstState` 与既有审批路径，不新增 op 类型；已加入工具循环 schema 与系统提示词（`agentToolLoop.ts:73,237`）。MCP 侧暴露延后（readiness 脚本把本地 MCP 工具数钉死为 11，见未吸收清单） |
| Open-AI-Design-Agent：会话消息 Markdown 渲染 | Agent 面板 text 分支与助手消息内容改用 react-markdown 渲染，`skipHtml` 禁用原始 HTML 注入，URL 经 react-markdown 默认净化（`AgentPanel.tsx:2,1359`） |

本次收口同批还包含与参考项目无直接对应关系的工程与体验补强：默认 API Key 置空并全配置目录密钥扫描、画布指针拖拽/视口更新 rAF 合帧、空格与中键平移、`tauriStorage` 落盘防抖（`createDebouncedSaver`）、媒体加载 CORS 降级重试（`src/utils/mediaLoadStrategy.ts`）、小地图拖拽取景、PPT 内容节点两阶段自动执行与 `mapWithConcurrency` 信号量并发、在线提示词市场（`src/services/promptMarketService.ts`）、会话行内重命名、构建 manualChunks 分包与项目包合并升级等——逐包摘要、验证与延后明细见 `docs/gap-closure-2026-09-24.md`。

仍未吸收、留作后续增强的设计（按建议优先级排序；2026-09-24 收口后复核更新）：

既有余项：

1. @提及输入 UI 推广到工作流 Prompt 节点编辑器（创作画布文本编辑已支持 @ 弹出选择）。
2. 画布体验件余项：吸附对齐支持按间距等分吸附（当前仅边/中线）。
3. 自动沉淀占位可扩展为加载动画占位（当前为静态"生成中…"文本实例）。

本轮评估明确延后（含原因；完整记录见 `docs/gap-closure-2026-09-24.md` 第 4 节）：

4. MCP 侧暴露 `generate_image_flow`：readiness 脚本把本地 MCP 工具数钉死为 11（`scripts/verify-agentic-readiness.mjs:466`、`scripts/verify-local-mcp.mjs:538`），新增第 12 个工具后下次重新生成 readiness 报告时 `npm run verify:mcp` 的 reports 步骤必然失败，需连同脚本与已发布报告一起更新。
5. 本地 Agent/MCP 桥的 SSE 实时双向通道：需常驻本地服务，跨 TS/Rust/协议三层，单次运行无法验证。
6. 双引擎本地 Agent 会话（Codex app-server / Claude Code stream-json 子进程对接）。
7. 节点级图片编辑工具链（反推提示词/裁剪/九宫格拆分/放大超分/通用局部重绘）。
8. 批量图组折叠栈与生成节点多图张数参数：需要新数据结构加整套交互。
9. WebDAV 媒体文件差量同步：需 Rust 端配合与协议设计。
10. 画布视口外实例裁剪渲染。
11. PPT 组装节点后端协作取消：需 Rust 侧取消令牌。
12. `src-tauri/src/storage.rs` 文件命令路径白名单：本机无 cargo，无法编译验证，不推送未验证的 Rust 代码，留待有 Rust 工具链时处理。
13. 嵌入模式（embed code 分发）、URL 深链握手、首页会话卡片马赛克预览：应用当前无首页结构，属产品级新功能。
14. Skills 专家工作流 UI、会话消息快照回写服务端、密钥服务端保管/Tauri 安全存储：依赖远端 MuAPI 真实验收，当前 blocked；skills 端点现状见上表说明（仅验证器调用，无应用内调用方，本轮亦未实现 Skills UI）。
15. `@[asset_N]` 还原接入手动按钮路径（`flowStore.getConnectedInputData`）：本轮范围外，仅接入工作流自动执行的输入组装。
16. `creativeStore` 双重导入根因修复（`creativeAssetService.ts:190` 的 `await import` 改静态导入）：该文件不在本轮可编辑范围，暂以 vite `manualChunks` 将 creativeStore 独立分包缓解。
17. 独立 `pptOutlineNode` 节点类型：代码库不存在该类型（`src/types/workflow.ts:45` 的 `EXECUTABLE_NODE_TYPES` 仅含 pptContentNode 等 5 类），PPT 大纲阶段已按 `pptContentNode` 实现。

## 7. 颗粒度对齐核对

路线图颗粒度按“一个 PR 能独立开发、独立构建、独立验收”的标准拆分：

- UI 壳层、素材 Store、创作画布、双画布互通被拆成 PR 1 到 PR 4，避免一次性改动工作流核心。
- 素材库体验、Agent 抽象、在线助手、MuAPI 适配、规划器被拆成 PR 5 到 PR 9，保证 Agent 能力从数据协议到真实执行逐层推进。
- 品牌套件、本地 MCP、同步导入导出被拆成 PR 10 到 PR 12，作为高阶能力独立验收；PR 10、PR 11、PR 12 均已落地基础版。

接口颗粒度按“类型先行、实现分层”的标准对齐：

- `WorkspaceMode` 只负责顶层模式，不承载业务状态。
- `CreativeAsset` 负责素材库实体，`CreativeCanvasItem` 负责画布实例，避免一个素材被多处摆放时互相污染。
- `CanvasAgentOp` 是 Agent 的唯一受控写入口，覆盖素材、画布、工作流、视口和素材库保存。
- `CANVAS_AGENT_OP_SPECS` 是 `CanvasAgentOp` 的可发现操作目录，供应用内桥、stdio MCP 代理、测试和外部 Agent 统一引用。
- `createCanvasAgentOpJsonSchema` / `approvalRequestSchema` 把操作目录转换为可发现的 `oneOf` 参数 schema，避免外部 Agent 只能依赖宽泛 JSON 对象。
- `AgentEvent` 统一本地 Provider 与 MuAPI Provider 的事件流，避免 UI 直接绑定某个远端协议。

## 8. 假设与边界

- 不直接替换当前 React Flow 工作流核心。
- 不把 `Open-AI-Design-Agent` 和 `infinite-canvas` 作为运行时依赖，只吸收架构和必要实现思路。
- 如后续复制参考项目代码，需要保留对应开源协议署名。
- 默认 Agent Provider 使用现有供应商配置；MuAPI 是可选增强。
- 默认文档语言为中文，文件名使用英文，便于仓库长期维护。
