import { Request, Response } from "express";
import { connectGmailService, gmailCallbackService, disconnectInboxService, listInboxesService } from "../services/inboxes.service";
import { notifyDashboardUpdate } from "../services/sse.service";

export async function connectGmail(req: Request, res: Response) {
    try {
        const userId = req.userId!;
        const authUrl = await connectGmailService(userId);
        return res.json({ authUrl });
    } catch (error) {
        console.error("Connect Gmail error:", error);
        return res.status(400).json({ error: String(error) });
    }
}

export async function gmailCallback(req: Request, res: Response) {
    try {
        const code = req.query.code as string;
        const state = req.query.state as string;

        if (!code || !state) {
            return res.status(400).json({ error: "Missing code or state" });
        }

        await gmailCallbackService(state, code);

        notifyDashboardUpdate(state);
        return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/inbox-connected`);
    } catch (error) {
        console.error("Gmail callback error:", error);
        return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/inbox-connected?error=1`);
    }
}

export async function disconnectInbox(req: Request, res: Response) {
    try {
        const userId = req.userId!;
        const { email, provider } = req.body;

        await disconnectInboxService(userId, email, provider);
        return res.json({ ok: true });
    } catch (error) {
        console.error("Disconnect inbox error:", error);
        return res.status(400).json({ error: String(error) });
    }
}

export async function listInboxes(req: Request, res: Response) {
    try {
        const userId = req.userId!;
        const inboxes = await listInboxesService(userId);
        return res.json({ inboxes });
    } catch (error) {
        console.error("List inboxes error:", error);
        return res.status(400).json({ error: String(error) });
    }
}
