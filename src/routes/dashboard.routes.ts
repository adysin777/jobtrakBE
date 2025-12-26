import { Router } from "express";
import { requireUser } from "../middleware/requireUser";

const router = Router();

router.get("/", requireUser, async (req, res) => {
    res.json({
        ok: true,
        userId: req.userId,
    });
});

console.log("Mounted /api/dashboard");

export default router;

