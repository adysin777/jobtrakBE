import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import {
  listApplications,
  getApplicationEvents,
  patchApplication,
  patchApplicationEvent,
  deleteApplicationEvent,
  deleteApplication,
} from "../controllers/jobApplications.controller";

const router = Router();
router.get("/", requireUser, listApplications);
router.delete("/:id/events/:eventId", requireUser, deleteApplicationEvent);
router.delete("/:id", requireUser, deleteApplication);
router.patch("/:id/events/:eventId", requireUser, patchApplicationEvent);
router.get("/:id/events", requireUser, getApplicationEvents);
router.patch("/:id", requireUser, patchApplication);
export default router;
