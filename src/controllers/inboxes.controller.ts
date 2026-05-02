import { Request, Response } from "express";
import { connectGmailService, gmailCallbackService, disconnectInboxService, listInboxesService } from "../services/inboxes.service";
import { notifyDashboardUpdate } from "../services/sse.service";
import { getUserIdFromCalendarState, googleCalendarCallbackService } from "../services/googleCalendar.service";
import {
    calendarErrorPageUrl,
    calendarFailureReasonFromError,
    googleOAuthQueryReason,
    inboxErrorPageUrl,
    inboxFailureReasonFromError,
} from "../utils/googleOAuthErrors";

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
        const oauthError = req.query.error as string | undefined;
        const code = req.query.code as string | undefined;
        const state = req.query.state as string | undefined;
        const calendarUserId = getUserIdFromCalendarState(state);

        if (calendarUserId) {
            if (oauthError || !code) {
                const reason = oauthError ? googleOAuthQueryReason(oauthError) : "missing_code";
                return res.redirect(calendarErrorPageUrl(reason));
            }
            await googleCalendarCallbackService(calendarUserId, code);
            notifyDashboardUpdate(calendarUserId);
            return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/calendar-connected`);
        }

        if (oauthError) {
            return res.redirect(inboxErrorPageUrl(googleOAuthQueryReason(oauthError)));
        }

        if (!code || !state) {
            return res.redirect(inboxErrorPageUrl("missing_code"));
        }

        await gmailCallbackService(state, code);

        notifyDashboardUpdate(state);
        return res.redirect(`${process.env.FRONTEND_URL || "http://localhost:5173"}/inbox-connected`);
    } catch (error) {
        console.error("Gmail callback error:", error);
        const stateParam = req.query.state as string | undefined;
        const calendarUserId = getUserIdFromCalendarState(stateParam);
        if (calendarUserId) {
            return res.redirect(calendarErrorPageUrl(calendarFailureReasonFromError(error)));
        }
        return res.redirect(inboxErrorPageUrl(inboxFailureReasonFromError(error)));
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
