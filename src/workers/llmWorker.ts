import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "../queue/llmQueue";
import fetch from "node-fetch";
import { extractJobEventFromEmail } from "../services/llmExtraction.service";
import { IngestEventSchema } from "../types/ingestEvent.types";
import { config } from "../config/env";

async function postIngest(event: any) {
    IngestEventSchema.parse(event); 

    const res = await fetch(`${config.backendUrl}/api/ingest/job-event`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-INGEST-SECRET": process.env.INGEST_SECRET!,
        },
        body: JSON.stringify(event),
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Ingest failed: ${res.status} ${txt}`);
    }
}

async function main() {
    const worker = new Worker(
        "llm_queue",
        async (job) => {
            try {
                console.log("🔄 Processing job:", job.id);
                const raw = job.data;
                console.log("📧 Raw email data:", raw);

                // Extract using GPT-4o Mini with structured outputs
                const ingestEvent = await extractJobEventFromEmail({
                    subject: raw.subject || "",
                    body: raw.body || "",
                    from: raw.from || "",
                    userEmail: raw.userEmail,
                    userId: raw.userId,
                    provider: raw.provider,
                    inboxEmail: raw.inboxEmail,
                    messageId: raw.messageId,
                    threadId: raw.threadId,
                    receivedAt: raw.receivedAt,
                });

                if (!ingestEvent) {
                    console.log("⏭️  Email not job-related, skipping:", raw.messageId);
                    return; // Skip non-job emails
                }

                if (raw.userId) {
                    ingestEvent.userId = raw.userId;
                }

                console.log("📤 Calling ingestion API...");
                await postIngest(ingestEvent);
                console.log("✅ Successfully ingested job:", job.id);
            } catch (error) {
                console.error(`❌ Error processing job ${job.id}:`, error);
                throw error; // Re-throw to mark job as failed
            }
        },
        { 
            connection,
            concurrency: 3, // Process up to 3 jobs concurrently
        }
    );

    worker.on("completed", (job) => console.log("✅ Job completed:", job.id));
    worker.on("failed", (job, err) => console.error("❌ Job failed:", job?.id, err));
    worker.on("active", (job) => console.log("🔄 Job active:", job.id));

    console.log("🚀 LLM worker running and waiting for jobs...");
}

main().catch(console.error);