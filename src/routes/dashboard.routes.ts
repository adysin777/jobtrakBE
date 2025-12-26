import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { getDashboard } from "../controllers/dashboard.controller";

const router = Router();
router.get("/", requireUser, getDashboard);
export default router;

