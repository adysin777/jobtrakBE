import mongoose from "mongoose";
import { google } from "googleapis";
import { Application } from "../models/Application";
import { User } from "../models/User";
import { ScheduledItem, type IGoogleScheduledItemSyncState, type IScheduledItem } from "../models/ScheduledItem";

const GOOGLE_CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
export const GOOGLE_CALENDAR_STATE_PREFIX = "gcal:";

export interface GoogleCalendarConnectionView {
    id: string;
    email: string;
    status: "connected" | "error" | "disconnected";
    selectedCalendarId?: string;
    selectedCalendarSummary?: string;
    syncEnabled: boolean;
    createdAt: string;
}

export interface GoogleWritableCalendar {
    id: string;
    summary: string;
    primary: boolean;
    accessRole?: string;
}

export interface GoogleCalendarConnectionPatch {
    selectedCalendarId?: string;
    syncEnabled?: boolean;
}

export interface ScheduledItemDeleteSnapshot {
    scheduledItemId: string;
    googleSync?: Record<string, IGoogleScheduledItemSyncState>;
}

function createOAuthClient() {
    const redirectUri =
        process.env.GOOGLE_CALENDAR_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
    if (!redirectUri?.trim()) {
        throw new Error(
            "Missing GOOGLE_CALENDAR_REDIRECT_URI or GOOGLE_REDIRECT_URI — must match an Authorized redirect URI in Google Cloud Console"
        );
    }
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri.trim()
    );
}

async function listWritableCalendarsWithAuth(
    auth: ReturnType<typeof createOAuthClient>
): Promise<GoogleWritableCalendar[]> {
    const calendar = google.calendar({ version: "v3", auth });
    const response = await calendar.calendarList.list({
        minAccessRole: "writer",
        showDeleted: false,
    });
    const items = response.data.items ?? [];
    return items
        .filter((item) => Boolean(item.id))
        .map((item) => ({
            id: item.id as string,
            summary: item.summary || item.id || "Untitled calendar",
            primary: Boolean(item.primary),
            accessRole: item.accessRole || undefined,
        }));
}

async function archivedApplicationIdsForUser(userIdObj: mongoose.Types.ObjectId): Promise<mongoose.Types.ObjectId[]> {
    const rows = await Application.find({ userId: userIdObj, archived: true }).select("_id").lean();
    return rows.map((r) => (r as { _id: mongoose.Types.ObjectId })._id);
}

/** Same visibility rule as the dashboard calendar: include unassigned items; hide only items tied to archived applications. */
function scheduledItemSyncMatch(
    userIdObj: mongoose.Types.ObjectId,
    archivedIds: mongoose.Types.ObjectId[]
): Record<string, unknown> {
    if (archivedIds.length === 0) return { userId: userIdObj };
    return {
        userId: userIdObj,
        $or: [
            { applicationId: null },
            { applicationId: { $exists: false } },
            { applicationId: { $nin: archivedIds } },
        ],
    };
}

export function getCalendarStateForUser(userId: string): string {
    return `${GOOGLE_CALENDAR_STATE_PREFIX}${userId}`;
}

export function getUserIdFromCalendarState(state?: string): string | null {
    if (!state || !state.startsWith(GOOGLE_CALENDAR_STATE_PREFIX)) return null;
    const userId = state.slice(GOOGLE_CALENDAR_STATE_PREFIX.length).trim();
    return userId || null;
}

/** Stored subdocs may omit syncEnabled; only explicit `false` turns auto-sync off. */
function isCalendarAutoSyncOn(connection: any): boolean {
    return connection.syncEnabled !== false;
}

function hasDestinationCalendarId(connection: any): boolean {
    const id = connection.selectedCalendarId;
    return typeof id === "string" && id.trim().length > 0;
}

function isEligibleGoogleCalendarConnection(connection: any): boolean {
    return (
        (connection.provider ?? "google") === "google" &&
        connection.status === "connected" &&
        isCalendarAutoSyncOn(connection) &&
        hasDestinationCalendarId(connection)
    );
}

