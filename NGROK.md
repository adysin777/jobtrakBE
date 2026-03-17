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

## Where to see Gmail watch on Google’s side

Google does **not** provide a single “watchlist” UI that lists which Gmail addresses are being watched.

- **GCP Console → Pub/Sub → Topics:** You see your topic (e.g. the one in `GMAIL_PUBSUB_TOPIC`). That topic receives notifications for **any** Gmail user that has called `users.watch()` with this topic. You don’t see a list of those users in the UI.
- **GCP Console → Pub/Sub → Subscriptions:** Your push subscription shows delivery stats and the endpoint URL. When a notification is pushed, the payload (in the push request body) contains `emailAddress` and `historyId` — so the only way to “see” which mailbox triggered it is from your backend logs or by inspecting the subscription’s message flow.
- **Gmail API:** There is no “list watches” API. Each Gmail account has at most one active watch; it’s created when your app calls `gmail.users.watch()`. To know which accounts are watched, use your app’s stored state (e.g. backend log `[GmailSync] All Gmail inboxes (watchlist)` or your database `User.connectedInboxes`).

So the canonical “watchlist” for your app is in your backend (logs + DB), not in a GCP dashboard.

## Optional: set BACKEND_URL when using ngrok

If your app builds callback or webhook URLs from `BACKEND_URL`, set it to the current ngrok URL when running with a tunnel (e.g. in `.env` or when starting the server):

```bash
BACKEND_URL=https://abc123.ngrok-free.app
```

Then restart the backend so it uses the public URL.
