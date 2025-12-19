import express from 'express';
import { connectDatabase } from './config/database';
import { config } from './config/env';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
