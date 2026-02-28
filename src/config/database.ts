import mongoose from 'mongoose';
import { config } from './env';

export const connectDatabase = async (): Promise<void> => {
    try {
        mongoose.connection.on('connected', () => {
            console.log("MongoDB connection successful!");
        });
        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });
        mongoose.connection.on('disconnected', () => {
            console.log("MongoDB disconnected! Reconnecting...");
            mongoose.connect(config.mongodbUri).catch((err) => console.error("Reconnect failed:", err));
        });

        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log("App terminated, MongoDB connection closed.");
            process.exit(0);
        });

        await mongoose.connect(config.mongodbUri);
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
};