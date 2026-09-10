# Agent / MCP / MuAPI 验收说明

## 本地 Agent/MCP

当前已提供两层能力：

- 应用内桥：在 NextLemon 中启用本地 Agent 桥后，外部脚本可通过 `window.nextlemonAgentBridge` 读取快照、读取品牌模板、生成品牌规范、校验写操作并提交审批请求。
- stdio MCP 代理：运行 `npm run mcp:local`，提供 `initialize`、`tools/list`、`tools/call`，兼容换行 JSON-RPC 和 `Content-Length` framed 输入；写操作会生成文件型审批请求，不会直接写入应用状态。
- 操作目录：应用内桥和 stdio 代理都会暴露完整 `CanvasAgentOp` 目录，外部 Agent 应先读取目录，再校验请求，最后创建审批请求。stdio 代理会优先从 `src/services/agentOps.ts` 解析 `CANVAS_AGENT_OP_SPECS`，`verify:mcp` 会拒绝目录漂移和缺少描述/示例/必填字段的操作规格。

基础验收：

```bash
npm run mcp:local
```

总体验收：

```bash
npm run verify:agentic -- --json --allow-blocked --include-build --report releases\agentic-readiness-report.json
```

该命令会汇总生产构建、Web zip 打包、单元测试、本地 MCP、品牌模板、MuAPI 环境模板/密钥保护、MuAPI 真实服务、文档和发布包状态。没有 `MUAPI_API_KEY` 时，报告中的 MuAPI 步骤会是 `blocked`；配置真实密钥后去掉 `--allow-blocked`，即可作为最终闭环验收。Web 发布包步骤会记录 SHA-256，便于复验发布物是否一致。

发布快捷命令：

```bash
# Web 预发布：允许 MuAPI 真实服务暂时 blocked
npm run verify:release:local -- --json --report releases\agentic-readiness-report.json

# 严格发布：要求真实 MuAPI 通过
npm run verify:release -- --json --report releases\agentic-readiness-report.json
```

`verify:release:local` 与 `verify:release` 都会在构建后重新生成 Web zip。`verify:release` 会强制 `--include-build --require-muapi`；只要缺少真实 API Key、chat 探针或 job events 证据，就必须失败。

应用内查看：

- 打开“素材创作画布”右侧的“项目包”面板。
- 在“验收报告”区域导入 `releases/agentic-readiness-report.json`。
- 面板会显示 passed / failed / blocked 计数、是否可发布、是否包含构建，以及每个验收步骤状态。
- 对带有结构化 detail 的步骤，面板会展开失败原因、失败环境项、真实证据 blocker、strict evidence 计数、endpoint 2xx 计数、报告路径和下一步命令；`brand-spec` 会展开品牌模板能力矩阵摘要，`brand-templates` 会展开模板数、模板 ID、ready 模板 ID、必需类型、类型计数、每模板变体 ID、每模板节点/交付物、ready 数、能力矩阵节点覆盖和失败模板清单，`local-bridge` 会展开工具数、操作数、品牌模板 ready 数、模板变体数、品牌只读工具和唯一写工具，`local-mcp` 会展开 11 个 MCP 工具、15 个操作、15 个操作类型、操作分类计数、审批 schema oneOf、传输格式、审批 hash、安全审批策略和严格发布 blocker，便于在 UI 内判断是否只差真实远端凭据。

自动自检：

```bash
npm run verify:mcp -- --json --report releases\local-mcp-verification-report.json
```

自检覆盖：

