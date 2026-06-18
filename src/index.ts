// Entry point production cho Render (Web Service): HTTP server + webhook.
// Render cấp cổng qua $PORT và URL công khai qua $RENDER_EXTERNAL_URL.
import "./load-env.js";
import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { createBot } from "./bot.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Thiếu BOT_TOKEN trong biến môi trường.");
  process.exit(1);
}

const bot = createBot(token);
bot.catch((err) => console.error("Bot error:", err));

// Telegram secret_token chỉ cho phép A-Z a-z 0-9 _ - (1..256 ký tự).
// Render có thể sinh WEBHOOK_SECRET dạng base64 (chứa = / +) -> phải làm sạch.
const rawSecret = process.env.WEBHOOK_SECRET || "telegram";
const secret = rawSecret.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 256) || "telegram";
const webhookPath = `/webhook/${secret}`;
const handleUpdate = webhookCallback(bot, "http", { secretToken: secret });

const PORT = Number(process.env.PORT) || 3000;

const server = createServer(async (req, res) => {
  if (req.method === "POST" && req.url === webhookPath) {
    try {
      await handleUpdate(req, res);
    } catch (err) {
      console.error("Webhook error:", err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("error");
      }
    }
    return;
  }
  // Health check / trang mặc định (Render ping vào đây).
  res.statusCode = 200;
  res.end("Lyrics bot is running.");
});

server.listen(PORT, async () => {
  console.log(`HTTP server đang chạy ở cổng ${PORT}`);

  // Tự đăng ký webhook khi khởi động nếu biết URL công khai.
  const base = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (!base) {
    console.warn(
      "Chưa có PUBLIC_URL / RENDER_EXTERNAL_URL -> chưa tự set webhook."
    );
    return;
  }
  const url = `${base.replace(/\/$/, "")}${webhookPath}`;
  try {
    await bot.api.setWebhook(url, {
      drop_pending_updates: true,
      secret_token: secret,
    });
    console.log("Đã set webhook:", url);
  } catch (err) {
    // Không sập server nếu set webhook lỗi; vẫn giữ HTTP server sống để debug.
    console.error("setWebhook lỗi:", err);
  }
});
