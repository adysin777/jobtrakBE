import { Router } from "express";
import { gmailWebhook } from "../controllers/webhooks.controller";

const router = Router();

// No auth – called by Google Pub/Sub push
router.post("/gmail", gmailWebhook);

export default router;
