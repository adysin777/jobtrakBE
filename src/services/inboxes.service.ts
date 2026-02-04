import { google } from "googleapis";
import { User } from "../models/User";

const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

export async function connectGmailService(userId: string): Promise<string> {
    const scopes = [
        "https://www.googleapis.com/auth/gmail.readonly", // Read-only access to emails (sufficient for our needs)
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