import { z } from 'zod';

export const ScheduledItemSchema = z.object({
    type: z.enum(["OA", "INTERVIEW"]),
    title: z.string(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime().optional(),
    duration: z.number().optional(),
    companyName: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string().url() })).optional(),
    notes: z.string().optional(),
})

export const IngestEventSchema = z.object({
    userEmail: z.string().email(),
    userId: z.string().optional(),
    provider: z.enum(["gmail", "outlook"]),
    inboxEmail: z.string().email(),
    messageId: z.string(),
    threadId: z.string().optional(),
    receivedAt: z.string().datetime(),
    companyName: z.string(),
    roleTitle: z.string(),
    status: z.enum(["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"]),
    aiSummary: z.string().optional(),
    scheduledItems: z.array(ScheduledItemSchema).optional(),
  });

export type IngestEvent = z.infer<typeof IngestEventSchema>;