function toConnectionView(connection: any): GoogleCalendarConnectionView {
    return {
        id: connection._id.toString(),
        email: connection.email,
        status: connection.status,
        selectedCalendarId: connection.selectedCalendarId || undefined,
        selectedCalendarSummary: connection.selectedCalendarSummary || undefined,
        syncEnabled: isCalendarAutoSyncOn(connection),
        createdAt: new Date(connection.createdAt).toISOString(),
    };
}

function getGoogleSyncRecord(item: IScheduledItem): Record<string, IGoogleScheduledItemSyncState> {
    const sync = item.googleSync;
    if (!sync) return {};
    if (sync instanceof Map) return Object.fromEntries(sync.entries());
    return sync as unknown as Record<string, IGoogleScheduledItemSyncState>;
}

function scheduledItemEndAtForGoogle(item: IScheduledItem, start: Date): Date {
    if (item.endAt) {
        const end = item.endAt instanceof Date ? item.endAt : new Date(item.endAt);
        if (!Number.isNaN(end.getTime()) && end.getTime() > start.getTime()) {
            return end;
        }
    }
    const durationMin =
        typeof item.duration === "number" && item.duration > 0 && item.duration <= 24 * 60
            ? item.duration
            : 60;
    return new Date(start.getTime() + durationMin * 60 * 1000);
}

/**
 * Google requires `end` for non–all-day events. Many JobTrak rows omit `endAt`.
 * Use RFC3339 `dateTime` with Z (UTC) and omit `timeZone` — DB often has non-IANA values like "EST"
 * which Google rejects or mishandles, hiding or misplacing events.
 */
function buildCalendarEventBody(item: IScheduledItem) {
    const details: string[] = [];
    if (item.companyName) details.push(`Company: ${item.companyName}`);
    if (item.roleTitle) details.push(`Role: ${item.roleTitle}`);
    if (item.notes) details.push(`Notes: ${item.notes}`);
    if (Array.isArray(item.links) && item.links.length > 0) {
        details.push("Links:");
        for (const link of item.links) {
            details.push(`- ${link.label}: ${link.url}`);
        }
    }

    const start = item.startAt instanceof Date ? item.startAt : new Date(item.startAt);
    const end = scheduledItemEndAtForGoogle(item, start);

    return {
        summary: item.title,
        description: details.join("\n"),
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        reminders: { useDefault: true },
        extendedProperties: {
            private: {
                jobtrakScheduledItemId: item._id.toString(),
                jobtrakUserId: item.userId.toString(),
            },
        },
    };
}

async function refreshConnectionAccessToken(user: any, connectionId: string): Promise<string | null> {
    const idx = user.connectedCalendars.findIndex((connection: any) => connection._id.toString() === connectionId);
    if (idx < 0) return null;
    const connection = user.connectedCalendars[idx];

    const expiresAtMs = new Date(connection.expiresAt).getTime();
    if (expiresAtMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
        return connection.accessToken;
    }

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({ refresh_token: connection.refreshToken });
    try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (!credentials.access_token) throw new Error("Failed to refresh Google Calendar access token");

        user.connectedCalendars[idx].accessToken = credentials.access_token;
        if (credentials.expiry_date) {
            user.connectedCalendars[idx].expiresAt = new Date(credentials.expiry_date);
        }
        user.connectedCalendars[idx].status = "connected";
        await user.save();
        return credentials.access_token;
    } catch (error: any) {
        const invalidGrant = error?.response?.data?.error === "invalid_grant";
        if (invalidGrant) {
            user.connectedCalendars[idx].status = "disconnected";
            await user.save();
            return null;
        }
        throw error;
    }
}

async function getOAuth2ClientForConnection(
    user: any,
    connectionId: string
): Promise<ReturnType<typeof createOAuthClient> | null> {
    const idx = user.connectedCalendars.findIndex((connection: any) => connection._id.toString() === connectionId);
    if (idx < 0) return null;
    const connection = user.connectedCalendars[idx];
    const accessToken = await refreshConnectionAccessToken(user, connectionId);
    if (!accessToken) return null;

    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: connection.refreshToken,
    });
    return oauth2Client;
}

async function createCalendarClientForConnection(user: any, connectionId: string) {
    const auth = await getOAuth2ClientForConnection(user, connectionId);
    if (!auth) return null;
    return google.calendar({ version: "v3", auth });
}

