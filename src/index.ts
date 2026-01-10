import express from 'express';
import { connectDatabase } from './config/database';
import { config } from './config/env';
import { clerkMiddleware } from '@clerk/express';

import dashboardRoutes from "./routes/dashboard.routes";
import calendarRoutes from "./routes/calendar.routes";

import mongoose from "mongoose";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.send("okkk"));

app.use(clerkMiddleware());

app.use("/api/dashboard", dashboardRoutes);
app.use("/api/calendar", calendarRoutes)

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
