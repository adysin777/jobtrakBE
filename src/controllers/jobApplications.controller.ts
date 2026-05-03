import { Request, Response } from "express";
import { z } from "zod";
import {
  listApplicationsService,
  getApplicationEventsService,
  patchApplicationForUser,
  patchApplicationEventForUser,
  createScheduledItemForUser,
  deleteScheduledItemForUser,
  patchScheduledItemForUser,
  patchScheduledItemCompletionForUser,
  deleteApplicationEventForUser,
  deleteArchivedApplicationForUser,
  type ListStatusFilter,
  type ListTimeRange,
} from "../services/jobApplications.service";

const applicationStatusZ = z.enum(["APPLIED", "OA", "INTERVIEW", "OFFER", "REJECTED"]);

const patchApplicationSchema = z
  .object({
    companyName: z.string().trim().min(1).optional(),
    roleTitle: z.string().trim().min(1).optional(),
    appliedAt: z.string().trim().min(1).optional(),
    status: applicationStatusZ.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field required" });

const eventTypeZ = z.enum([
  "OA",
  "INTERVIEW",
  "OFFER",
  "REJECTION",
  "ACKNOWLEDGEMENT",
  "RESCHEDULE",
  "UPDATE",
  "ACTION_REQUIRED",
  "OTHER_UPDATE",
  "CANCELLATION",
  "STAGE_ROLLBACK",
]);

const patchEventSchema = z
  .object({
    eventType: eventTypeZ.optional(),
    status: applicationStatusZ.optional(),
    receivedAt: z.string().trim().min(1).optional(),
    aiSummary: z.string().nullable().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field required" });

const patchScheduledItemCompletionSchema = z
  .object({
    completed: z.boolean(),
  })
  .strict();

const scheduledItemTypeZ = z.enum(["OA", "INTERVIEW", "DEADLINE", "OTHER"]);
const scheduledItemLinkZ = z.object({
  label: z.string().trim().min(1),
  url: z.string().trim().min(1),
});
const scheduledItemBodyShape = {
  type: scheduledItemTypeZ,
  title: z.string().trim().min(1),
  startAt: z.string().trim().min(1),
  endAt: z.string().trim().min(1).nullable().optional(),
  timezone: z.string().trim().min(1),
  notes: z.string().nullable().optional(),
  links: z.array(scheduledItemLinkZ).optional(),
};
const createScheduledItemSchema = z.object(scheduledItemBodyShape).strict();
const patchScheduledItemSchema = z
  .object({
    type: scheduledItemTypeZ.optional(),
    title: z.string().trim().min(1).optional(),
    startAt: z.string().trim().min(1).optional(),
    endAt: z.string().trim().min(1).nullable().optional(),
    timezone: z.string().trim().min(1).optional(),
    notes: z.string().nullable().optional(),
    links: z.array(scheduledItemLinkZ).optional(),
    completed: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: "At least one field required" });

function hasInvalidScheduledItemDate(input: { startAt?: string; endAt?: string | null }) {
  return (
    (input.startAt !== undefined && Number.isNaN(Date.parse(input.startAt))) ||
    (input.endAt !== undefined && input.endAt !== null && Number.isNaN(Date.parse(input.endAt)))
  );
}

export async function listApplications(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const status = (req.query.status as ListStatusFilter) || "all";
    const timeRange = (req.query.timeRange as ListTimeRange) || "all";
    const search = typeof req.query.search === "string" ? req.query.search : undefined;

    const applications = await listApplicationsService(userId, {
      status,
      timeRange,
      search,
    });
    return res.json({ applications });
  } catch (error) {
    console.error("List applications error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function getApplicationEvents(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    if (!applicationId) {
      return res.status(400).json({ error: "Missing application id" });
    }
    const events = await getApplicationEventsService(userId, applicationId);
    return res.json({ events });
  } catch (error) {
    console.error("Get application events error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function patchApplication(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    if (!applicationId) {
      return res.status(400).json({ error: "Missing application id" });
    }
    const parsed = patchApplicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (parsed.data.appliedAt && Number.isNaN(Date.parse(parsed.data.appliedAt))) {
      return res.status(400).json({ error: "Invalid appliedAt" });
    }
    const application = await patchApplicationForUser(userId, applicationId, parsed.data);
    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }
    return res.json({ application });
  } catch (error) {
    console.error("Patch application error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function deleteApplicationEvent(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    const eventId = req.params.eventId;
    if (!applicationId || !eventId) {
      return res.status(400).json({ error: "Missing application or event id" });
    }
    const deleted = await deleteApplicationEventForUser(userId, applicationId, eventId);
    if (!deleted) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.status(204).send();
  } catch (error) {
    console.error("Delete application event error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function deleteApplication(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    if (!applicationId) {
      return res.status(400).json({ error: "Missing application id" });
    }
    const deleted = await deleteArchivedApplicationForUser(userId, applicationId);
    if (!deleted) {
      return res.status(404).json({ error: "Archived application not found" });
    }
    return res.status(204).send();
  } catch (error) {
    console.error("Delete application error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function patchApplicationEvent(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    const eventId = req.params.eventId;
    if (!applicationId || !eventId) {
      return res.status(400).json({ error: "Missing application or event id" });
    }
    const parsed = patchEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (parsed.data.receivedAt && Number.isNaN(Date.parse(parsed.data.receivedAt))) {
      return res.status(400).json({ error: "Invalid receivedAt" });
    }
    const event = await patchApplicationEventForUser(userId, applicationId, eventId, parsed.data);
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.json({ event });
  } catch (error) {
    console.error("Patch application event error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function patchScheduledItemCompletion(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    const scheduledItemId = req.params.scheduledItemId;
    if (!applicationId || !scheduledItemId) {
      return res.status(400).json({ error: "Missing application or scheduled item id" });
    }
    const parsed = patchScheduledItemCompletionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }

    const scheduledItem = await patchScheduledItemCompletionForUser(
      userId,
      applicationId,
      scheduledItemId,
      parsed.data.completed
    );
    if (!scheduledItem) {
      return res.status(404).json({ error: "Scheduled item not found" });
    }
    return res.json({ scheduledItem });
  } catch (error) {
    console.error("Patch scheduled item completion error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function createScheduledItem(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    const eventId = req.params.eventId;
    if (!applicationId || !eventId) {
      return res.status(400).json({ error: "Missing application or event id" });
    }
    const parsed = createScheduledItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (hasInvalidScheduledItemDate(parsed.data)) {
      return res.status(400).json({ error: "Invalid scheduled item date" });
    }

    const scheduledItem = await createScheduledItemForUser(userId, applicationId, eventId, parsed.data);
    if (!scheduledItem) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.status(201).json({ scheduledItem });
  } catch (error) {
    console.error("Create scheduled item error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function patchScheduledItem(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    const scheduledItemId = req.params.scheduledItemId;
    if (!applicationId || !scheduledItemId) {
      return res.status(400).json({ error: "Missing application or scheduled item id" });
    }
    const parsed = patchScheduledItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.flatten() });
    }
    if (hasInvalidScheduledItemDate(parsed.data)) {
      return res.status(400).json({ error: "Invalid scheduled item date" });
    }

    const scheduledItem = await patchScheduledItemForUser(userId, applicationId, scheduledItemId, parsed.data);
    if (!scheduledItem) {
      return res.status(404).json({ error: "Scheduled item not found" });
    }
    return res.json({ scheduledItem });
  } catch (error) {
    console.error("Patch scheduled item error:", error);
    return res.status(500).json({ error: String(error) });
  }
}

export async function deleteScheduledItem(req: Request, res: Response) {
  try {
    const userId = req.userId!;
    const applicationId = req.params.id;
    const scheduledItemId = req.params.scheduledItemId;
    if (!applicationId || !scheduledItemId) {
      return res.status(400).json({ error: "Missing application or scheduled item id" });
    }

    const deleted = await deleteScheduledItemForUser(userId, applicationId, scheduledItemId);
    if (!deleted) {
      return res.status(404).json({ error: "Scheduled item not found" });
    }
    return res.status(204).send();
  } catch (error) {
    console.error("Delete scheduled item error:", error);
    return res.status(500).json({ error: String(error) });
  }
}