async function upsertScheduledItemForConnection(
    user: any,
    connectionId: string,
    item: IScheduledItem
): Promise<"created" | "updated" | "skipped"> {
    const connection = user.connectedCalendars.find((entry: any) => entry._id.toString() === connectionId);
    if (!connection || !isEligibleGoogleCalendarConnection(connection)) {
        return "skipped";
    }

    const calendar = await createCalendarClientForConnection(user, connectionId);
    if (!calendar) return "skipped";

    const eventBody = buildCalendarEventBody(item);
    const syncRecord = getGoogleSyncRecord(item)[connectionId];

    if (syncRecord?.eventId) {
        try {
            const patched = await calendar.events.patch({
                calendarId: connection.selectedCalendarId,
                eventId: syncRecord.eventId,
                requestBody: eventBody,
            });
            await ScheduledItem.updateOne(
                { _id: item._id },
                {
                    $set: {
                        [`googleSync.${connectionId}`]: {
                            eventId: patched.data.id ?? syncRecord.eventId,
                            etag: patched.data.etag ?? undefined,
                            updatedAt: new Date(),
                        },
                    },
                }
            );
            return "updated";
        } catch (error: any) {
            const isNotFound = error?.code === 404 || error?.response?.status === 404;
            if (!isNotFound) throw error;
        }
    }

    const inserted = await calendar.events.insert({
        calendarId: connection.selectedCalendarId,
        requestBody: eventBody,
    });
    await ScheduledItem.updateOne(
        { _id: item._id },
        {
            $set: {
                [`googleSync.${connectionId}`]: {
                    eventId: inserted.data.id,
                    etag: inserted.data.etag ?? undefined,
                    updatedAt: new Date(),
                },
            },
        }
    );
    return "created";
}

async function deleteScheduledItemForConnection(
    user: any,
    connectionId: string,
    syncState: IGoogleScheduledItemSyncState | undefined
): Promise<void> {
    if (!syncState?.eventId) return;
    const connection = user.connectedCalendars.find((entry: any) => entry._id.toString() === connectionId);
    if (!connection || !isEligibleGoogleCalendarConnection(connection)) {
        return;
    }
    const calendar = await createCalendarClientForConnection(user, connectionId);
    if (!calendar) return;
    try {
        await calendar.events.delete({
            calendarId: connection.selectedCalendarId,
            eventId: syncState.eventId,
        });
    } catch (error: any) {
        const isNotFound = error?.code === 404 || error?.response?.status === 404;
        if (!isNotFound) throw error;
    }
}

export async function connectGoogleCalendarService(userId: string): Promise<string> {
    const oauth2Client = createOAuthClient();
    return oauth2Client.generateAuthUrl({
        access_type: "offline",
        include_granted_scopes: true,
        prompt: "consent",
        scope: GOOGLE_CALENDAR_SCOPES,
        state: getCalendarStateForUser(userId),
    });
}

