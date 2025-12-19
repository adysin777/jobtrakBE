import mongoose from 'mongoose';
import { config } from './env';

export const connectDatabase = async (): Promise<void> => {
    try {
        mongoose.connection.on('connected', () => {
            console.log("MongoDB connection successful!");
        })
        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        })
        mongoose.connection.on('disconnected', () => {
            console.log("MongoDB disconnected!");
        })

        // Process termination
        process.on('SIGINT', async () => {
            await mongoose.connection.close();
            console.log("App terminated, MongoDB connection closed.");
        })

        // Connect to MongoDB
        await mongoose.connect(config.mongodbUri);
    } catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        process.exit(1);
    }
}