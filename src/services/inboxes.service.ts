import { google } from "googleapis";
import { User } from "../models/User";
import { config } from "../config/env";

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

function formatDateForLog(value?: Date): string {
    return value ? new Date(value).toISOString() : "none";
}

export async function renewGmailWatchIfNeeded(
    userId: string,
    inboxEmail: string,
    gmail?: ReturnType<typeof google.gmail>
): Promise<void> {
    if (!config.gmailPubSubTopic) return;

    const user = await User.findById(userId);
    if (!user) return;

    const inboxIndex = user.connectedInboxes.findIndex(
        (inbox) => inbox.email === inboxEmail.toLowerCase() && inbox.provider === "gmail"
    );
    if (inboxIndex < 0) return;

    const inbox = user.connectedInboxes[inboxIndex];
    const now = Date.now();
    const expirationTime = inbox.watchExpiration ? new Date(inbox.watchExpiration).getTime() : 0;
    const shouldRenew = !expirationTime || expirationTime - now < 24 * 60 * 60 * 1000;
    if (!shouldRenew) {
        console.log(
            `[GmailWatch] Skip renew for ${inbox.email} | status=${inbox.status} | watchExpiration=${formatDateForLog(inbox.watchExpiration)}`
        );
        return;
    }

    const gmailClient = gmail ?? google.gmail({ version: "v1", auth: oauth2Client });
    try {
        console.log(
            `[GmailWatch] Renewing ${inbox.email} | status=${inbox.status} | previousWatchExpiration=${formatDateForLog(inbox.watchExpiration)}`
        );
        const watchRes = await gmailClient.users.watch({
            userId: "me",
            requestBody: { topicName: config.gmailPubSubTopic },
        });

        user.connectedInboxes[inboxIndex].historyId =
            watchRes.data.historyId ?? user.connectedInboxes[inboxIndex].historyId;
        user.connectedInboxes[inboxIndex].watchExpiration = watchRes.data.expiration
            ? new Date(parseInt(watchRes.data.expiration, 10))
            : undefined;
        await user.save();
        console.log(
            `[GmailWatch] Renewed ${inbox.email} | historyId=${user.connectedInboxes[inboxIndex].historyId ?? "none"} | watchExpiration=${formatDateForLog(user.connectedInboxes[inboxIndex].watchExpiration)}`
        );
    } catch (err) {
        console.warn(`Failed to renew Gmail watch for ${inboxEmail}:`, err);
    }
}

export async function connectGmailService(userId: string): Promise<string> {
    const scopes = [
        "https://www.googleapis.com/auth/gmail.readonly", // Full read + history.list (no gmail.metadata – was causing 403 when both requested)
    ]

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: "offline",
        scope: scopes,
        state: userId,
        prompt: "consent"
    })

    return authUrl;
}

export async function gmailCallbackService(userId: string, code: string): Promise<void> {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
        throw new Error("Failed to get tokens from Google");
    }

    // Debug: see what scopes Google actually granted (fixes 403 "Metadata scope doesn't allow format FULL" if readonly is missing)
    const grantedScopes = tokens.scope ? tokens.scope.split(" ").filter(Boolean) : [];
    console.log("[Gmail callback] Granted scopes:", grantedScopes);
    if (!grantedScopes.some((s) => s.includes("gmail.readonly"))) {
        console.warn("[Gmail callback] Missing gmail.readonly – webhook will get 403 when fetching full message. Add this Gmail as Test user in GCP OAuth consent screen if app is in Testing.");
    }

    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: "me" });
    const userEmail = profile.data.emailAddress;

    if (!userEmail) {
        throw new Error("Failed to get email from Gmail profile");
    }

    const expiresAt = tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : new Date(Date.now() + 3600 * 1000);

    const user = await User.findById(userId);
    if (!user) {
        throw new Error("User not found");
    }

    user.connectedInboxes = user.connectedInboxes.filter(
        inbox => !(inbox.email === userEmail.toLowerCase() && inbox.provider === "gmail")
    );

    user.connectedInboxes.push({
        email: userEmail.toLowerCase(),
        provider: "gmail",
        status: "connected",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        createdAt: new Date(),
    });

    await user.save();
    await renewGmailWatchIfNeeded(user._id.toString(), userEmail.toLowerCase(), gmail);
}

export async function disconnectInboxService(userId: string, email: string, provider: "gmail" | "outlook"): Promise<void> {
    const user = await User.findById(userId);
    if (!user) {
        throw new Error("User not found");
    }

    user.connectedInboxes = user.connectedInboxes.filter(
        inbox => !(inbox.email === email.toLowerCase() && inbox.provider === provider)
    );

    await user.save();
}

export interface InboxListItem {
    email: string;
    provider: "gmail" | "outlook";
    status: string;
    createdAt: string;
    expiresAt?: string;
    watchExpiration?: string;
}

export async function listInboxesService(userId: string): Promise<InboxListItem[]> {
    const user = await User.findById(userId).select("connectedInboxes").lean();
    if (!user) return [];
    const inboxes = (user.connectedInboxes as any[]) ?? [];
    return inboxes
        .map((i) => ({
            email: i.email,
            provider: i.provider,
            status: i.status,
            createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : new Date().toISOString(),
            expiresAt: i.expiresAt ? new Date(i.expiresAt).toISOString() : undefined,
            watchExpiration: i.watchExpiration ? new Date(i.watchExpiration).toISOString() : undefined,
        }));
}