export async function googleCalendarCallbackService(userId: string, code: string): Promise<void> {
    const oauth2Client = createOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token) throw new Error("Google Calendar connect failed: missing access token");

    oauth2Client.setCredentials(tokens);
    const oauth2Api = google.oauth2({ version: "v2", auth: oauth2Client });
    const me = await oauth2Api.userinfo.get();
    const email = me.data.email?.toLowerCase().trim();
    if (!email) throw new Error("Google Calendar connect failed: missing account email");

    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");

    const existingIndex = user.connectedCalendars.findIndex(
        (connection: any) => connection.provider === "google" && connection.email === email
    );
    const existingRefreshToken = existingIndex >= 0 ? user.connectedCalendars[existingIndex].refreshToken : undefined;
    /** Incremental OAuth often omits a new refresh_token; same Google account may already have one from Gmail connect. */
    const gmailInbox = user.connectedInboxes.find(
        (inbox: any) => inbox.provider === "gmail" && inbox.email === email && inbox.refreshToken
    );
    const refreshToken =
        tokens.refresh_token || existingRefreshToken || (gmailInbox?.refreshToken as string | undefined);
    if (!refreshToken) {
        throw new Error(
            "Google Calendar connect failed: missing refresh token. Revoke JobTrak under Google Account → Security → Third-party access, then try again."
        );
    }

    let defaultCalendarId: string | undefined;
    let defaultCalendarSummary: string | undefined;
    const priorSelectedId =
        existingIndex >= 0 ? user.connectedCalendars[existingIndex].selectedCalendarId : undefined;
    const needsDefaultCalendar =
        existingIndex < 0 || !priorSelectedId || (typeof priorSelectedId === "string" && !priorSelectedId.trim());
    if (needsDefaultCalendar) {
        try {
            oauth2Client.setCredentials({
                access_token: tokens.access_token,
                refresh_token: refreshToken,
                expiry_date: tokens.expiry_date ?? undefined,
            });
            const writable = await listWritableCalendarsWithAuth(oauth2Client);
            const chosen = writable.find((c) => c.primary) ?? writable[0];
            if (chosen) {
                defaultCalendarId = chosen.id;
                defaultCalendarSummary = chosen.summary;
            }
        } catch (error) {
            console.warn("[GoogleCalendar] Could not list calendars during connect; user must pick destination:", error);
        }
        if (!defaultCalendarId) {
            defaultCalendarId = "primary";
            defaultCalendarSummary = "Primary calendar";
        }
    }

    const nextConnection = {
        provider: "google" as const,
        email,
        status: "connected" as const,
        accessToken: tokens.access_token,
        refreshToken,
        expiresAt: tokens.expiry_date
            ? new Date(tokens.expiry_date)
            : new Date(Date.now() + 60 * 60 * 1000),
        selectedCalendarId:
            existingIndex >= 0
                ? priorSelectedId && String(priorSelectedId).trim()
                    ? priorSelectedId
                    : defaultCalendarId
                : defaultCalendarId,
        selectedCalendarSummary:
            existingIndex >= 0
                ? priorSelectedId && String(priorSelectedId).trim()
                    ? user.connectedCalendars[existingIndex].selectedCalendarSummary
                    : defaultCalendarSummary
                : defaultCalendarSummary,
        syncEnabled:
            existingIndex >= 0 ? isCalendarAutoSyncOn(user.connectedCalendars[existingIndex]) : true,
        createdAt: existingIndex >= 0 ? user.connectedCalendars[existingIndex].createdAt : new Date(),
    };

    if (existingIndex >= 0) {
        user.connectedCalendars.splice(existingIndex, 1, nextConnection as any);
    } else {
        user.connectedCalendars.push(nextConnection as any);
    }
    await user.save();
}

export async function listGoogleCalendarConnectionsService(userId: string): Promise<GoogleCalendarConnectionView[]> {
    const user = await User.findById(userId).select("connectedCalendars").lean();
    if (!user?.connectedCalendars) return [];
    return (user.connectedCalendars as any[])
        .filter((connection) => (connection.provider ?? "google") === "google")
        .map((connection) => toConnectionView(connection));
}

export async function listGoogleCalendarsForConnectionService(
    userId: string,
    connectionId: string
): Promise<GoogleWritableCalendar[]> {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    const connection = user.connectedCalendars.find((entry: any) => entry._id.toString() === connectionId);
    if (!connection) throw new Error("Calendar connection not found");

    const auth = await getOAuth2ClientForConnection(user, connectionId);
    if (!auth) return [];
    const writable = await listWritableCalendarsWithAuth(auth);
    if (writable.length > 0) return writable;
    return [{ id: "primary", summary: "Primary calendar", primary: true }];
}

export async function updateGoogleCalendarConnectionService(
    userId: string,
    connectionId: string,
    patch: GoogleCalendarConnectionPatch
): Promise<GoogleCalendarConnectionView> {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    const idx = user.connectedCalendars.findIndex((entry: any) => entry._id.toString() === connectionId);
    if (idx < 0) throw new Error("Calendar connection not found");

    if (patch.selectedCalendarId !== undefined) {
        user.connectedCalendars[idx].selectedCalendarId = patch.selectedCalendarId || undefined;
        user.connectedCalendars[idx].selectedCalendarSummary = undefined;
        if (patch.selectedCalendarId) {
            const sel = patch.selectedCalendarId.trim();
            if (sel === "primary") {
                user.connectedCalendars[idx].selectedCalendarSummary = "Primary calendar";
            } else {
                const calendars = await listGoogleCalendarsForConnectionService(userId, connectionId);
                const selected = calendars.find((calendar) => calendar.id === sel);
                if (!selected) throw new Error("Selected calendar is not writable");
                user.connectedCalendars[idx].selectedCalendarSummary = selected.summary;
            }
        }
    }

    if (patch.syncEnabled !== undefined) {
        user.connectedCalendars[idx].syncEnabled = patch.syncEnabled;
    }

    await user.save();
    return toConnectionView(user.connectedCalendars[idx]);
}

