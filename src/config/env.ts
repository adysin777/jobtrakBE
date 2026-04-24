import dotenv from 'dotenv'

dotenv.config();

const requiredEnvVars = ['MONGODB_URI', 'PORT', 'NODE_ENV'];

requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
    }
});

function parseCommaList(value: string | undefined): string[] {
    if (!value || !value.trim()) return [];
    return value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
}

export const config = {
    mongodbUri: process.env.MONGODB_URI!,
    port: parseInt(process.env.PORT!, 10),
    nodeEnv: process.env.NODE_ENV!,
    ingestSecret: process.env.INGEST_SECRET || "",
    backendUrl: process.env.BACKEND_URL || `http://localhost:${parseInt(process.env.PORT!, 10)}`,
    gmailPubSubTopic: process.env.GMAIL_PUBSUB_TOPIC || "",
    publicUrl: process.env.PUBLIC_URL || "",
    /** Extra browser origins allowed by CORS (e.g. ngrok preview URLs). Comma-separated in CORS_ALLOWED_ORIGINS. */
    corsAllowedOrigins: parseCommaList(process.env.CORS_ALLOWED_ORIGINS),
};
