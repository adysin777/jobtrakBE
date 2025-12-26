import express from 'express';
import { connectDatabase } from './config/database';
import { config } from './config/env';
import { clerkMiddleware } from '@clerk/express';

import dashboardRoutes from "./routes/dashboard.routes";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => res.send("ok"));
app.get("/health", (req, res) => res.send("ok"));

app.use(clerkMiddleware());

app.use("/api/dashboard", dashboardRoutes);

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
