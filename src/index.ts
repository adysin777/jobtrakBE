import express from 'express';
import { connectDatabase } from './config/database';
import { config } from './config/env';
import { clerkMiddleware } from '@clerk/express';

import dashboardRoutes from "./routes/dashboard.routes";
import calendarRoutes from "./routes/calendar.routes";
import ingestRoutes from "./routes/ingest.routes";
import inboxRoutes from "./routes/inboxes.routes";
import billingRoutes from "./routes/billing.routes";
import meRoutes from "./routes/me.routes";
import jobApplicationsRoutes from "./routes/jobApplications.routes";
import sseRoutes from "./routes/sse.routes";
import webhooksRoutes from "./routes/webhooks.routes";
import { renewAllGmailWatches } from "./services/gmailSync.service";

import mongoose from "mongoose";

import cors from 'cors'

const allowedOrigins = [
    "http://localhost:5173", // Vite
    "http://localhost:3000", // if you ever use CRA/Next dev
];

const app = express();

// Stripe webhook needs the raw body for signature verification.
// Define this endpoint before JSON body parsing.
import { stripeWebhook } from "./controllers/stripeWebhook.controller";
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
    cors({
        origin: (origin, cb) => {
            // allow non-browser tools like curl/postman (no origin header)
            if (!origin) return cb(null, true);
            if (allowedOrigins.includes(origin)) return cb(null, true);
            return cb(new Error(`CORS blocked for origin: ${origin}`));
        },
        credentials: true,
    })
);

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.send("okk"));

// EventSource cannot send Authorization header; copy ?token= to header for SSE route
app.use((req, res, next) => {
    const token = req.query.token;
    if (typeof token === "string" && token) {
        req.headers.authorization = `Bearer ${token}`;
    }
    next();
});

app.use(clerkMiddleware());

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/ingest", ingestRoutes);
app.use("/api/inboxes", inboxRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/me", meRoutes);
app.use("/api/applications", jobApplicationsRoutes);
app.use("/api/sse", sseRoutes);
app.use("/api/webhooks", webhooksRoutes);

app.get("/debug/db", (req, res) => {
    res.json({
    pid: process.pid,
    readyState: mongoose.connection.readyState, // 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
    host: mongoose.connection.host,
    name: mongoose.connection.name,
    });
});

const startServer = async () => {
    try {
        await connectDatabase();

        app.listen(config.port, () => {
            console.log(`Server is running on PORT ${config.port}`);
        });

        if (config.gmailPubSubTopic) {
            let renewalInFlight = false;
            const runRenewal = async () => {
                if (renewalInFlight) return;
                renewalInFlight = true;
                try {
                    await renewAllGmailWatches();
                } catch (error) {
                    console.error("Gmail watch renewal job failed:", error);
                } finally {
                    renewalInFlight = false;
                }
            };

            void runRenewal();
            setInterval(() => {
                void runRenewal();
            }, 6 * 60 * 60 * 1000);
        }
    } catch (error) {
        console.error("Failed to start server", error);
        process.exit(1);
    }
}

startServer();
