import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { connectGmail, gmailCallback, disconnectInbox } from "../controllers/inboxes.controller";

const router = Router();

router.get("/connect/gmail", requireUser, connectGmail);
router.get("/callback/gmail", gmailCallback);
router.post("/disconnect", requireUser, disconnectInbox);

export default router;
