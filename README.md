# JobTrak Backend

Backend API for job application tracking system.

## Structure

This is a modular monolith organized by feature and concern:

- `config/` - Configuration files (database, environment)
- `models/` - MongoDB schemas/models
- `routes/` - Express route definitions
- `controllers/` - Request handlers
- `services/` - Business logic
- `middleware/` - Express middleware
- `types/` - TypeScript type definitions
- `workers/` - Background workers (email ingestion, processing)
- `notifications/` - Notification system
- `queue/` - Message queue configuration
- `payments/` - Payment integration
- `utils/` - Utility functions

## Getting Started

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env` and configure
3. Run in development: `npm run dev`
4. Build: `npm run build`
5. Start production: `npm start`

