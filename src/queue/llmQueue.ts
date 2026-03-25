import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL!;

export const connection = (() => {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: parseInt(u.port || "6379", 10),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    maxRetriesPerRequest: null,
    tls: redisUrl.startsWith("rediss://") ? {} : undefined,
  };
})();

export const llmQueue = new Queue("llm_queue", {
  connection: connection,
});


