import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { getDashboard, getTimeline } from "../controllers/dashboard.controller";

const router = Router();
router.get("/", requireUser, getDashboard);
router.get("/timeline", requireUser, getTimeline);
export default router;

