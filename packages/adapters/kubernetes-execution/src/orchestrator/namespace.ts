import type { V1Namespace } from "@kubernetes/client-node";
import type { KubernetesApiClient } from "../types.js";
import {
  PSS_ENFORCE, PSS_AUDIT, PSS_WARN, PSS_RESTRICTED,
  tenantBaseLabels, PAPERCLIP_MANAGED_BY, PAPERCLIP_MANAGED_BY_VALUE,
} from "./labels.js";

export interface BuildNamespaceInput {
  name: string;
  companyId: string;
  companySlug: string;
  extraLabels?: Record<string, string>;
}

export function buildNamespace(input: BuildNamespaceInput): V1Namespace {
  return {
    apiVersion: "v1",
    kind: "Namespace",
    metadata: {
      name: input.name,
      labels: {
        ...tenantBaseLabels({ companyId: input.companyId, companySlug: input.companySlug }),
        [PSS_ENFORCE]: PSS_RESTRICTED,
        [PSS_AUDIT]:   PSS_RESTRICTED,
        [PSS_WARN]:    PSS_RESTRICTED,
        ...input.extraLabels,
      },
    },
  };
}

/**
 * Idempotently apply a tenant namespace. Refuses to overwrite a namespace
 * that is not labeled paperclip.ai/managed-by=paperclip.
 */
export async function applyNamespace(
  client: KubernetesApiClient,
  ns: V1Namespace,
): Promise<{ created: boolean }> {
  const name = ns.metadata!.name!;
  try {
    const existing = await client.core.readNamespace(name);
    const managed = existing.body.metadata?.labels?.[PAPERCLIP_MANAGED_BY];
    if (managed !== PAPERCLIP_MANAGED_BY_VALUE) {
      throw new Error(
        `Refusing to manage namespace "${name}": missing label ${PAPERCLIP_MANAGED_BY}=${PAPERCLIP_MANAGED_BY_VALUE}`,
      );
    }
    await client.core.patchNamespace(name, ns, undefined, undefined, undefined, undefined, undefined, {
      headers: { "Content-Type": "application/strategic-merge-patch+json" },
    } as never);
    return { created: false };
  } catch (err: unknown) {
    if (isNotFound(err)) {
      await client.core.createNamespace(ns);
      return { created: true };
    }
    throw err;
  }
}

function isNotFound(err: unknown): boolean {
  const code = (err as { response?: { statusCode?: number } })?.response?.statusCode;
  return code === 404;
}
