# ngrok setup (for GCP Pub/Sub and other webhooks)

Use ngrok to expose your local backend so GCP Pub/Sub (or other services) can send requests to a public HTTPS URL.

## 1. Install ngrok

**macOS (Homebrew):**
```bash
brew install ngrok
```

Or download from [ngrok.com/download](https://ngrok.com/download).

## 2. Add your auth token (one-time)

Sign up at [ngrok.com](https://ngrok.com), then:

```bash
ngrok config add-authtoken YOUR_AUTH_TOKEN
```

## 3. Start your backend

In one terminal, run the backend as usual:

```bash
cd jobtrak-BE
npm run dev
```

(Leave it running on the port in your `.env`, e.g. 3000.)

## 4. Start the tunnel

In another terminal:

```bash
cd jobtrak-BE
npm run tunnel
```

Or run ngrok directly with your port:

```bash
ngrok http 3000
```

You’ll get a public URL like `https://abc123.ngrok-free.app`. Use that as the push endpoint in GCP Pub/Sub.

## 5. Use the URL with GCP Pub/Sub

- In GCP Console: Pub/Sub → Subscriptions → create/edit → **Push**.
- **Endpoint URL:** `https://YOUR-NGROK-URL.ngrok-free.app/api/your-pubsub-handler-path`
- Your handler must:
  - Accept POST requests from Pub/Sub.
  - Return HTTP 200 quickly (e.g. ack and process in the background).
  - Validate the request (e.g. check token or signature) if you use push auth.

**Note:** The free ngrok URL changes every time you restart ngrok. For a stable URL, use a paid ngrok plan or deploy to a real host.

## Optional: set BACKEND_URL when using ngrok

If your app builds callback or webhook URLs from `BACKEND_URL`, set it to the current ngrok URL when running with a tunnel (e.g. in `.env` or when starting the server):

```bash
BACKEND_URL=https://abc123.ngrok-free.app
```

Then restart the backend so it uses the public URL.
