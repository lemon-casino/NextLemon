import type { CreativeAssetKind } from "@/types/creative";

export type BrandVoiceTone =
  | "professional"
  | "friendly"
  | "bold"
  | "minimal"
  | "playful"
  | "custom";

export interface BrandFonts {
  heading?: string;
  body?: string;
}

export interface BrandKit {
  id: string;
  name: string;
  colors: string[];
  fonts: BrandFonts;
  logoAssetId?: string;
  tone: BrandVoiceTone;
  customTone?: string;
  referenceAssetIds: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export type DesignTemplateKind =
  | "social-image"
  | "poster"
  | "brand-board"
  | "ppt"
  | "video-cover";

export type DesignTemplatePlanKind = "image" | "video" | "ppt" | "brand" | "generic";

export interface DesignTemplateDeliverable {
  id: string;
  title: string;
  kind: CreativeAssetKind | "workflow" | "project";
  required: boolean;
  description: string;
}

export interface DesignTemplateWorkflowNode {
  nodeType: string;
  label: string;
  required: boolean;
  purpose: string;
}

export interface DesignTemplate {
  id: string;
  kind: DesignTemplateKind;
  planKind: DesignTemplatePlanKind;
  name: string;
  description: string;
  outputKind: CreativeAssetKind | "workflow";
  defaultBrief: string;
  promptGuidance: string[];
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4" | "3:2" | "2:3" | "5:4" | "4:5" | "21:9";
  videoSize?: "720x1280" | "1280x720" | "1024x1792" | "1792x1024";
  pageCountRange?: string;
  deliverables: DesignTemplateDeliverable[];
  recommendedWorkflowNodes: DesignTemplateWorkflowNode[];
  acceptanceCriteria: string[];
  tags: string[];
  modelHint: string;
}

export interface DesignTemplateVariant {
  id: string;
  name: string;
  description: string;
  briefSuffix: string;
  promptGuidance: string[];
  acceptanceCriteria?: string[];
  tags: string[];
}

export interface BrandValidationIssue {
  id: string;
  severity: "info" | "warning" | "error";
  field: "name" | "colors" | "fonts" | "logo" | "references" | "tone" | "template";
  message: string;
}

export interface BrandValidationReport {
  score: number;
  issues: BrandValidationIssue[];
}

export interface BrandSpecDocument {
  schemaVersion: 1;
  exportedAt: number;
  brandKit: BrandKitSummary;
  template?: DesignTemplateSummary;
  templateCapability?: DesignTemplateCapability;
  templateCatalog?: {
    requiredKinds: DesignTemplateKind[];
    templateCount: number;
    readyTemplateCount: number;
    variantCount: number;
    missingKinds: DesignTemplateKind[];
    outputKinds: string[];
    deliverableKinds: string[];
    workflowNodeTypes: string[];
    checks: DesignTemplateCapabilityCheck[];
  };
  validation: BrandValidationReport;
  assets: {
    logo?: { id: string; title: string };
    references: Array<{ id: string; title: string; kind: CreativeAssetKind }>;
  };
  promptGuidance: string[];
  usageNotes: string[];
}

export interface BrandKitSummary {
  id: string;
  name: string;
  colors: string[];
  fonts: BrandFonts;
  logoAssetId?: string;
  tone: string;
  referenceAssetIds: string[];
}

export interface DesignTemplateSummary {
  id: string;
  kind: DesignTemplateKind;
  planKind: DesignTemplatePlanKind;
  name: string;
  outputKind: CreativeAssetKind | "workflow";
  aspectRatio?: DesignTemplate["aspectRatio"];
  videoSize?: DesignTemplate["videoSize"];
  pageCountRange?: string;
  deliverables: DesignTemplateDeliverable[];
  recommendedWorkflowNodes: DesignTemplateWorkflowNode[];
  acceptanceCriteria: string[];
  promptGuidance: string[];
  tags: string[];
}

export interface DesignTemplateCapabilityCheck {
  id: string;
  status: "passed" | "failed";
  severity: "error" | "warning";
  message: string;
}

export interface DesignTemplateCapability {
  id: string;
  kind: DesignTemplateKind;
  planKind: DesignTemplatePlanKind;
  outputKind: CreativeAssetKind | "workflow";
  format: string;
  modelHint: string;
  tags: string[];
  requiredDeliverableIds: string[];
  optionalDeliverableIds: string[];
  deliverableKinds: Array<CreativeAssetKind | "workflow" | "project">;
  requiredWorkflowNodeTypes: string[];
  optionalWorkflowNodeTypes: string[];
  promptGuidanceCount: number;
  acceptanceCriteriaCount: number;
  variantIds: string[];
  variantCount: number;
  ready: boolean;
  checks: DesignTemplateCapabilityCheck[];
}

export interface DesignTemplateCapabilityMatrix {
  schemaVersion: 1;
  requiredKinds: DesignTemplateKind[];
  templateCount: number;
  readyTemplateCount: number;
  variantCount: number;
  missingKinds: DesignTemplateKind[];
  outputKinds: string[];
  deliverableKinds: string[];
  workflowNodeTypes: string[];
  templates: DesignTemplateCapability[];
  checks: DesignTemplateCapabilityCheck[];
}
