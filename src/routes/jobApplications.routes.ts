import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import {
  listApplications,
  getApplicationEvents,
  patchApplication,
  patchApplicationEvent,
  createScheduledItem,
  deleteScheduledItem,
  patchScheduledItem,
  deleteApplicationEvent,
  deleteApplication,
} from "../controllers/jobApplications.controller";

const router = Router();
router.get("/", requireUser, listApplications);
router.delete("/:id/events/:eventId", requireUser, deleteApplicationEvent);
router.delete("/:id/scheduled-items/:scheduledItemId", requireUser, deleteScheduledItem);
router.delete("/:id", requireUser, deleteApplication);
router.patch("/:id/events/:eventId", requireUser, patchApplicationEvent);
router.post("/:id/events/:eventId/scheduled-items", requireUser, createScheduledItem);
router.patch("/:id/scheduled-items/:scheduledItemId", requireUser, patchScheduledItem);
router.get("/:id/events", requireUser, getApplicationEvents);
router.patch("/:id", requireUser, patchApplication);
export default router;
