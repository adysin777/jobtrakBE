import { Router } from "express";
import { requireIngestSecret } from "../middleware/requireIngestSecret";
import { ingestJobEvent, ingestEmailContext } from "../controllers/ingest.controller";

const router = Router();
router.post("/job-event", requireIngestSecret, ingestJobEvent);
router.post("/email-context", requireIngestSecret, ingestEmailContext);
export default router;