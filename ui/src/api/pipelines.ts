import { api } from "./client";

export interface PipelineListItem {
  id: string;
  companyId: string;
  key: string;
  name: string;
  description: string | null;
  projectId: string | null;
  enforceTransitions: boolean;
  archivedAt: Date | string | null;
  stageCount: number;
  openCaseCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface PipelineStage {
  id: string;
  pipelineId: string;
  key: string;
  name: string;
  kind: string;
  position: number;
  config?: Record<string, unknown> | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface PipelineDetail extends PipelineListItem {
  stages: PipelineStage[];
  transitions: Array<{ fromStageId: string; toStageId: string; label?: string | null }>;
}

export type PipelineIntakeFieldType = "select" | "text" | "multiline";

export interface PipelineIntakeField {
  key: string;
  label: string;
  type: PipelineIntakeFieldType;
  options?: string[];
  required?: boolean;
}

export interface PipelineIntakeForm {
  pipelineId: string;
  stageId: string | null;
  stageName?: string | null;
  fields: PipelineIntakeField[];
}

export interface PipelineCase {
  id: string;
  pipelineId: string;
  stageId: string | null;
  title: string;
  fields?: Record<string, unknown> | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export type PipelineBatchIngestResult =
  | { ok: true; case: PipelineCase; created: boolean }
  | {
      ok: false;
      caseKey: string | null;
      error?: {
        status?: number;
        message?: string;
        details?: Record<string, unknown>;
      };
    };

export const pipelinesApi = {
  list: (companyId: string) => api.get<PipelineListItem[]>(`/companies/${companyId}/pipelines`),
  get: (pipelineId: string) => api.get<PipelineDetail>(`/pipelines/${pipelineId}`),
  getIntakeForm: (pipelineId: string) => api.get<PipelineIntakeForm>(`/pipelines/${pipelineId}/intake-form`),
  listCases: (pipelineId: string) =>
    api.get<Array<{ case: PipelineCase; stage: PipelineStage }>>(`/pipelines/${pipelineId}/cases`),
  ingestCasesBatch: (pipelineId: string, data: { items: Array<{ title: string; fields?: Record<string, unknown> }> }) =>
    api.post<PipelineBatchIngestResult[]>(`/pipelines/${pipelineId}/cases/batch`, data),
};
