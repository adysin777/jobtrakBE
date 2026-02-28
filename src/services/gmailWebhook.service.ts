import { google } from "googleapis";
import { User } from "../models/User";
import { llmQueue } from "../queue/llmQueue";

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const JOB_KEYWORDS = [
    "interview", "application", "offer", "rejection",
    "assessment", "hackerrank", "oa", "online assessment",
];

function isJobRelated(subject: string, body: string): boolean {
    const s = subject.toLowerCase();
    const b = body.toLowerCase();
    return JOB_KEYWORDS.some(kw => s.includes(kw) || b.includes(kw));
}

async function refreshTokenIfNeeded(inbox: { accessToken: string; refreshToken: string; expiresAt: Date }): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(inbox.expiresAt);
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
        oauth2Client.setCredentials({ refresh_token: inbox.refreshToken });
        try {
            const { credentials } = await oauth2Client.refreshAccessToken();
            if (!credentials.access_token) throw new Error("Failed to refresh token");
            return credentials.access_token;
        } catch (err: unknown) {
            const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
            if (data?.error === "invalid_grant") {
                const e = new Error("GMAIL_REFRESH_TOKEN_REVOKED") as Error & { code: string };
                e.code = "GMAIL_REFRESH_TOKEN_REVOKED";
                throw e;
            }
            throw err;
        }
    }
    return inbox.accessToken;
}

export interface PubSubPushBody {
    message?: {
        data?: string;
        messageId?: string;
        publishTime?: string;
    };
    subscription?: string;
}

export interface GmailNotificationPayload {
    emailAddress: string;
    historyId: string;
}

/**
 * Process a Pub/Sub push from Gmail: decode notification, fetch history, enqueue new messages.
 */
export async function processGmailWebhookPush(body: PubSubPushBody): Promise<void> {
    const message = body.message;
    if (!message?.data) {
        throw new Error("Missing message.data");
    }

    const decoded = Buffer.from(message.data, "base64").toString("utf-8");
    let payload: GmailNotificationPayload;
    try {
        payload = JSON.parse(decoded) as GmailNotificationPayload;
    } catch {
        throw new Error("Invalid message.data JSON");
    }

    const { emailAddress, historyId: notificationHistoryId } = payload;
    if (!emailAddress || !notificationHistoryId) {
        throw new Error("Missing emailAddress or historyId");
    }

    const user = await User.findOne({
        "connectedInboxes.email": emailAddress.toLowerCase(),
        "connectedInboxes.provider": "gmail",
    });
    if (!user) {
        console.warn(`Gmail webhook: no user found for ${emailAddress}`);
        return;
    }

    const inboxIndex = user.connectedInboxes.findIndex(
        i => i.email === emailAddress.toLowerCase() && i.provider === "gmail"
    );
    if (inboxIndex < 0) return;

    const inbox = user.connectedInboxes[inboxIndex];
    const storedHistoryId = inbox.historyId;

    let accessToken: string;
    try {
        accessToken = await refreshTokenIfNeeded(inbox);
    } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "GMAIL_REFRESH_TOKEN_REVOKED") {
            user.connectedInboxes[inboxIndex].status = "disconnected";
            await user.save();
            console.warn(
                `Gmail refresh token expired or revoked for ${inbox.email}. Inbox marked disconnected. User must reconnect Gmail.`
            );
            return;
        }
        throw err;
    }

    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: inbox.refreshToken,
    });
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    const startHistoryId = storedHistoryId || notificationHistoryId;
    let historyResponse;
    try {
        historyResponse = await gmail.users.history.list({
            userId: "me",
            startHistoryId,
            historyTypes: ["messageAdded"],
            maxResults: 100,
        });
    } catch (err) {
        if ((err as { code?: number }).code === 404 || (err as { message?: string }).message?.includes("historyId")) {
            // History no longer available; just update historyId and ack
            user.connectedInboxes[inboxIndex].historyId = notificationHistoryId;
            await user.save();
            return;
        }
        throw err;
    }

    const historyRecords = historyResponse.data.history || [];
    const messageIds = new Set<string>();

    for (const record of historyRecords) {
        const added = record.messagesAdded || [];
        for (const entry of added) {
            const msg = entry.message;
            if (msg?.id) messageIds.add(msg.id);
        }
    }

    for (const messageId of messageIds) {
        try {
            const msg = await gmail.users.messages.get({
                userId: "me",
                id: messageId,
                format: "full",
            });
            const payloadMsg = msg.data.payload;
            const headers = payloadMsg?.headers || [];
            const getHeader = (name: string) =>
                headers.find(
                    (h: { name?: string | null; value?: string | null }) =>
                        (h.name ?? '').toLowerCase() === name.toLowerCase()
                )?.value || "";

            const subject = getHeader("subject");
            const from = getHeader("from");
            const date = getHeader("date");

            let bodyText = "";
            if (payloadMsg?.body?.data) {
                bodyText = Buffer.from(payloadMsg.body.data, "base64").toString("utf-8");
            } else if (payloadMsg?.parts) {
                for (const part of payloadMsg.parts) {
                    if (part.body?.data && part.mimeType === "text/plain") {
                        bodyText = Buffer.from(part.body.data, "base64").toString("utf-8");
                        break;
                    }
                }
            }

            if (!isJobRelated(subject, bodyText)) continue;

            await llmQueue.add(
                "summarize",
                {
                    userId: user._id.toString(),
                    userEmail: user.primaryEmail,
                    provider: "gmail",
                    inboxEmail: inbox.email,
                    messageId,
                    threadId: msg.data.threadId,
                    receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
                    subject,
                    body: bodyText,
                    from,
                },
                { jobId: `gmail-${messageId}` }
            );
            console.log(`Webhook enqueued Gmail message: ${messageId} from ${inbox.email}`);
        } catch (err) {
            console.error(`Failed to fetch/enqueue message ${messageId}:`, err);
        }
    }

    user.connectedInboxes[inboxIndex].historyId = notificationHistoryId;
    await user.save();
}