- `Content-Length` framed 输入
- 换行 JSON-RPC 输入
- `initialize`
- `tools/list`
- `nextlemon.list_canvas_agent_ops`
- MCP 操作目录是否与应用内 `CANVAS_AGENT_OP_SPECS` 完全对齐，且每个操作都包含 category、label、description、required 和 example
- `nextlemon.list_brand_templates`
- 品牌模板目录是否包含 5 个必需类型、PPT 专用节点、15 个模板变体和 15 个应用后模板摘要
- `nextlemon.create_brand_spec`
- 品牌规范工具是否能基于真实模板服务输出 100 分规范、当前模板 capability 和全局 5 ready / 15 variants 目录
- `nextlemon.check_muapi_env`
- MuAPI 真实服务前置条件是否可读且不暴露密钥
- `nextlemon.assert_muapi_real_report`
- localhost/mock MuAPI 报告是否会被真实证据断言拒绝
- `nextlemon.get_release_status`
- 本地预发布、严格发布、MuAPI 环境和真实证据阻塞项是否能统一读取
- `nextlemon.validate_approval_request`
- `nextlemon.create_approval_request`
- `validate_approval_request` / `create_approval_request` 的 `ops.items` 是否暴露 15 个 `CanvasAgentOp` 的 `oneOf` 参数 schema，避免外部 Agent 只拿到宽泛 JSON 对象约束
- 审批请求文件是否真实写入 inbox

应用内桥独立验收：

```bash
npm run verify:local-bridge -- --json --report releases\local-agent-bridge-verification-report.json
```

该命令会运行 `src/services/__tests__/localAgentBridge.test.ts`，并从 `src/services/localAgentBridge.ts` / `src/services/agentOps.ts` 解析工具目录和操作目录，要求应用内桥暴露 6 个工具、15 个 `CanvasAgentOp`、品牌模板读取工具、品牌规范生成工具，并确认唯一写工具是 `nextlemon.requestApproval`，写操作仍只进入审批队列。

可用工具：

- `nextlemon.get_manifest`
- `nextlemon.list_canvas_agent_ops`
- `nextlemon.list_brand_templates`
- `nextlemon.create_brand_spec`
- `nextlemon.read_project_package`
- `nextlemon.read_verification_reports`
- `nextlemon.check_muapi_env`
- `nextlemon.assert_muapi_real_report`
- `nextlemon.get_release_status`
- `nextlemon.validate_approval_request`
- `nextlemon.create_approval_request`

推荐调用顺序：

