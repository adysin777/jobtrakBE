import dotenv from 'dotenv'

dotenv.config();

const requiredEnvVars = ['MONGODB_URI', 'PORT', 'NODE_ENV'];

requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
        throw new Error(`Missing required environment variable: ${varName}`);
    }
});

export const config = {
    mongodbUri: process.env.MONGODB_URI!,
    port: parseInt(process.env.PORT!, 10),
    nodeEnv: process.env.NODE_ENV!,
    ingestSecret: process.env.INGEST_SECRET || "",
};
