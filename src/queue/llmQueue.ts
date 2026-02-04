import { Queue } from "bullmq";
import IORedis from "ioredis";

export const connection = {
    host: new URL(process.env.REDIS_URL!).hostname,
    port: parseInt(new URL(process.env.REDIS_URL!).port || "6379"),
    password: new URL(process.env.REDIS_URL!).password || undefined
};

export const llmQueue = new Queue("llm_queue", {
  connection: connection,
});

