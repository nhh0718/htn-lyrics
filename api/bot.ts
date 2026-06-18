import type { IncomingMessage, ServerResponse } from "node:http";
import { webhookCallback } from "grammy";
import { createBot } from "../src/bot.js";

const token = process.env.BOT_TOKEN;
if (!token) throw new Error("Thiếu biến môi trường BOT_TOKEN");

const bot = createBot(token);

// Adapter "https": dùng kiểu (req, res) của Node — tương thích Vercel Node runtime.
const handleUpdate = webhookCallback(bot, "https", {
  secretToken: process.env.WEBHOOK_SECRET,
});

export default async function handler(
  req: IncomingMessage & { method?: string },
  res: ServerResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 200;
    res.end("Lyrics bot is running. Use POST for Telegram webhook.");
    return;
  }
  try {
    await handleUpdate(req, res);
  } catch (err) {
    console.error("Webhook error:", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end("error");
    }
  }
}
