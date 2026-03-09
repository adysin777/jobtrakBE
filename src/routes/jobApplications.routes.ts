import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { listApplications, getApplicationEvents } from "../controllers/jobApplications.controller";

const router = Router();
router.get("/", requireUser, listApplications);
router.get("/:id/events", requireUser, getApplicationEvents);
export default router;