1. `nextlemon.get_manifest`：确认 inbox、项目包路径和安全边界。
2. `nextlemon.list_canvas_agent_ops`：读取支持的素材、画布、工作流和素材库写操作。
3. `nextlemon.list_brand_templates`：读取社媒图、海报、品牌板、PPT、视频封面模板的交付物、推荐节点、验收标准和模型建议；支持按 `kind` 或 `id` 过滤，并可通过 `includeVariants` / `includeAppliedVariants` 暴露 `getTemplateVariants` 和 `applyTemplateVariant` 的真实结果；传入 `includeCapabilityMatrix` 时会返回模板能力矩阵，包含每个模板的格式、必需交付物、必需工作流节点、变体 ID、ready 状态和逐项检查结果。
4. `nextlemon.create_brand_spec`：只读生成完整品牌规范 JSON，输入 `brandKit`、`assets`、`templateId` 和可选 `variantId`，输出与应用内/CLI 同源的 `createBrandSpecDocument` 结果，包括 `validation.score`、当前模板 `templateCapability`、全局 `templateCatalog`、提示词约束和使用说明；支持应用模板变体，例如 `poster-vertical-campaign` + `bold`。
5. `nextlemon.read_verification_reports`：读取 readiness、品牌模板、MCP、MuAPI env、MuAPI mock/real 报告摘要，判断当前是否仍被真实远端凭据阻塞或模板目录未通过；摘要会保留 `brandSpec.ready`、`brandSpec.score`、`brandSpec.templateCapabilityRequiredWorkflowNodes`、`brandSpec.templateCatalogWorkflowNodeTypes`、`readinessBrandTemplates.ready`、`readinessBrandTemplates.templateIds`、`readinessBrandTemplates.variantIdsByTemplate`、`readinessBrandTemplates.workflowNodeTypesByTemplate`、`readinessLocalBridge.ready`、`readinessLocalMcp.ready`、`readinessLocalMcp.operationTypes`、`readinessLocalMcp.operationCategoryCounts`、`readinessLocalMcp.approvalSchemaOneOfCount`、`readinessLocalMcp.approvalPolicy`、`variantCount`、`brandTemplateVariantCount`、`missingEnvKeys`、`failedEnvKeys`、`apiKeyConfigured`、`chatProbeConfigured`、`strictEvidenceReady`、`evidenceChecklistCount`、`blockingEvidenceIds`、`endpointEvidence`、`endpoint2xxCount` 和 `redaction.secretValuesReturned` 等机器可读字段。
6. `nextlemon.check_muapi_env`：实时读取 `.env.local`、`.env` 和环境变量，返回 `apiKeyConfigured`、`chatProbeConfigured`、`missingEnvKeys`、`failedEnvKeys`、检查项和下一步命令；不会返回 `MUAPI_API_KEY` 或 `MUAPI_CHAT_PROBE` 原文。
7. `nextlemon.assert_muapi_real_report`：对 `muapi-real-verification-report.json` 执行真实证据硬断言，要求非 localhost、`account/skills/session/chat/events` 全部通过、`remoteSessionId/remoteJobId` 存在，并且 endpointLog 有 2xx 证据；mock 报告会被拒绝。返回值会包含 `stepEvidence`、`endpointEvidence`、`missingStepIds`、`failedStepIds`、`missingEndpointIds`、`failedEndpoint2xxIds`、`evidenceChecklist`、`blockingEvidenceIds` 和 `evidencePolicy`，外部 Agent 不需要解析错误字符串。
8. `nextlemon.get_release_status`：汇总本地预发布、严格发布、本地 MCP、品牌模板、MuAPI env 和真实证据断言，返回 `web-prerelease-ready`、`strict-release-ready` 或 `not-releasable`，并列出严格发布阻塞项；`localMcp` 会暴露工具数、操作数、审批 schema `oneOf`、操作分类、品牌模板 ready/variant 数、审批 hash、审批策略和 MCP blocker，`muApi.realEvidenceBlockingIds` 会暴露真实证据缺口，例如 `report-readable`、`remote-job-id`、`endpoint-events` 或 `redaction`；本地 MCP 自检期间可传入 `currentLocalMcpReport` 覆盖本轮自检摘要，避免读取磁盘上的旧 `local-mcp-verification-report.json` 造成误报，该覆盖不会影响 MuAPI 真实证据判断。
9. `nextlemon.validate_approval_request`：只校验，不生成文件。
10. `nextlemon.create_approval_request`：生成 `nextlemon.agent-approval-request` 文件。

`nextlemon.list_canvas_agent_ops` 会同时返回 `operationCatalog`、`operationSchema` 和 `approvalRequestSchema`。其中 `approvalRequestSchema.properties.ops.items.oneOf` 必须覆盖全部 15 个 `CanvasAgentOp` 类型，供外部 Agent 在提交前按具体操作参数构造请求。`verify:mcp` 与 readiness 报告还会记录 15 个 `operationTypes` 以及 `{ asset: 3, canvas: 6, workflow: 5, library: 1 }` 分类计数，用于确认外部 Agent 看到的是完整操作目录；`verify:mcp` 的 `reports` 步骤会硬性检查 `nextlemon.read_verification_reports` 是否能读回这些操作类型/分类计数和品牌模板 ID/变体分布，避免报告汇总层丢失颗粒度。

应用内 `window.nextlemonAgentBridge` 暴露同源的 `listBrandTemplates` 与 `createBrandSpec` 方法；它们和 stdio MCP 的 `nextlemon.list_brand_templates` / `nextlemon.create_brand_spec` 共享同一份 `designTemplateService.ts`。如果外部 Agent 已经运行在应用窗口上下文中，应优先走应用内桥；如果是独立进程，则走 stdio MCP。

