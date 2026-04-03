import mongoose from "mongoose";
import { User } from "../models/User";
import { Application } from "../models/Application";
import { Event } from "../models/Event";
import { ScheduledItem } from "../models/ScheduledItem";
import type { LlmRoutingCandidate, LlmRoutingContextBundle } from "../types/llmIngestContext.types";

export type BuildLlmRoutingContextInput = {
  userEmail: string;
  userId?: string;
  subject: string;
  from: string;
  body: string;
  threadId?: string;
  maxCandidates?: number;
  maxEventsPerApp?: number;
  maxScheduledItemsPerApp?: number;
};

function normalizeWhitespace(str: string): string {
  return str.toLocaleLowerCase().trim().replace(/\s+/g, " ");
}

function tokenize(str: string): string[] {
  return normalizeWhitespace(str)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function tryExtractDomain(from: string): string | null {
  const m = from.match(/@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return m?.[1]?.toLowerCase() ?? null;
}

const MAX_USER_NOTES_LEN = 500;
const MAX_AI_SUMMARY_LEN = 400;

function truncate(str: string | undefined, max: number): string | undefined {
  if (str == null || str === "") return undefined;
  const t = str.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function scoreCandidate(
  app: { companyName?: string; roleTitle?: string; source?: { threadId?: string } },
  input: BuildLlmRoutingContextInput
): number {
  let score = 0;
  if (input.threadId && app?.source?.threadId && app.source.threadId === input.threadId) score += 100;

  const haystack = normalizeWhitespace(`${input.subject}\n${input.from}\n${input.body}`);
  const companyTokens = tokenize(app.companyName ?? "");
  const titleTokens = tokenize(app.roleTitle ?? "");

  const bigCompanyTokens = companyTokens.filter((t) => t.length >= 4);
  for (const t of bigCompanyTokens) {
    if (haystack.includes(t)) score += 10;
  }

  const bigTitleTokens = titleTokens.filter((t) => t.length >= 4);
  for (const t of bigTitleTokens.slice(0, 6)) {
    if (haystack.includes(t)) score += 2;
  }

  const fromDomain = tryExtractDomain(input.from);
  if (fromDomain && typeof app.companyName === "string") {
    const companySimple = tokenize(app.companyName).join("");
    if (companySimple && fromDomain.replace(/\W/g, "").includes(companySimple)) score += 10;
  }

  return score;
}

/**
 * Backend-only: load user, score active applications, attach event + scheduled-item history.
 * Used by POST /api/ingest/email-context for the LLM worker (no DB in worker).
 */
export async function buildLlmRoutingContextForEmail(input: BuildLlmRoutingContextInput): Promise<LlmRoutingContextBundle> {
  const maxCandidates = input.maxCandidates ?? 3;
  const maxEventsPerApp = input.maxEventsPerApp ?? 100;
  const maxScheduledItemsPerApp = input.maxScheduledItemsPerApp ?? 50;

  const user = input.userId
    ? await User.findById(input.userId)
    : await User.findOne({ primaryEmail: input.userEmail });
  if (!user) {
    throw new Error(`User not found for ${input.userEmail}`);
  }

  const userId = user._id as mongoose.Types.ObjectId;

  const apps = await Application.find({ userId, isActive: true }).sort({ lastEventAt: -1 }).limit(50).lean();
  const companyNormCounts = new Map<string, number>();
  for (const a of apps) {
    const n = a.companyNorm ?? "";
    companyNormCounts.set(n, (companyNormCounts.get(n) ?? 0) + 1);
  }
  const scored = apps
    .map((a) => ({
      a,
      score:
        scoreCandidate(a, input) +
        ((companyNormCounts.get(a.companyNorm ?? "") ?? 0) > 1 ? 5 : 0),
    }))
    .sort(
      (x, y) =>
        y.score - x.score ||
        new Date(y.a.lastEventAt ?? 0).getTime() - new Date(x.a.lastEventAt ?? 0).getTime()
    );

  let picked = scored.filter((x) => x.score > 0).slice(0, maxCandidates).map((x) => x.a);

  if (picked.length === 0) {
    picked = apps.slice(0, maxCandidates);
  }

  if (input.threadId) {
    const byThread = apps.find((a) => a.source?.threadId === input.threadId);
    if (byThread) {
      picked = [byThread, ...picked.filter((a) => String(a._id) !== String(byThread._id))].slice(0, maxCandidates);
    }
  }

  const candidates: LlmRoutingCandidate[] = [];
  for (const app of picked) {
    const [recentEvents, scheduledItems] = await Promise.all([
      Event.find({ userId, applicationId: app._id })
        .sort({ receivedAt: -1 })
        .limit(maxEventsPerApp)
        .select({ eventType: 1, status: 1, receivedAt: 1, aiSummary: 1 })
        .lean(),
      ScheduledItem.find({ userId, applicationId: app._id })
        .sort({ startAt: -1 })
        .limit(maxScheduledItemsPerApp)
        .select({ type: 1, title: 1, startAt: 1, endAt: 1, links: 1 })
        .lean(),
    ]);

    candidates.push({
      applicationId: String(app._id),
      companyName: app.companyName,
      roleTitle: app.roleTitle,
      currentStatus: app.status,
      appliedAt: new Date(app.appliedAt).toISOString(),
      location: app.location?.trim() || undefined,
      userNotes: truncate(app.userNotes, MAX_USER_NOTES_LEN),
      aiSummary: truncate(app.aiSummary, MAX_AI_SUMMARY_LEN),
      lastEventAt: app.lastEventAt ? new Date(app.lastEventAt).toISOString() : undefined,
      threadId: app.source?.threadId,
      recentEvents: recentEvents.map((e: any) => ({
        eventType: e.eventType,
        status: e.status,
        receivedAt: new Date(e.receivedAt).toISOString(),
        aiSummary: e.aiSummary,
      })),
      scheduledItems: scheduledItems.map((s: any) => ({
        type: s.type,
        title: s.title,
        startAt: new Date(s.startAt).toISOString(),
        endAt: s.endAt ? new Date(s.endAt).toISOString() : undefined,
        links: s.links,
      })),
    });
  }

  return { userId: userId.toString(), candidates };
}
