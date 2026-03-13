import { Router } from "express";
import { requireUser } from "../middleware/requireUser";
import { createCheckout, createPortal } from "../controllers/billing.controller";

const router = Router();
router.post("/checkout", requireUser, createCheckout);
router.post("/portal", requireUser, createPortal);

export default router;