`nextlemon.get_manifest` 也会声明品牌模板能力：`brandTemplates.supportsVariants`、`supportsAppliedVariants`、`supportsCapabilityMatrix`、`supportsBrandSpecExport`、`supportsVariantBrandSpec`、`brandSpecTool`、`expectedTemplateCount`、`expectedVariantCount`、`expectedAppliedVariantCount` 和推荐调用参数。外部 Agent 可以先读 manifest 决定是否请求模板变体与能力矩阵，再调用 `nextlemon.list_brand_templates` 获取完整目录，或调用 `nextlemon.create_brand_spec` 生成某个品牌/模板/变体组合的规范文档。

`nextlemon.list_brand_templates` 的默认输入可保持 `{}`；当外部 Agent 需要做模板选择、变体推荐或品牌批量生成时，建议传入：

```json
{
  "includePromptGuidance": false,
  "includeVariants": true,
  "includeAppliedVariants": true,
  "includeCapabilityMatrix": true
}
```

此时返回体会包含 `summary.variantCount`、`summary.appliedVariantCount`、`summary.readyTemplateCount`、每个模板的 `variants` 和 `appliedVariants`，以及 `capabilityMatrix`。当前 MCP 自检要求总计 15 个变体、15 个应用后模板摘要、5 个 ready 模板、能力矩阵覆盖 `promptNode`、`imageGeneratorProNode`、`pptContentNode`、`pptAssemblerNode`、`videoGeneratorNode`，且 PPT 模板必须包含 `executive`，视频封面模板必须包含 `motion-hook`。

文件型审批请求格式：

```json
{
  "packageType": "nextlemon.agent-approval-request",
  "schemaVersion": 1,
  "id": "request-id",
  "title": "外部 MCP 写操作",
  "createdAt": 1783300000000,
  "source": "nextlemon-local-mcp",
  "opCount": 1,
  "opSummary": "workflow.selectNodes 1",
  "operationTypes": ["workflow.selectNodes"],
  "approvalPolicy": {
    "writesExecuteDirectly": false,
    "approvalImportRequired": true,
    "requiresUserApproval": true
  },
  "requestHash": "sha256-of-request",
  "ops": [
    {
      "type": "workflow.selectNodes",
      "nodeIds": []
    }
  ]
}
```

在 NextLemon 的本地 Agent 桥面板点击“导入”，即可把该请求送入现有审批队列。`opCount`、`opSummary`、`operationTypes`、`approvalPolicy` 和 `requestHash` 是审计字段；导入后审批事件和审批卡片会保留并展示这些字段，MCP 自检会验证它们存在，并确认写操作不会直接执行。

## 品牌模板

应用内已支持：

- 品牌完整度评分
- 品牌色、字体、Logo、参考图校验
- 模板变体
- 模板交付物、推荐工作流节点、验收标准
- 模板能力矩阵摘要、全局节点类型、当前模板必需节点、必需交付物、变体和逐项 capability checks
- 品牌规范 JSON 导出
- 内置模板目录全量校验

CLI 导出：

```bash
npm run brand:spec -- --input brand-input.json --output brand-spec.json
```

导出的品牌规范包含：

- `templateCapability`：当前模板的必需节点、必需交付物、交付物类型、变体 ID、模型建议和 checks。
- `templateCatalog`：全局模板目录的 required kinds、ready 模板数量、变体数量、workflow node 类型、deliverable 类型和目录 checks。

`brand:spec` CLI 会转译加载真实 `src/services/designTemplateService.ts`，与应用内导出共用 `createBrandSpecDocument`；本地发布验收会拒绝缺少 `templateCapability`、缺少 `templateCatalog`、当前模板 checks 未全通过或全局目录不是 5 个 ready 模板 / 15 个变体的品牌规范。

模板目录硬校验：

```bash
npm run verify:brand:templates -- --json --report releases\brand-template-verification-report.json
```