export async function deleteGoogleCalendarConnectionService(userId: string, connectionId: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    const idx = user.connectedCalendars.findIndex((entry: any) => entry._id.toString() === connectionId);
    if (idx < 0) return;

    const connection = user.connectedCalendars[idx];
    const oauth2Client = createOAuthClient();
    oauth2Client.setCredentials({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
    });
    try {
        await oauth2Client.revokeToken(connection.accessToken);
    } catch (error) {
        console.warn(`Failed to revoke Google calendar token for ${connection.email}:`, error);
    }

    user.connectedCalendars.splice(idx, 1);
    await user.save();
}

export async function manualSyncGoogleCalendarsService(userId: string) {
    const user = await User.findById(userId);
    if (!user) throw new Error("User not found");
    const enabledConnections = user.connectedCalendars.filter((connection: any) =>
        isEligibleGoogleCalendarConnection(connection)
    );
    if (enabledConnections.length === 0) {
        return { syncedCount: 0, skippedCount: 0, connectionCount: 0, itemCount: 0 };
    }

    const userIdObj = new mongoose.Types.ObjectId(userId);
    const archivedIds = await archivedApplicationIdsForUser(userIdObj);
    const scheduledItems = await ScheduledItem.find(scheduledItemSyncMatch(userIdObj, archivedIds));

    let syncedCount = 0;
    let skippedCount = 0;
    for (const item of scheduledItems) {
        for (const connection of enabledConnections) {
            const result = await upsertScheduledItemForConnection(user, connection._id.toString(), item);
            if (result === "skipped") skippedCount += 1;
            else syncedCount += 1;
        }
    }

    return {
        syncedCount,
        skippedCount,
        connectionCount: enabledConnections.length,
        itemCount: scheduledItems.length,
    };
}

export async function syncScheduledItemToGoogle(userId: string, scheduledItemId: string): Promise<void> {
    const [user, item] = await Promise.all([
        User.findById(userId),
        ScheduledItem.findById(scheduledItemId),
    ]);
    if (!user || !item) return;

    const userIdObj = new mongoose.Types.ObjectId(userId);
    const archivedIds = await archivedApplicationIdsForUser(userIdObj);
    if (
        item.applicationId &&
        archivedIds.some((id) => id.equals(item.applicationId as mongoose.Types.ObjectId))
    ) {
        return;
    }

    const enabledConnections = user.connectedCalendars.filter((connection: any) =>
        isEligibleGoogleCalendarConnection(connection)
    );
    for (const connection of enabledConnections) {
        await upsertScheduledItemForConnection(user, connection._id.toString(), item);
    }
}

export function enqueueScheduledItemUpsert(userId: string, scheduledItemId: string): void {
    void syncScheduledItemToGoogle(userId, scheduledItemId).catch((error) => {
        console.error(`[GoogleCalendar] Failed syncing scheduled item ${scheduledItemId}:`, error);
    });
}

export async function deleteScheduledItemFromGoogle(
    userId: string,
    snapshot: ScheduledItemDeleteSnapshot
): Promise<void> {
    const user = await User.findById(userId);
    if (!user || !snapshot.googleSync) return;
    const entries = Object.entries(snapshot.googleSync);
    for (const [connectionId, syncState] of entries) {
        await deleteScheduledItemForConnection(user, connectionId, syncState);
    }
}

export function enqueueScheduledItemDelete(userId: string, snapshot: ScheduledItemDeleteSnapshot): void {
    void deleteScheduledItemFromGoogle(userId, snapshot).catch((error) => {
        console.error(
            `[GoogleCalendar] Failed deleting scheduled item ${snapshot.scheduledItemId} from Google:`,
            error
        );
    });
}
