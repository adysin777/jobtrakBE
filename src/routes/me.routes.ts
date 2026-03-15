import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { getPlan, getMe, updateMe } from "../controllers/me.controller";

const router = Router();

router.get("/", requireUser, getMe);
router.patch("/", requireUser, updateMe);
router.get("/plan", requireUser, getPlan);

export default router;