该命令会转译加载 `src/services/designTemplateService.ts`，读取真实 `DESIGN_TEMPLATES`、`getTemplateVariants` 和 `applyTemplateVariant`。它要求内置模板至少覆盖 `social-image`、`poster`、`brand-board`、`ppt`、`video-cover` 五类，并逐模板验证 `id`、`kind`、`planKind`、`name`、`outputKind`、`promptGuidance`、`deliverables`、`recommendedWorkflowNodes`、`acceptanceCriteria`、`tags`、`modelHint` 等字段。PPT 模板还必须包含 `pptContentNode` 和 `pptAssemblerNode`，视频模板必须包含 `videoSize`，图片类模板必须包含 `aspectRatio` 与图片生成节点。每个模板还必须提供至少 3 个可执行变体，报告会记录 `templateIds`、`readyTemplateIds`、`kindBreakdown`、`variantIdsByTemplate`、`workflowNodeTypesByTemplate`、`deliverableIdsByTemplate`、`capabilityCheckIdsByTemplate` 和 `variants-valid` 检查；当前内置目录为 5 个模板、15 个变体。

本地 MCP 的 `nextlemon.list_brand_templates` 与该校验共用 `designTemplateService.ts`：MCP 会转译加载真实模块，而不是维护一份独立变体清单；`verify:mcp` 会检查 MCP 可读结果中是否包含 15 个变体和 15 个应用后模板摘要，防止外部 Agent 只能看到模板本体却看不到可执行变体。

本地 MCP 的 `nextlemon.create_brand_spec` 同样共用 `createBrandSpecDocument`：`verify:mcp` 会用带 Logo、参考图、品牌色和字体的测试品牌生成 `poster-vertical-campaign` 的 `bold` 变体规范，并校验分数 100、当前模板 3 个变体、全局 5 ready 模板、15 个变体和完整 workflow node 覆盖。

`brand-input.json` 示例：

```json
{
  "brandKit": {
    "id": "brand-1",
    "name": "Example Brand",
    "colors": ["#111827", "#22c55e"],
    "fonts": { "heading": "Inter", "body": "Inter" },
    "tone": "professional",
    "logoAssetId": "logo",
    "referenceAssetIds": ["ref"]
  },
  "assets": [
    { "id": "logo", "kind": "image", "title": "Logo" },
    { "id": "ref", "kind": "image", "title": "Reference" }
  ],
  "template": {
    "id": "poster",
    "kind": "poster",
    "planKind": "image",
    "name": "Poster",
    "outputKind": "image",
    "aspectRatio": "3:4",
    "deliverables": [
      {
        "id": "poster-image",
        "title": "竖版海报",
        "kind": "image",
        "required": true,
        "description": "可直接复用的 3:4 海报图。"
      }
    ],
    "recommendedWorkflowNodes": [
      {
        "nodeType": "promptNode",
        "label": "海报提示词",
        "required": true,
        "purpose": "沉淀海报主题、品牌和版式约束。"
      }
    ],
    "acceptanceCriteria": ["标题、主体、底部信息区层级清楚"],
    "promptGuidance": ["保持层级清晰"],
    "tags": ["poster"]
  }
}
```

## MuAPI 真实服务验证

当前机器没有可用 `MUAPI_API_KEY`，因此无法完成真实远端握手。配置后可执行：

```bash
copy .env.example .env.local
# 填写 MUAPI_API_KEY
npm run verify:muapi:env -- --json --require-real --require-chat
npm run verify:muapi
```

应用内验收：

- 打开创作画布右侧“画布助手”。
- 切换到 `MuAPI Provider`。
- 填写 Base URL、API Key、模型和可选 Chat 探针。
- 开启“严格 chat 验收”后，必须填写 Chat 探针，且验证会继续拉取 job events。
- 验证结果会展示 `real`、端点调用数量、模式、远端 session/job，并可导出 JSON 报告。
- 验证结果还会展示 `strictEvidenceReady`、`blockingEvidenceIds`、各 endpoint 是否有 2xx 证据，以及未通过的证据项；应用内导出的报告和 CLI 报告使用同一套 18 项严格证据口径。

输出 JSON：

```bash
npm run verify:muapi -- --json --report muapi-verification-report.json
```

严格验收 chat 与 job events：

