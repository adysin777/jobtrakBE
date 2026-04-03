/** Routing context for LLM agent: one candidate application + its history (from backend DB). */
export type LlmRoutingCandidate = {
  applicationId: string;
  companyName: string;
  roleTitle: string;
  currentStatus: string;
  /** ISO 8601 — helps disambiguate parallel roles (e.g. internship terms). */
  appliedAt: string;
  location?: string;
  userNotes?: string;
  aiSummary?: string;
  lastEventAt?: string;
  threadId?: string;
  recentEvents: Array<{
    eventType: string;
    status: string;
    receivedAt: string;
    aiSummary?: string;
  }>;
  scheduledItems: Array<{
    type: string;
    title: string;
    startAt: string;
    endAt?: string;
    links?: Array<{ label: string; url: string }>;
  }>;
};

export type LlmRoutingContextBundle = {
  userId: string;
  candidates: LlmRoutingCandidate[];
};
