// @vitest-environment jsdom

import { act } from "react";
import type { AnchorHTMLAttributes } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineBatchIngestResult, PipelineIntakeField } from "../api/pipelines";
import { buildBatchPayload, GeneratedField, plainBatchError, validateDraftRows } from "./Pipelines";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => (
    <a href={to} {...props}>{children}</a>
  ),
  useLocation: () => ({ pathname: "/pipelines/pipeline-1/add" }),
  useNavigate: () => vi.fn(),
  useParams: () => ({ pipelineId: "pipeline-1" }),
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "company-1" }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const fields: PipelineIntakeField[] = [
  { key: "title", label: "Name", type: "text", required: true },
  { key: "kind", label: "Type", type: "select", required: true, options: ["Blog post", "Launch tweet"] },
  { key: "notes", label: "Notes for the agent", type: "multiline", required: false },
];

describe("pipeline add-items helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders generated fields from the intake schema", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <div>
          {fields.map((field) => (
            <GeneratedField key={field.key} field={field} value="" onChange={() => undefined} />
          ))}
        </div>,
      );
    });

    expect(container.textContent).toContain("Name");
    expect(container.textContent).toContain("Type");
    expect(container.textContent).toContain("Notes for the agent");
    expect(container.querySelector("input")).not.toBeNull();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("validates required fields from the intake schema", () => {
    const errors = validateDraftRows(
      [
        { id: "row-1", expanded: true, values: { title: "", kind: "" } },
        { id: "row-2", expanded: true, values: { title: "Launch blog post", kind: "Blog post" } },
      ],
      fields,
    );

    expect(errors["row-1"]).toEqual({
      title: "Name is required.",
      kind: "Type is required.",
    });
    expect(errors["row-2"]).toBeUndefined();
  });

  it("maps generated fields into the batch ingest payload", () => {
    const payload = buildBatchPayload(
      [
        {
          id: "row-1",
          expanded: true,
          values: {
            title: " Launch blog post ",
            kind: "Blog post",
            notes: " Keep it plain. ",
          },
        },
      ],
      fields,
    );

    expect(payload).toEqual([
      {
        title: "Launch blog post",
        fields: {
          kind: "Blog post",
          notes: "Keep it plain.",
        },
      },
    ]);
  });

  it("translates server row failures into plain language", () => {
    const result: PipelineBatchIngestResult = {
      ok: false,
      caseKey: null,
      error: {
        details: { code: "required_field", label: "Audience" },
      },
    };

    expect(plainBatchError(result)).toBe("Audience is required.");
  });
});
