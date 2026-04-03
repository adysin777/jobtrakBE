import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import mongoose from "mongoose";
import { config } from "../config/env";
import { agentExtractJobEventFromEmail } from "../services/llmAgent.service";
import { buildLlmRoutingContextForEmail } from "../services/ingestContext.service";

type Fixture = {
  name: string;
  email: any;
};

/**
 * --http | USE_HTTP_EMAIL_CONTEXT=true: no Mongo in this script; calls POST /api/ingest/email-context
 * via the agent (same as production worker). Requires API running, INGEST_SECRET, BACKEND_URL.
 * Default: in-process buildLlmRoutingContextForEmail + Mongo (offline dev).
 */
async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--http");
  const useHttp =
    process.argv.includes("--http") || String(process.env.USE_HTTP_EMAIL_CONTEXT || "").toLowerCase() === "true";

  const fixturePath =
    args[0] ?? path.join(process.cwd(), "src", "fixtures", "llmAgentSamples.json");

  const raw = fs.readFileSync(fixturePath, "utf8");
  const fixtures = JSON.parse(raw) as Fixture[];

  if (useHttp) {
    if (!process.env.INGEST_SECRET) {
      throw new Error("HTTP mode requires INGEST_SECRET (and a running API at BACKEND_URL)");
    }
    console.log(`[runLlmAgentFixture] HTTP email-context mode BACKEND_URL=${config.backendUrl}`);
  } else {
    await mongoose.connect(config.mongodbUri);
  }

  for (const f of fixtures) {
    console.log(`\n=== Fixture: ${f.name} ===`);
    try {
      const payload = useHttp
        ? await agentExtractJobEventFromEmail(f.email)
        : await agentExtractJobEventFromEmail(f.email, {
            routingContext: await buildLlmRoutingContextForEmail({
              userEmail: f.email.userEmail,
              userId: f.email.userId,
              subject: f.email.subject ?? "",
              from: f.email.from ?? "",
              body: f.email.body ?? "",
              threadId: f.email.threadId,
            }),
          });
      console.log(payload ? JSON.stringify(payload, null, 2) : "null (not job-related)");
    } catch (err) {
      console.error("Fixture failed:", err);
    }
  }

  if (!useHttp) {
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
