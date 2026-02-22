import { Request, Response } from "express";
import { processGmailWebhookPush, type PubSubPushBody } from "../services/gmailWebhook.service";

export async function gmailWebhook(req: Request, res: Response) {
    try {
        const body = req.body as PubSubPushBody;
        await processGmailWebhookPush(body);
        return res.status(200).send();
    } catch (error) {
        console.error("Gmail webhook error:", error);
        if (error instanceof Error && error.message.includes("Missing")) {
            return res.status(400).json({ error: error.message });
        }
        return res.status(500).json({ error: "Webhook processing failed" });
    }
}
