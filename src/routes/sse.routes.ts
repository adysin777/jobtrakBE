import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { sseHandler } from "../controllers/sse.controller";

const router = Router();
router.get("/", requireUser, sseHandler);
export default router;
