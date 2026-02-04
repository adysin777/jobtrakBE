import "dotenv/config";
import { llmQueue } from "../queue/llmQueue";

async function main() {
  const waiting = await llmQueue.getWaiting();
  const active = await llmQueue.getActive();
  const completed = await llmQueue.getCompleted();
  const failed = await llmQueue.getFailed();

  console.log("Queue Status:");
  console.log(`  Waiting: ${waiting.length}`);
  console.log(`  Active: ${active.length}`);
  console.log(`  Completed: ${completed.length}`);
  console.log(`  Failed: ${failed.length}`);

  if (waiting.length > 0) {
    console.log("\n Waiting jobs:");
    waiting.forEach((job) => {
      console.log(`  - ${job.id}: ${JSON.stringify(job.data)}`);
    });
  }

  if (active.length > 0) {
    console.log("\n Active jobs:");
    active.forEach((job) => {
      console.log(`  - ${job.id}: ${JSON.stringify(job.data)}`);
    });
  }

  process.exit(0);
}

main().catch(console.error);