```bash
$env:MUAPI_CHAT_PROBE="请回复一条用于 NextLemon 验收的简短消息"
npm run verify:muapi:env -- --json --require-real --require-chat --report releases\muapi-env-report.json
npm run verify:muapi -- --json --require-chat --report muapi-verification-report.json
npm run verify:muapi:assert-real -- --json --report muapi-verification-report.json
```

严格模式下，chat 响应必须返回 `job_id`、`jobId` 或 `job.id`，验证器随后必须成功拉取 `/api/v1/creative-agent/jobs/{jobId}/events`。缺少 job id、events 证据或必需 endpoint 的 2xx HTTP 状态时，CLI 和应用内验证都会直接失败。

默认验证步骤：

- 读取 `.env.local` / `.env`
- `verify:muapi:env` 可先做不联网前置检查，覆盖 `.env.example`、`.env.local` 密钥保护、Base URL、API Key、模型、Chat 探针和真实服务 URL；使用 `--report` 会写入 `releases\muapi-env-report.json`。
- `verify:muapi:env` 的 JSON 报告会包含 `missingEnvKeys`、`failedEnvKeys`、`apiKeyConfigured`、`chatProbeConfigured` 和 `redaction.secretValuesReturned: false`，placeholder API Key 不会被当作已配置。
- `config`：验证 `MUAPI_API_KEY`、Base URL、模型和是否要求 chat 探针
- 调用 `/api/v1/account/balance`
- 调用 `/api/v1/creative-agent/agent-skills`
- 调用 `/api/v1/creative-agent/sessions` 创建远端会话
- 如果配置 `MUAPI_CHAT_PROBE`，继续调用 chat 探针和 job events
- 应用内与 CLI 报告中都会写入 `endpointLog`，记录真实调用过的 method、path、HTTP status 和耗时
- CLI 报告中 `configured` 表示是否配置了 API Key，`realService` 表示是否实际产生远端 endpoint 调用证据
- CLI 和应用内报告都会写入 `redaction.secretValuesReturned: false`；`verify:muapi:assert-real` 会扫描报告 JSON，发现 `apiKey`、`authorization`、`chatProbe` 等敏感字段或环境中的 `MUAPI_API_KEY` / `MUAPI_CHAT_PROBE` 原文时直接失败。
- `verify:muapi` 自身也会写入 `strictEvidenceReady`、`evidenceChecklist`、`blockingEvidenceIds`、`stepEvidence` 和 `endpointEvidence`。缺少 API Key 时会在报告中标出 `configured`、`step-config`、`remote-session-id`、`remote-job-id` 和各 endpoint blocker；mock 合约报告会保留 `ok: true`，但因 localhost 返回 `strictEvidenceReady: false` 和 `blockingEvidenceIds: ["non-localhost-base-url"]`。

本地合约验收：

```bash
npm run verify:muapi:mock -- --json --report releases\muapi-mock-verification-report.json
```

该命令会启动一个本机 mock MuAPI 服务，并复用 `verify:muapi` 跑通 `account`、`agent-skills`、`session`、`chat`、`job events`。它用于证明 NextLemon 的 MuAPI 适配器和验证器合约链路可执行，不代表真实 MuAPI 服务已经验收通过。

验收通过标准：

- `ok: true`
- `config`、`account`、`skills`、`session` 为 `passed`
- 如果配置了 `MUAPI_CHAT_PROBE` 或使用 `--require-chat`，`chat` 也必须为 `passed`
- 报告文件中记录 `remoteSessionId`
- 严格远端 Agent 验收建议使用 `--require-chat`，并在报告中保留 `remoteJobId` 或 `endpointLog` 中的 job events 调用
- `verify:muapi:assert-real` 必须通过；它会拒绝 localhost/mock 报告，并要求 `account`、`skills`、`session`、`chat`、`events` 全部 passed
- `endpointLog` 中 `account`、`skills`、`session`、`chat`、`events` 对应端点必须包含 2xx HTTP 状态证据
- 真实报告必须通过脱敏扫描，不能包含 API Key、Authorization header、chat 探针原文或类似敏感字段名。
