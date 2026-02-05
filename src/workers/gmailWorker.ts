import "dotenv/config";
import { google } from "googleapis";
import { User } from "../models/User";
import { llmQueue } from "../queue/llmQueue";
import mongoose from "mongoose";
import { connectDatabase } from "../config/database";
import { UserDailyStats } from "../models/UserDailyStats";
import { disconnectInboxService } from "../services/inboxes.service";

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
);

async function refreshTokenIfNeeded(inbox: any): Promise<string> {
    const now = new Date();
    const expiresAt = new Date(inbox.expiresAt);

    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
        oauth2Client.setCredentials({
            refresh_token: inbox.refreshToken,
        });

        const { credentials } = await oauth2Client.refreshAccessToken();

        if (!credentials.access_token) {
            throw new Error("Failed to refresh token");
        }

        const user = await User.findOne({ "connectedInboxes.email": inbox.email });
        if (user) {
            const inboxIndex = user.connectedInboxes.findIndex(
                i => i.email === inbox.email && i.provider === "gmail"
            );
            if (inboxIndex >= 0) {
                user.connectedInboxes[inboxIndex].accessToken = credentials.access_token;
                if (credentials.expiry_date) {
                    user.connectedInboxes[inboxIndex].expiresAt = new Date(credentials.expiry_date);
                }
                await user.save();
            }
        }

        return credentials.access_token;
    }

    return inbox.accessToken;
}

async function pollGmailInbox(user: any, inbox: any) {
    try {
        const accessToken = await refreshTokenIfNeeded(inbox);

        oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: inbox.refreshToken,
        });

        const gmail = google.gmail({ version: "v1", auth: oauth2Client });

        // Fetch fresh user to get latest lastProcessedMessageId
        const currentUser = await User.findById(user._id);
        if (!currentUser) return;
        
        const inboxIndex = currentUser.connectedInboxes.findIndex(
            (i: any) => i.email === inbox.email && i.provider === "gmail"
        );
        if (inboxIndex < 0) return;
        
        const currentInbox = currentUser.connectedInboxes[inboxIndex];
        const lastProcessedMessageId = currentInbox.lastProcessedMessageId;

        const query = "is:unread newer_than:1d";
        const response = await gmail.users.messages.list({
            userId: "me",
            q: query,
            maxResults: 50,
        });

        const messages = response.data.messages || [];
        let processedCount = 0;
        let newestProcessedMessageId: string | undefined;

        // Gmail returns messages in reverse chronological order (newest first)
        for (const message of messages) {
            if (!message.id) continue;
            
            // Stop if we've reached the last message we processed
            if (lastProcessedMessageId && message.id === lastProcessedMessageId) {
                console.log(`⏸️  Reached last processed message ${lastProcessedMessageId}, stopping`);
                break;
            }

            const msg = await gmail.users.messages.get({
                userId: "me",
                id: message.id,
                format: "full",
            });

            const payload = msg.data.payload;
            const headers = payload?.headers || [];

            const getHeader = (name: string) => 
                headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

            const subject = getHeader("subject");
            const from = getHeader("from");
            const date = getHeader("date");

            let body = "";
            if (payload?.body?.data) {
                body = Buffer.from(payload.body.data, "base64").toString("utf-8");
            } else if (payload?.parts) {
                for (const part of payload.parts) {
                    if (part.body?.data && part.mimeType === "text/plain") {
                        body = Buffer.from(part.body.data, "base64").toString("utf-8");
                    }
                }
            }

            const jobKeywords = ["interview", "application", "offer", "rejection", 
                "assessment", "hackerrank", "oa", "online assessment"
            ];
            const isJobRelated = jobKeywords.some(keyword => 
                subject.toLowerCase().includes(keyword) || body.toLowerCase().includes(keyword)
            );

            if (isJobRelated) {
                await llmQueue.add(
                    "summarize",
                    {
                        userId: user._id.toString(),
                        userEmail: user.primaryEmail,
                        provider: "gmail",
                        inboxEmail: inbox.email,
                        messageId: message.id,
                        threadId: msg.data.threadId,
                        receivedAt: date ? new Date(date).toISOString() : new Date().toISOString(),
                        subject,
                        body,
                        from,
                    },
                    { jobId: `gmail-${message.id}` }
                );

                console.log(`✅ Enqueued Gmail message: ${message.id} from ${inbox.email}`);
                processedCount++;
                
                // Track the newest message ID we've processed (first one in the loop)
                if (!newestProcessedMessageId) {
                    newestProcessedMessageId = message.id;
                }
            }
        }
        
        // Update last processed message ID if we processed any messages
        // Since messages are returned newest first, the first one we process is the newest
        if (newestProcessedMessageId && processedCount > 0) {
            currentUser.connectedInboxes[inboxIndex].lastProcessedMessageId = newestProcessedMessageId;
            currentUser.connectedInboxes[inboxIndex].lastProcessedAt = new Date();
            await currentUser.save();
            console.log(`📝 Updated last processed message ID: ${newestProcessedMessageId} (processed ${processedCount} messages)`);
        }
    } catch (error) {
        console.log(`Error polling Gmail for ${inbox.email}:`, error);
        const currentUser = await User.findById(user._id);
        if (currentUser) {
            const inboxIndex = currentUser.connectedInboxes.findIndex(
                (i: { email: any; provider: string; }) => i.email === inbox.email && i.provider === "gmail"
            );
            if (inboxIndex >= 0) {
                currentUser.connectedInboxes[inboxIndex].status = 'error';
                await currentUser.save();
            }
        }
    }
}

async function pollAllInboxes() {
    try {
        const users = await User.find({
            "connectedInboxes.provider": "gmail",
            "connectedInboxes.status": "connected",
        }).lean();
        
        for (const user of users) {
            const gmailInboxes = user.connectedInboxes.filter(
                inbox => inbox.provider === "gmail" && inbox.status === "connected"
            );

            for (const inbox of gmailInboxes) {
                await pollGmailInbox(user, inbox);
            }
        }
    } catch (error) {
        console.error("Gmail worker error:", error);
    }
}

async function main() {
    await connectDatabase();

    console.log("Gmail worker running...");

    // Poll immediately on start
    await pollAllInboxes();

    // Poll every 5 minutes
    setInterval(pollAllInboxes, 5 * 60 * 1000);
}

main().catch(async (error) => {
    console.error(error);
    await mongoose.connection.close();
    process.exit(1);
});