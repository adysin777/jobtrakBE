import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { getPlan } from "../controllers/me.controller";

const router = Router();
router.get("/plan", requireUser, getPlan);

export default router;
