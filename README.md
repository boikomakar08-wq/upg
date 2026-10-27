# BELIVEIN Mini App — Railway build

Telegram Mini App + Express 5 / PostgreSQL backend. Includes Telegram Stars top-ups, case catalog, item/case management from the Mini App admin area, case opening with server-side real odds, inventory selling, withdrawal requests with Telegram admin approval/cancellation buttons, profile withdrawal statuses, Stars-to-Iskry conversion (1 Star = 1 Искра), animated case roulette with server-authoritative real odds, sound effects, and persistent light/dark theme selection.

## Deploy to Railway

1. Upload the contents of this folder to your GitHub repository (or deploy the folder through your normal Railway workflow).
2. Add a Railway PostgreSQL service to the same project.
3. In the bot web service Variables, set:
   - `BOT_TOKEN` — token from BotFather
   - `ADMIN_IDS` — comma-separated Telegram numeric user IDs allowed to use admin features
   - `DATABASE_URL` — use Railway's variable reference to the PostgreSQL service's `DATABASE_URL`
   - `WEBAPP_URL` — public HTTPS URL of this service / Mini App
   - `CHANNEL_USERNAME` — optional channel username used for subscription checking
4. Railway runs `npm start`; dependencies install from `package.json`.
5. The bot must be opened through Telegram so the Mini App receives valid `initData`.

## Admin panel

Open the Mini App as a Telegram user whose numeric ID is listed in `ADMIN_IDS`, then go to Profile → Admin panel.

- Create/edit items: image, name, description, value, rarity.
- Create/edit cases: image, name, description, price.
- Add items to a case and set both visual and real odds. The real odds must total exactly 100% for the case to open. Public case contents show only visual odds; real odds are kept server-side and shown only to admins.
- Uploaded images are resized in the browser and stored as data URLs in PostgreSQL, so they survive Railway redeploys without a local disk volume. Keep images reasonably small.

## Notes

- Existing PostgreSQL tables are migrated with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` on startup.
- User avatars use `photo_url` from the validated Telegram Mini App user object when Telegram provides it. Telegram may omit profile photos for some users; in that case the UI uses the fallback avatar.
- Use Node.js 20+ and Express 5 (required for the `/{*splat}` route syntax).
