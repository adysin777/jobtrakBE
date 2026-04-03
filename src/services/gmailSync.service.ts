import { google } from "googleapis";
import { User } from "../models/User";
import { llmQueue } from "../queue/llmQueue";
import { config } from "../config/env";
import { renewGmailWatchIfNeeded } from "./inboxes.service";
import { extractGmailMessageText } from "../utils/gmailPayloadText";

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

const JOB_KEYWORDS = [
    "interview",
    "application",
    "offer",
    "rejection",
    "assessment",
    "hackerrank",
    "oa",
    "online assessment",
];

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const BACKFILL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

function formatDateForLog(value?: Date): string {
    return value ? new Date(value).toISOString() : "none";
}

function isJobRelated(subject: string, body: string): boolean {
    const s = subject.toLowerCase();
    const b = body.toLowerCase();
    return JOB_KEYWORDS.some((kw) => s.includes(kw) || b.includes(kw));
}

function getHeader(
    headers: Array<{ name?: string | null; value?: string | null }>,
    name: string
): string {
    return headers.find((header) => (header.name ?? "").toLowerCase() === name.toLowerCase())?.value || "";
}

function extractBodyText(payloadMsg: any): string {
    return extractGmailMessageText(payloadMsg);
}

async function refreshAccessTokenIfNeeded(user: any, inboxIndex: number): Promise<string | null> {
    const inbox = user.connectedInboxes[inboxIndex];
    if (!inbox) return null;

    const now = Date.now();
    const expiresAt = new Date(inbox.expiresAt).getTime();
    if (expiresAt - now >= TOKEN_REFRESH_BUFFER_MS) {
        console.log(
            `[GmailSync] Token still valid for ${inbox.email} | expiresAt=${formatDateForLog(inbox.expiresAt)}`
        );
        return inbox.accessToken;
    }

    console.log(
        `[GmailSync] Refreshing token for ${inbox.email} | expiresAt=${formatDateForLog(inbox.expiresAt)}`
    );
    oauth2Client.setCredentials({ refresh_token: inbox.refreshToken });
    try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (!credentials.access_token) {
            throw new Error("Failed to refresh token");
        }

        user.connectedInboxes[inboxIndex].accessToken = credentials.access_token;
        if (credentials.expiry_date) {
            user.connectedInboxes[inboxIndex].expiresAt = new Date(credentials.expiry_date);
        }
        await user.save();
        console.log(
            `[GmailSync] Refreshed token for ${inbox.email} | newExpiresAt=${formatDateForLog(user.connectedInboxes[inboxIndex].expiresAt)}`
        );
        return credentials.access_token;
    } catch (err: any) {
        const data = err?.response?.data;
        if (data?.error === "invalid_grant") {
            user.connectedInboxes[inboxIndex].status = "disconnected";
            await user.save();
            console.warn(
                `Gmail refresh token expired or revoked for ${inbox.email}. Inbox marked disconnected. User must reconnect Gmail.`
            );
            return null;
        }
        throw err;
    }
}

function createGmailClient(accessToken: string, refreshToken: string) {
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });

    return google.gmail({ version: "v1", auth: oauth2Client });
}

async function enqueueMessage(user: any, inbox: any, gmail: any, messageId: string): Promise<void> {
    const msg = await gmail.users.messages.get({
        userId: "me",
        id: messageId,
        format: "full",
    });

    const payloadMsg = msg.data.payload;
    const headers = payloadMsg?.headers || [];
    const subject = getHeader(headers, "subject");
    const from = getHeader(headers, "from");
    const date = getHeader(headers, "date");
    const bodyText = extractBodyText(payloadMsg);

    if (!isJobRelated(subject, bodyText)) return;

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

    user.connectedInboxes[inbox.index].lastProcessedMessageId = messageId;
    user.connectedInboxes[inbox.index].lastProcessedAt = new Date();
    await user.save();
    console.log(`Gmail sync enqueued message: ${messageId} from ${inbox.email}`);
}

