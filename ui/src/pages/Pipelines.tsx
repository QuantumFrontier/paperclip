import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Link, useLocation, useNavigate, useParams } from "@/lib/router";
import {
  pipelinesApi,
  type PipelineBatchIngestResult,
  type PipelineIntakeField,
  type PipelineIntakeForm,
} from "../api/pipelines";
import { PageSkeleton } from "../components/PageSkeleton";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

interface DraftRow {
  id: string;
  expanded: boolean;
  values: Record<string, string>;
  serverError?: string | null;
}

type FieldErrors = Record<string, string>;
type RowErrors = Record<string, FieldErrors>;

let draftCounter = 0;

function newDraftRow(expanded = true): DraftRow {
  draftCounter += 1;
  return { id: `draft-${draftCounter}`, expanded, values: {}, serverError: null };
}

function isBlank(value: string | undefined) {
  return !value || value.trim().length === 0;
}

export function validateDraftRows(rows: DraftRow[], fields: PipelineIntakeField[]): RowErrors {
  const errors: RowErrors = {};
  for (const row of rows) {
    const rowErrors: FieldErrors = {};
    for (const field of fields) {
      if (field.required && isBlank(row.values[field.key])) {
        rowErrors[field.key] = `${field.label} is required.`;
      }
    }
    if (Object.keys(rowErrors).length > 0) {
      errors[row.id] = rowErrors;
    }
  }
  return errors;
}

export function buildBatchPayload(rows: DraftRow[], fields: PipelineIntakeField[]) {
  return rows.map((row) => {
    const title = row.values.title?.trim() ?? "";
    const itemFields: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.key === "title") continue;
      const value = row.values[field.key];
      if (value !== undefined && value.trim().length > 0) {
        itemFields[field.key] = value.trim();
      }
    }
    return { title, fields: itemFields };
  });
}

export function plainBatchError(result: Extract<PipelineBatchIngestResult, { ok: false }>) {
  const details = result.error?.details ?? {};
  if (details.code === "required_field" && typeof details.label === "string") {
    return `${details.label} is required.`;
  }
  if (details.code === "invalid_select_value" && typeof details.label === "string") {
    return `${details.label} needs one of the available choices.`;
  }
  if (details.code === "duplicate_batch_key") {
    return "This item duplicates another row.";
  }
  if (details.code === "blocker_cycle") {
    return "This item waits on another row that also waits on it.";
  }
  if (typeof result.error?.message === "string" && result.error.message.trim()) {
    return result.error.message.replace(/^Pipeline\s+/i, "");
  }
  return "This item needs attention before it can be submitted.";
}

function itemCountLabel(count: number) {
  return `${count} ${count === 1 ? "item" : "items"}`;
}

export function Pipelines() {
  const params = useParams<{ pipelineId?: string }>();
  const location = useLocation();
  const pipelineId = params.pipelineId ?? null;
  const addMode = Boolean(pipelineId && location.pathname.endsWith("/add"));

  if (pipelineId && addMode) return <PipelineAddItems pipelineId={pipelineId} />;
  if (pipelineId) return <PipelineBoard pipelineId={pipelineId} />;
  return <PipelinesIndex />;
}

function PipelinesIndex() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => setBreadcrumbs([{ label: "Pipelines" }]), [setBreadcrumbs]);

  const pipelines = useQuery({
    queryKey: selectedCompanyId ? queryKeys.pipelines.list(selectedCompanyId) : ["pipelines", "missing-company"],
    queryFn: () => pipelinesApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });

  if (!selectedCompanyId) {
    return <div className="mx-auto max-w-3xl py-10 text-sm text-muted-foreground">Select a company to view pipelines.</div>;
  }
  if (pipelines.isLoading) return <PageSkeleton />;

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Work</p>
        <h1 className="text-2xl font-semibold text-foreground">Pipelines</h1>
      </div>
      <div className="divide-y border-y border-border">
        {(pipelines.data ?? []).map((pipeline) => (
          <Link
            key={pipeline.id}
            to={`/pipelines/${pipeline.id}`}
            className="grid grid-cols-[1fr_auto] items-center gap-4 py-3 text-sm hover:bg-muted/40"
          >
            <span>
              <span className="block font-medium text-foreground">{pipeline.name}</span>
              {pipeline.description ? (
                <span className="block text-xs text-muted-foreground">{pipeline.description}</span>
              ) : null}
            </span>
            <span className="text-xs text-muted-foreground">{pipeline.openCaseCount} open</span>
          </Link>
        ))}
      </div>
      {pipelines.data?.length === 0 ? (
        <p className="py-10 text-sm text-muted-foreground">No pipelines yet.</p>
      ) : null}
    </div>
  );
}

