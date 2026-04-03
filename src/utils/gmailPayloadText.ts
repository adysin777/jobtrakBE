/**
 * Gmail `messages.get` payloads are often nested (multipart/mixed → multipart/alternative → text/plain).
 * Shallow parsing misses the body and yields empty strings for many real emails.
 */

function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

type GmailPart = {
  mimeType?: string | null;
  body?: { data?: string | null };
  parts?: GmailPart[];
};

function walkMime(
  parts: GmailPart[] | undefined,
  mime: "text/plain" | "text/html"
): string | null {
  if (!parts?.length) return null;
  for (const part of parts) {
    if (part.mimeType === mime && part.body?.data) {
      const t = decodeBase64Url(part.body.data).trim();
      if (t) return mime === "text/html" ? stripHtmlToText(t) : t;
    }
    const nested = walkMime(part.parts, mime);
    if (nested) return nested;
  }
  return null;
}

/**
 * Best-effort plain text for LLM ingest: prefers text/plain, then stripped text/html, recursively.
 */
export function extractGmailMessageText(
  payloadMsg: { body?: { data?: string | null }; parts?: GmailPart[] } | null | undefined
): string {
  if (!payloadMsg) return "";

  if (payloadMsg.body?.data) {
    const top = decodeBase64Url(payloadMsg.body.data).trim();
    if (top) return top;
  }

  const plain = walkMime(payloadMsg.parts, "text/plain");
  if (plain) return plain;

  const html = walkMime(payloadMsg.parts, "text/html");
  if (html) return html;

  return "";
}
