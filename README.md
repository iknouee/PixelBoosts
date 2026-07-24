# Pixel Boosts Bot

A Discord.js v14 storefront bot for Pixel Boosts. It sends branded embeds to your server channels, manages stock and prices, creates private order tickets, records completed orders, and provides owner/admin utilities.

## Render setup

- Build command: `npm install`
- Start command: `npm start`
- Add all values from `.env.example` as Render environment variables.
- Enable these Discord Developer Portal intents: **Server Members Intent**.
- Invite the bot with `bot` and `applications.commands` scopes.
- Recommended bot permissions: Manage Channels, Manage Roles, View Channels, Send Messages, Embed Links, Attach Files, Read Message History.

## First use

1. Fill in channel IDs and role IDs.
2. Start the bot.
3. Run `/setup` as the server owner or an administrator.
4. Use `/stock set`, `/price set`, `/offer`, and `/announce` to keep the store updated.

## Important

Only sell boosts obtained through legitimate Discord purchases. Never request customer account passwords, user tokens, QR logins, or session cookies. This bot does not automate user accounts or boost delivery.

PayPal Friends & Family is intended for personal transfers, not customer purchases. The supplied payment panel uses PayPal Goods & Services wording to protect both sides.
