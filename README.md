# F1 Race Notification Service

Sends **Discord** and **email** reminders for F1 qualifying and race sessions: **day before**, **day of**, and **1 hour before** each session start, in your local time (default CST/CDT).

Uses the free [f1api.dev](https://f1api.dev) API for the schedule. No API key required.

## What you get

- **Discord**: Rich embeds in a channel (via webhook)
- **Email**: HTML emails (e.g. to a family member)

For each **Qualifying**, **Race**, **Sprint Qualifying**, and **Sprint Race**:

| When            | Example message                                      |
|-----------------|------------------------------------------------------|
| Day before      | "Chinese GP Qualifying is tomorrow at 1:00 AM CST"   |
| Day of          | "Chinese GP Race is today at 1:00 AM CST"            |
| 1 hour before   | "Chinese GP Qualifying starts in 1 hour!"            |

Reminder times use **9:00 AM** local time for “day before” and “day of”; “1 hour before” is exactly 60 minutes before the session start.

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd F1_Race_Tracker
npm install
```

### 2. Environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

| Variable              | Required | Description |
|-----------------------|----------|-------------|
| `DISCORD_WEBHOOK_URL` | For Discord | Discord webhook URL (Server → Integrations → Webhooks → New Webhook) |
| `DISCORD_BOT_TOKEN`   | For Discord watch-time replies | Discord bot token (enables listening for your replies and sending “1 hour before” reminders) |
| `SMTP_HOST`           | For email | SMTP server (e.g. `smtp.gmail.com`) |
| `SMTP_PORT`           | For email | Usually `587` (TLS) or `465` (SSL) |
| `SMTP_USER`           | For email | SMTP username (often your email) |
| `SMTP_PASS`           | For email | SMTP password (Gmail: use an [App Password](https://myaccount.google.com/apppasswords)) |
| `EMAIL_TO`            | For email | Recipient address (e.g. mom’s email) |
| `EMAIL_FROM`          | Optional  | Sender address (defaults to `SMTP_USER`) |
| `SMTP_CONNECTION_TIMEOUT_MS` | Optional | SMTP connection timeout (default `20000`) |
| `SMTP_SOCKET_TIMEOUT_MS`     | Optional | SMTP socket timeout (default `20000`) |
| `SMTP_RETRY_COUNT`           | Optional | SMTP transient retry count (default `3`) |
| `SMTP_RETRY_BASE_DELAY_MS`   | Optional | Retry base backoff delay (default `500`) |
| `TIMEZONE`            | Optional  | IANA timezone (default: `America/Chicago`) |
| `F1_SEASON`           | Optional  | Season year (default: current year) |
| `DATA_DIR`            | Optional  | Directory for `sent.json` (default: `./data`) |
| `WATCH_PRUNE_DAYS`    | Optional | How long to keep stored watch-time replies (default `14`) |

You can enable only Discord, only email, or both.

### 3. Run locally

```bash
npm run build
npm start
```

If you use a local `.env` file, run with Node's env-file flag:

```bash
node --env-file=.env dist/index.js
```

### 4. Trigger test notifications on demand

To send one immediate test notification to each configured channel (Discord webhook + email) at startup:

```bash
npm run test:notify
```

This uses `SEND_TEST_NOTIFICATION_ON_START=1` and does not mark test keys in `sent.json`, so it is safe for repeated smoke tests.

### 5. Bot connectivity quick-check

If replies appear ignored, send this in the same Discord channel:

```text
!ping
```

The bot should reply `pong`.

Optional debug logs:

- Set `DEBUG_DISCORD_BOT=1` to log each `messageCreate` event the bot sees.

The process runs indefinitely and checks every **15 minutes** whether any reminder is due; when it is, it sends Discord and/or email and records it so it won’t send again.

## Deploy to Railway

1. **New project**  
   In [Railway](https://railway.app), create a new project and connect your repo (or use “Deploy from GitHub”).

2. **Build**  
   Railway will detect the Dockerfile and build the image. No extra build settings needed.

3. **Variables**  
   In the service → Variables, add all required env vars from `.env.example` (e.g. `DISCORD_WEBHOOK_URL`, `SMTP_*`, `EMAIL_TO`, etc.).

4. **Persist sent reminders**  
   So restarts don’t resend the same reminders:
   - In the service, add a **Volume**.
   - Mount it at path: `/app/data`.
   - The app uses `DATA_DIR=/app/data` in the Dockerfile, so `sent.json` will live on the volume.

5. **Deploy**  
   Deploy the service. It runs as a long‑running process (no separate cron job); the app uses `node-cron` to run the check every 15 minutes.

## Project structure

```
src/
  index.ts       # Entry point, cron every 15 min
  api.ts         # F1 API client (fetch + cache schedule)
  scheduler.ts   # Notification windows + dedup (sent.json)
  formatter.ts   # Discord embed + email HTML + plain text
  notifiers/
    discord.ts   # Discord webhook
    email.ts     # Nodemailer SMTP
  types.ts       # TypeScript types
```

## License

MIT.
