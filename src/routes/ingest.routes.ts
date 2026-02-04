import { Router } from "express";
import { requireIngestSecret } from "../middleware/requireIngestSecret";
import { ingestJobEvent } from "../controllers/ingest.controller";

const router = Router();
router.post("/job-event", requireIngestSecret, ingestJobEvent);
export default router;