function PipelineBoard({ pipelineId }: { pipelineId: string }) {
  const { setBreadcrumbs } = useBreadcrumbs();
  const pipeline = useQuery({
    queryKey: queryKeys.pipelines.detail(pipelineId),
    queryFn: () => pipelinesApi.get(pipelineId),
  });
  const items = useQuery({
    queryKey: queryKeys.pipelines.cases(pipelineId),
    queryFn: () => pipelinesApi.listCases(pipelineId),
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Pipelines", href: "/pipelines" }, { label: pipeline.data?.name ?? "Pipeline" }]);
  }, [pipeline.data?.name, setBreadcrumbs]);

  if (pipeline.isLoading) return <PageSkeleton />;
  if (!pipeline.data) return <div className="mx-auto max-w-3xl py-10 text-sm text-muted-foreground">Pipeline not found.</div>;

  const rows = items.data ?? [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Pipeline</p>
          <h1 className="text-2xl font-semibold text-foreground">{pipeline.data.name}</h1>
          <p className="text-sm text-muted-foreground">Items move through the stages below.</p>
        </div>
        <Button asChild>
          <Link to={`/pipelines/${pipelineId}/add`}>
            <Plus className="mr-2 h-4 w-4" />
            Add items
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {pipeline.data.stages.map((stage) => {
          const stageItems = rows.filter((row) => row.case.stageId === stage.id);
          return (
            <section key={stage.id} className="min-h-40 border border-border bg-background p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">{stage.name}</h2>
                <span className="text-xs text-muted-foreground">{itemCountLabel(stageItems.length)}</span>
              </div>
              <div className="space-y-2">
                {stageItems.map((row) => (
                  <div key={row.case.id} className="border border-border bg-muted/20 px-3 py-2 text-sm font-medium text-foreground">
                    {row.case.title}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PipelineAddItems({ pipelineId }: { pipelineId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [rows, setRows] = useState<DraftRow[]>(() => [newDraftRow(true)]);

  const pipeline = useQuery({
    queryKey: queryKeys.pipelines.detail(pipelineId),
    queryFn: () => pipelinesApi.get(pipelineId),
  });
  const intake = useQuery({
    queryKey: queryKeys.pipelines.intakeForm(pipelineId),
    queryFn: () => pipelinesApi.getIntakeForm(pipelineId),
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Pipelines", href: "/pipelines" },
      { label: pipeline.data?.name ?? "Pipeline", href: `/pipelines/${pipelineId}` },
      { label: "Add items" },
    ]);
  }, [pipeline.data?.name, pipelineId, setBreadcrumbs]);

  const fields = intake.data?.fields ?? [];
  const errors = useMemo(() => validateDraftRows(rows, fields), [fields, rows]);
  const invalid = rows.length === 0 || Object.keys(errors).length > 0;

  const submit = useMutation({
    mutationFn: () => pipelinesApi.ingestCasesBatch(pipelineId, { items: buildBatchPayload(rows, fields) }),
    onSuccess: async (results) => {
      const failedByIndex = new Map<number, string>();
      results.forEach((result, index) => {
        if (!result.ok) failedByIndex.set(index, plainBatchError(result));
      });
      if (failedByIndex.size > 0) {
        setRows((current) =>
          current.map((row, index) => ({
            ...row,
            expanded: failedByIndex.has(index) ? true : row.expanded,
            serverError: failedByIndex.get(index) ?? null,
          })),
        );
        return;
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.detail(pipelineId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pipelines.cases(pipelineId) }),
      ]);
      pushToast({ title: `${itemCountLabel(rows.length)} submitted`, tone: "success" });
      navigate(`/pipelines/${pipelineId}`);
    },
  });

  if (pipeline.isLoading || intake.isLoading) return <PageSkeleton />;
  if (!pipeline.data || !intake.data) {
    return <div className="mx-auto max-w-3xl py-10 text-sm text-muted-foreground">Pipeline not found.</div>;
  }

  const firstStageName = intake.data.stageName ?? pipeline.data.stages[0]?.name ?? "first stage";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Add to {pipeline.data.name}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">Build your list, then submit it all at once</h1>
        <p className="text-sm text-muted-foreground">
          Items will be added to the first stage ({firstStageName}).
        </p>
      </div>

      <div className="mb-5 flex items-center gap-2 border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
        <Info className="h-4 w-4 shrink-0" />
        <span>
          These fields come from <span className="font-medium text-foreground">Pipeline settings -&gt; {firstStageName} stage</span>.
        </span>
      </div>

      <div className="space-y-3">
        {rows.map((row, index) => (
          <DraftItemRow
            key={row.id}
            row={row}
            index={index}
            fields={fields}
            intake={intake.data}
            errors={errors[row.id] ?? {}}
            onToggle={() =>
              setRows((current) => current.map((candidate) => candidate.id === row.id ? { ...candidate, expanded: !candidate.expanded } : candidate))
            }
            onRemove={() => setRows((current) => current.filter((candidate) => candidate.id !== row.id))}
            onChange={(fieldKey, value) =>
              setRows((current) =>
                current.map((candidate) =>
                  candidate.id === row.id
                    ? { ...candidate, values: { ...candidate.values, [fieldKey]: value }, serverError: null }
                    : candidate,
                ),
              )
            }
          />
        ))}

        <button
          type="button"
          className="flex h-14 w-full items-center justify-center border border-dashed border-border text-sm font-semibold text-foreground hover:bg-muted/40"
          onClick={() => setRows((current) => [...current, newDraftRow(false)])}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add another item
        </button>
      </div>

      <div className="mt-10 flex items-center justify-between border-t border-border pt-5">
        <Button variant="outline" onClick={() => navigate(`/pipelines/${pipelineId}`)}>
          Cancel
        </Button>
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {rows.length === 0 ? "Add at least one item." : "Count updates live."}
          </span>
          <Button disabled={invalid || submit.isPending} onClick={() => submit.mutate()}>
            {submit.isPending ? "Submitting..." : `Submit ${itemCountLabel(rows.length)}`}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DraftItemRow({
  row,
  index,
  fields,
  intake,
  errors,
  onToggle,
  onRemove,
  onChange,
}: {
  row: DraftRow;
  index: number;
  fields: PipelineIntakeField[];
  intake: PipelineIntakeForm;
  errors: FieldErrors;
  onToggle: () => void;
  onRemove: () => void;
  onChange: (fieldKey: string, value: string) => void;
}) {
  const title = row.values.title?.trim() || `Item ${index + 1}`;
  const preview = fields
    .filter((field) => field.key !== "title")
    .map((field) => row.values[field.key])
    .filter((value): value is string => Boolean(value && value.trim()))
    .slice(0, 2)
    .join(" · ");

  return (
    <section className={cn("border border-border bg-background", row.expanded && "border-primary")}>
      <div className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3">
        <button type="button" className="min-w-0 text-left" onClick={onToggle}>
          <span className="block text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Item {index + 1}</span>
          <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
          {!row.expanded && preview ? <span className="block truncate text-xs text-muted-foreground">{preview}</span> : null}
          {!row.expanded && row.serverError ? <span className="block text-xs text-destructive">{row.serverError}</span> : null}
        </button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={onToggle} aria-label={row.expanded ? "Collapse item" : "Expand item"}>
            {row.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="icon" onClick={onRemove} aria-label="Remove item">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {row.expanded ? (
        <div className="grid gap-5 border-t border-border px-4 py-4 lg:grid-cols-[1fr_280px]">
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <GeneratedField
                key={field.key}
                field={field}
                value={row.values[field.key] ?? ""}
                error={errors[field.key]}
                onChange={(value) => onChange(field.key, value)}
              />
            ))}
            {row.serverError ? <p className="md:col-span-2 text-sm text-destructive">{row.serverError}</p> : null}
          </div>
          <aside className="border border-border p-4 text-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Preview</p>
            <p className="font-semibold text-foreground">{title}</p>
            <p className="mt-3 text-xs text-muted-foreground">First stage on submit:</p>
            <p className="font-semibold text-foreground">{intake.stageName ?? "First stage"}</p>
          </aside>
        </div>
      ) : null}
    </section>
  );
}

export function GeneratedField({
  field,
  value,
  error,
  onChange,
}: {
  field: PipelineIntakeField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const inputId = `pipeline-intake-${field.key}`;
  return (
    <label className={cn("block space-y-1", field.type === "multiline" && "md:col-span-2")}>
      <span className="text-sm font-medium text-foreground">
        {field.label}
        {field.required ? <span className="ml-1 font-normal text-destructive">required</span> : null}
      </span>
      {field.type === "select" ? (
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger id={inputId} aria-invalid={Boolean(error)} className="w-full">
            <SelectValue placeholder="Choose..." />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : field.type === "multiline" ? (
        <Textarea id={inputId} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <Input id={inputId} value={value} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
      )}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </label>
  );
}
