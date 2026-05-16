import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  createClipCommentSchema,
  createClipCreatorProfileSchema,
  createClipImportTelemetrySchema,
  createClipReportSchema,
  createClipRevisionSchema,
  createClipShowcaseSchema,
  createClipVoteSchema,
  publishClipSchema,
  updateClipSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { forbidden } from "../errors.js";
import { assertAuthenticated, assertCompanyAccess, getActorInfo } from "./authz.js";
import { clipService } from "../services/clips.js";
import { logActivity } from "../services/index.js";

const CLIP_RATE_LIMIT_WINDOW_MS = 60_000;
const CLIP_RATE_LIMIT_MAX_REQUESTS = 60;
const clipRateLimitHits = new Map<string, number[]>();

function actorForClip(req: Request) {
  if (req.actor.type === "agent") {
    return {
      actorType: "agent" as const,
      actorId: req.actor.agentId ?? "unknown-agent",
      agentId: req.actor.agentId ?? null,
      userId: null,
    };
  }
  if (req.actor.type === "board") {
    return {
      actorType: "user" as const,
      actorId: req.actor.userId ?? "board",
      agentId: null,
      userId: req.actor.userId ?? null,
    };
  }
  return {
    actorType: "anonymous" as const,
    actorId: "anonymous",
    agentId: null,
    userId: null,
  };
}

function requireAuthenticatedClipActor(req: Request) {
  assertAuthenticated(req);
  const actor = actorForClip(req);
  if (actor.actorType === "anonymous") throw forbidden("Authenticated actor required");
  return actor;
}

function consumeClipRateLimit(req: Request, res: { setHeader(name: string, value: string): void; status(code: number): { json(value: unknown): void } }, action: string) {
  const now = Date.now();
  const cutoff = now - CLIP_RATE_LIMIT_WINDOW_MS;
  const actor = actorForClip(req);
  const ip = req.ip || req.socket.remoteAddress || "unknown-ip";
  const key = `${action}:${actor.actorType}:${actor.actorId}:${ip}`;
  const recent = (clipRateLimitHits.get(key) ?? []).filter((hit) => hit > cutoff);
  if (recent.length >= CLIP_RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.max(1, Math.ceil(((recent[0] ?? now) + CLIP_RATE_LIMIT_WINDOW_MS - now) / 1000));
    clipRateLimitHits.set(key, recent);
    res.setHeader("Retry-After", String(retryAfterSeconds));
    res.status(429).json({ error: "Clip rate limit exceeded", retryAfterSeconds });
    return false;
  }
  recent.push(now);
  clipRateLimitHits.set(key, recent);
  return true;
}

