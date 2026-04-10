import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import {
  listApplications,
  getApplicationEvents,
  patchApplication,
  patchApplicationEvent,
} from "../controllers/jobApplications.controller";

const router = Router();
router.get("/", requireUser, listApplications);
router.patch("/:id/events/:eventId", requireUser, patchApplicationEvent);
router.get("/:id/events", requireUser, getApplicationEvents);
router.patch("/:id", requireUser, patchApplication);
export default router;
