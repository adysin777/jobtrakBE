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

## Google OAuth and ngrok

- In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → your OAuth **Web client**, add every redirect URI you use, for example:
  - `http://localhost:8080/api/inboxes/callback/gmail`
  - `https://<your-ngrok-host>.ngrok-free.app/api/inboxes/callback/gmail`
  - Optional dedicated calendar callback: `https://<your-ngrok-host>.ngrok-free.app/api/calendar/callback/google`
- Set the same values in `.env` as `GOOGLE_REDIRECT_URI` and optionally `GOOGLE_CALENDAR_REDIRECT_URI` (see [.env.example](.env.example)).
- Set `FRONTEND_URL` to where the React app runs (often `http://localhost:5173`); OAuth success/error redirects use it.
- If the frontend is opened on an ngrok URL, add that origin to `CORS_ALLOWED_ORIGINS` (comma-separated) so the browser is not blocked by CORS.

