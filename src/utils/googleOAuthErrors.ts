/** Safe, short codes for OAuth error redirects (no raw exception text). */
const CALENDAR_REASONS = new Set([
    "access_denied",
    "oauth_provider",
    "missing_code",
    "invalid_state",
    "token_exchange",
    "missing_email",
    "user_not_found",
    "missing_refresh",
    "redirect_uri",
    "invalid_grant",
    "unknown",
]);

const INBOX_REASONS = new Set([
    "access_denied",
    "oauth_provider",
    "missing_code",
    "invalid_state",
    "token_exchange",
    "user_not_found",
    "redirect_uri",
    "invalid_grant",
    "unknown",
]);

export function getFrontendBaseUrl(): string {
    return (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
}

export function googleOAuthQueryReason(oauthError: string | undefined): string {
    if (!oauthError) return "oauth_provider";
    if (oauthError === "access_denied") return "access_denied";
    return "oauth_provider";
}

export function calendarFailureReasonFromError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("redirect_uri_mismatch") || lower.includes("redirect uri")) return "redirect_uri";
    if (lower.includes("invalid_grant")) return "invalid_grant";
    if (lower.includes("missing refresh")) return "missing_refresh";
    if (lower.includes("missing access token")) return "token_exchange";
    if (lower.includes("missing account email")) return "missing_email";
    if (lower.includes("user not found")) return "user_not_found";
    if (lower.includes("gettoken") || lower.includes("invalid code")) return "token_exchange";
    return "unknown";
}

export function inboxFailureReasonFromError(err: unknown): string {
    const msg = err instanceof Error ? err.message : String(err);
    const lower = msg.toLowerCase();
    if (lower.includes("redirect_uri_mismatch") || lower.includes("redirect uri")) return "redirect_uri";
    if (lower.includes("invalid_grant")) return "invalid_grant";
    if (lower.includes("failed to get tokens")) return "token_exchange";
    if (lower.includes("user not found")) return "user_not_found";
    return "unknown";
}

export function calendarErrorPageUrl(reason: string): string {
    const r = CALENDAR_REASONS.has(reason) ? reason : "unknown";
    return `${getFrontendBaseUrl()}/calendar-connected?error=1&reason=${encodeURIComponent(r)}`;
}

export function inboxErrorPageUrl(reason: string): string {
    const r = INBOX_REASONS.has(reason) ? reason : "unknown";
    return `${getFrontendBaseUrl()}/inbox-connected?error=1&reason=${encodeURIComponent(r)}`;
}
