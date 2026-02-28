import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "../queue/llmQueue";
import { extractJobEventFromEmail } from "../services/llmExtraction.service";
import { config } from "../config/env";

async function postIngest(payload: any) {
    const res = await fetch(`${config.backendUrl}/api/ingest/job-event`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-INGEST-SECRET": process.env.INGEST_SECRET!,
        },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`Ingest failed: ${res.status} ${txt}`);
    }
}

async function processJobEvent(raw: any) {
    const payload = await extractJobEventFromEmail({
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

    if (!payload) {
        console.log("⏭️  Email not job-related, skipping:", raw.messageId);
        return;
    }

    if (raw.userId) payload.userId = raw.userId;

    console.log("📤 Sending event payload to backend...");
    await postIngest(payload);
}

async function main() {
    const worker = new Worker(
        "llm_queue",
        async (job) => {
            try {
                console.log("🔄 Processing job:", job.id);
                const raw = job.data;
                console.log("📧 Raw email data:", raw);

                // Extract → POST EventPayload to backend (backend owns DB: create Event + assign)
                console.log("📤 Sending event payload to backend...");
                await processJobEvent(raw);
                console.log("✅ Successfully processed job:", job.id);
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