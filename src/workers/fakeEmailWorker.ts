import "dotenv/config";
import { llmQueue } from "../queue/llmQueue";

async function main() {
    const messageId = `msg-${Date.now()}`; // Unique ID based on timestamp
    
    const payload = {
        userEmail: "test@uwaterloo.ca",
        provider: "gmail",
        inboxEmail: "test@uwaterloo.ca",
        messageId: messageId,
        threadId: "thread-1",
        receivedAt: new Date().toISOString(),
        subject: "Your interview with SIG",
        body: "We'd like to schedule an interview on March 21st at 10AM. Please confirm your availability.",
        from: "recruiter@sig.com",
    };
  
    await llmQueue.add("summarize", payload, { jobId: messageId });
    console.log("enqueued", messageId);
    process.exit(0);
}

main().catch(console.error);