async function enqueueMessagesFromHistory(user: any, inboxIndex: number, gmail: any, startHistoryId: string): Promise<boolean> {
    const inboxState = user.connectedInboxes[inboxIndex];
    console.log(
        `[GmailSync] Catch-up via history for ${inboxState.email} | startHistoryId=${startHistoryId}`
    );
    let historyResponse;
    try {
        historyResponse = await gmail.users.history.list({
            userId: "me",
            startHistoryId,
            historyTypes: ["messageAdded"],
            maxResults: 100,
        });
    } catch (err: any) {
        if (err?.code === 404 || err?.message?.includes("historyId")) {
            console.warn(
                `[GmailSync] History catch-up unavailable for ${inboxState.email} | startHistoryId=${startHistoryId}`
            );
            return false;
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

    console.log(
        `[GmailSync] History catch-up found ${messageIds.size} message(s) for ${inboxState.email}`
    );

    const inboxForQueue = { ...user.connectedInboxes[inboxIndex], index: inboxIndex };
    for (const messageId of messageIds) {
        try {
            await enqueueMessage(user, inboxForQueue, gmail, messageId);
        } catch (err) {
            console.error(`Failed to fetch/enqueue message ${messageId}:`, err);
        }
    }

    if (historyResponse.data.historyId) {
        user.connectedInboxes[inboxIndex].historyId = historyResponse.data.historyId;
        await user.save();
    }

    return true;
}

async function backfillRecentMessages(user: any, inboxIndex: number, gmail: any): Promise<void> {
    const inbox = user.connectedInboxes[inboxIndex];
    const lookbackStart = inbox.lastProcessedAt
        ? new Date(inbox.lastProcessedAt)
        : new Date(Date.now() - BACKFILL_LOOKBACK_MS);
    const afterEpochSeconds = Math.floor(lookbackStart.getTime() / 1000);

    const response = await gmail.users.messages.list({
        userId: "me",
        q: `after:${afterEpochSeconds}`,
        maxResults: 100,
    });

    const messages = response.data.messages || [];
    console.log(
        `[GmailSync] Recent backfill for ${inbox.email} | after=${lookbackStart.toISOString()} | found=${messages.length}`
    );
    const inboxWithIndex = { ...inbox, index: inboxIndex };
    for (const message of messages.reverse()) {
        if (!message.id) continue;
        try {
            await enqueueMessage(user, inboxWithIndex, gmail, message.id);
        } catch (err) {
            console.error(`Failed to backfill/enqueue message ${message.id}:`, err);
        }
    }

    user.connectedInboxes[inboxIndex].lastProcessedAt = new Date();
    await user.save();
}

export async function syncGmailInbox(userId: string, inboxEmail: string): Promise<void> {
    if (!config.gmailPubSubTopic) return;

    const user = await User.findById(userId);
    if (!user) return;

    const inboxIndex = user.connectedInboxes.findIndex(
        (inbox) => inbox.email === inboxEmail.toLowerCase() && inbox.provider === "gmail"
    );
    if (inboxIndex < 0) return;

    const inbox = user.connectedInboxes[inboxIndex];
    if (inbox.status === "disconnected") {
        console.log(`[GmailSync] Attempting to reconnect disconnected inbox=${inbox.email}`);
    }
    console.log(
        `[GmailSync] Start inbox=${inbox.email} | status=${inbox.status} | expiresAt=${formatDateForLog(inbox.expiresAt)} | watchExpiration=${formatDateForLog(inbox.watchExpiration)} | historyId=${inbox.historyId ?? "none"} | lastProcessedAt=${formatDateForLog(inbox.lastProcessedAt)}`
    );

    const accessToken = await refreshAccessTokenIfNeeded(user, inboxIndex);
    if (!accessToken) return;

    const latestInbox = user.connectedInboxes[inboxIndex];
    const gmail = createGmailClient(accessToken, latestInbox.refreshToken);

    if (latestInbox.historyId) {
        const syncedFromHistory = await enqueueMessagesFromHistory(user, inboxIndex, gmail, latestInbox.historyId);
        if (!syncedFromHistory) {
            await backfillRecentMessages(user, inboxIndex, gmail);
        }
    } else {
        await backfillRecentMessages(user, inboxIndex, gmail);
    }

    if (user.connectedInboxes[inboxIndex].status !== "connected") {
        user.connectedInboxes[inboxIndex].status = "connected";
        await user.save();
    }

    await renewGmailWatchIfNeeded(user._id.toString(), latestInbox.email, gmail);
    console.log(
        `[GmailSync] Done inbox=${latestInbox.email} | status=${user.connectedInboxes[inboxIndex].status} | watchExpiration=${formatDateForLog(user.connectedInboxes[inboxIndex].watchExpiration)} | historyId=${user.connectedInboxes[inboxIndex].historyId ?? "none"}`
    );
}

export async function renewAllGmailWatches(): Promise<void> {
    if (!config.gmailPubSubTopic) return;

    // Log full Gmail watchlist (all statuses) so you can see every inbox we know about, including disconnected
    const allUsersWithGmail = await User.find({
        "connectedInboxes.provider": "gmail",
    }).select("_id primaryEmail connectedInboxes");
    const fullWatchlist = allUsersWithGmail.flatMap((user) =>
        user.connectedInboxes
            .filter((inbox) => inbox.provider === "gmail")
            .map((inbox) => ({
                user: user.primaryEmail,
                email: inbox.email,
                status: inbox.status,
                watchExpiration: formatDateForLog(inbox.watchExpiration),
                historyId: inbox.historyId ?? "none",
            }))
    );
    console.log("[GmailSync] All Gmail inboxes (watchlist):", JSON.stringify(fullWatchlist, null, 2));

    // Try to sync (and auto-reconnect) every Gmail inbox, including disconnected.
    // If token refresh succeeds we set status back to connected and renew the watch; if invalid_grant we leave disconnected.
    for (const user of allUsersWithGmail) {
        for (const inbox of user.connectedInboxes) {
            if (inbox.provider !== "gmail") continue;
            try {
                await syncGmailInbox(user._id.toString(), inbox.email);
            } catch (err) {
                console.error(`Failed to sync Gmail inbox ${inbox.email}:`, err);
            }
        }
    }
}