export function clipRoutes(db: Db) {
  const router = Router();
  const svc = clipService(db);

  router.get("/public/clips", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : null;
    const type = typeof req.query.type === "string" ? req.query.type : null;
    const tag = typeof req.query.tag === "string" ? req.query.tag : null;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : undefined;
    res.json(await svc.listPublic({ q, type, tag, limit, offset }));
  });

  router.get("/public/clips/:slug", async (req, res) => {
    const detail = await svc.getPublicDetail(req.params.slug as string);
    if (!detail) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    res.json(detail);
  });

  router.get("/public/clips/:slug/revisions/:revisionNumber", async (req, res) => {
    const revisionNumber = Number(req.params.revisionNumber);
    const detail = Number.isInteger(revisionNumber) && revisionNumber > 0
      ? await svc.getPublicRevision(req.params.slug as string, revisionNumber)
      : null;
    if (!detail) {
      res.status(404).json({ error: "Clip revision not found" });
      return;
    }
    res.json(detail);
  });

  router.get("/public/clips/:slug/manifest", async (req, res) => {
    const detail = await svc.getPublicDetail(req.params.slug as string);
    if (!detail?.currentRevision) {
      res.status(404).json({ error: "Clip manifest not found" });
      return;
    }
    res.json(detail.currentRevision.manifestPayload);
  });

  router.get("/public/clips/:slug/revisions/:revisionNumber/manifest", async (req, res) => {
    const revisionNumber = Number(req.params.revisionNumber);
    const detail = Number.isInteger(revisionNumber) && revisionNumber > 0
      ? await svc.getPublicRevision(req.params.slug as string, revisionNumber)
      : null;
    if (!detail?.currentRevision) {
      res.status(404).json({ error: "Clip manifest not found" });
      return;
    }
    res.json(detail.currentRevision.manifestPayload);
  });

  router.get("/public/creators/:handle", async (req, res) => {
    const profile = await svc.getCreatorPublicProfile(req.params.handle as string);
    if (!profile) {
      res.status(404).json({ error: "Creator profile not found" });
      return;
    }
    res.json(profile);
  });

  router.post("/companies/:companyId/clips/profiles", validate(createClipCreatorProfileSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const profile = await svc.createCreatorProfile(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "clip.profile_created",
      entityType: "clip_creator_profile",
      entityId: profile.id,
      details: { handle: profile.handle },
    });
    res.status(201).json(profile);
  });

  router.post("/companies/:companyId/clips/publish", validate(publishClipSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    if (!consumeClipRateLimit(req, res, "publish")) return;
    const result = await svc.publish(companyId, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "clip.published",
      entityType: "clip",
      entityId: result.clip.id,
      details: {
        slug: result.clip.slug,
        revisionId: result.revision.id,
        revisionNumber: result.revision.revisionNumber,
        visibility: result.clip.visibility,
        status: result.clip.status,
      },
    });
    res.status(201).json(result);
  });

  router.post("/clips/:clipId/revisions", validate(createClipRevisionSchema), async (req, res) => {
    const clip = await svc.getClipById(req.params.clipId as string);
    if (!clip) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    assertCompanyAccess(req, clip.sourceCompanyId);
    if (!consumeClipRateLimit(req, res, "update")) return;
    const result = await svc.createRevision(clip.id, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: clip.sourceCompanyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "clip.revision_published",
      entityType: "clip_revision",
      entityId: result.revision.id,
      details: {
        clipId: clip.id,
        slug: clip.slug,
        revisionNumber: result.revision.revisionNumber,
      },
    });
    res.status(201).json(result);
  });

  router.patch("/clips/:clipId", validate(updateClipSchema), async (req, res) => {
    const clip = await svc.getClipById(req.params.clipId as string);
    if (!clip) {
      res.status(404).json({ error: "Clip not found" });
      return;
    }
    assertCompanyAccess(req, clip.sourceCompanyId);
    const actorInfo = getActorInfo(req);
    const updated = await svc.updateClip(clip.id, req.body, {
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      userId: req.actor.type === "board" ? req.actor.userId ?? null : null,
    });
    await logActivity(db, {
      companyId: clip.sourceCompanyId,
      actorType: actorInfo.actorType,
      actorId: actorInfo.actorId,
      agentId: actorInfo.agentId,
      runId: actorInfo.runId,
      action: req.body.status === "delisted" || req.body.moderationState === "delisted"
        ? "clip.delisted"
        : req.body.moderationState
          ? "clip.moderated"
          : "clip.updated",
      entityType: "clip",
      entityId: clip.id,
      details: {
        slug: clip.slug,
        status: updated.status,
        moderationState: updated.moderationState,
      },
    });
    res.json(updated);
  });

  router.post("/public/clips/:slug/votes", validate(createClipVoteSchema), async (req, res) => {
    const actor = requireAuthenticatedClipActor(req);
    if (!consumeClipRateLimit(req, res, "vote")) return;
    const result = await svc.createVote(req.params.slug as string, req.body, actor);
    await logActivity(db, {
      companyId: result.clip.sourceCompanyId,
      actorType: actor.actorType === "agent" ? "agent" : "user",
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "clip.vote_created",
      entityType: "clip",
      entityId: result.clip.id,
      details: {
        slug: result.clip.slug,
        revisionId: result.revision.id,
        revisionNumber: result.revision.revisionNumber,
        vote: req.body.vote,
      },
    });
    res.status(201).json({ ok: true, metrics: result.clip });
  });

  router.post("/public/clips/:slug/report", validate(createClipReportSchema), async (req, res) => {
    const actor = actorForClip(req);
    if (!consumeClipRateLimit(req, res, "report")) return;
    const clip = await svc.createReport(req.params.slug as string, req.body, actor);
    await logActivity(db, {
      companyId: clip.sourceCompanyId,
      actorType: actor.actorType === "agent" ? "agent" : actor.actorType === "user" ? "user" : "system",
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "clip.report_created",
      entityType: "clip",
      entityId: clip.id,
      details: { slug: clip.slug, reason: req.body.reason, moderationState: clip.moderationState },
    });
    res.status(201).json({ ok: true });
  });

  router.post("/public/clips/:slug/comments", validate(createClipCommentSchema), async (req, res) => {
    const actor = requireAuthenticatedClipActor(req);
    if (!consumeClipRateLimit(req, res, "comment")) return;
    const clip = await svc.createComment(req.params.slug as string, req.body, actor);
    await logActivity(db, {
      companyId: clip.sourceCompanyId,
      actorType: actor.actorType === "agent" ? "agent" : "user",
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "clip.comment_created",
      entityType: "clip",
      entityId: clip.id,
      details: { slug: clip.slug },
    });
    res.status(201).json({ ok: true });
  });

  router.post("/public/clips/:slug/showcase", validate(createClipShowcaseSchema), async (req, res) => {
    const actor = requireAuthenticatedClipActor(req);
    if (!consumeClipRateLimit(req, res, "showcase")) return;
    const clip = await svc.createShowcase(req.params.slug as string, req.body, actor);
    await logActivity(db, {
      companyId: clip.sourceCompanyId,
      actorType: actor.actorType === "agent" ? "agent" : "user",
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "clip.showcase_created",
      entityType: "clip",
      entityId: clip.id,
      details: { slug: clip.slug, validationState: req.body.validationState },
    });
    res.status(201).json({ ok: true });
  });

  router.post("/public/clips/:slug/import-telemetry", validate(createClipImportTelemetrySchema), async (req, res) => {
    if (req.body.destinationCompanyId) {
      assertCompanyAccess(req, req.body.destinationCompanyId);
    }
    if (!consumeClipRateLimit(req, res, "import")) return;
    const actor = actorForClip(req);
    const clip = await svc.recordImportTelemetry(req.params.slug as string, req.body, actor);
    await logActivity(db, {
      companyId: req.body.destinationCompanyId ?? clip.sourceCompanyId,
      actorType: actor.actorType === "agent" ? "agent" : actor.actorType === "user" ? "user" : "system",
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "clip.import_telemetry_created",
      entityType: "clip",
      entityId: clip.id,
      details: { slug: clip.slug, status: req.body.status ?? "previewed" },
    });
    res.status(201).json({ ok: true });
  });

  return router;
}
