import express from 'express';
import { connectDatabase } from './config/database';
import { config } from './config/env';
import { clerkMiddleware } from '@clerk/express';

import dashboardRoutes from "./routes/dashboard.routes";
import calendarRoutes from "./routes/calendar.routes";
import ingestRoutes from "./routes/ingest.routes";
import inboxRoutes from "./routes/inboxes.routes";
import webhooksRoutes from "./routes/webhooks.routes";

import mongoose from "mongoose";

import cors from 'cors'

const allowedOrigins = [
    "http://localhost:5173", // Vite
    "http://localhost:3000", // if you ever use CRA/Next dev
];

const app = express();

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

app.use(clerkMiddleware());

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/ingest", ingestRoutes);
app.use("/api/inboxes", inboxRoutes);
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
    } catch (error) {
        console.error("Failed to start server", error);
        process.exit(1);
    }
}

startServer();
