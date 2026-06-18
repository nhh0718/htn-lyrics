// Đăng ký webhook cho bot với Telegram.
// Dùng sau khi đã deploy lên Vercel: npm run set-webhook
import "../src/load-env.js";

const token = process.env.BOT_TOKEN;
const publicUrl = process.env.PUBLIC_URL;
const secret = process.env.WEBHOOK_SECRET;

if (!token || !publicUrl) {
  console.error("Cần BOT_TOKEN và PUBLIC_URL trong .env");
  process.exit(1);
}

const webhookUrl = `${publicUrl.replace(/\/$/, "")}/api/bot`;

const params = new URLSearchParams({
  url: webhookUrl,
  drop_pending_updates: "true",
});
if (secret) params.set("secret_token", secret);

const res = await fetch(
  `https://api.telegram.org/bot${token}/setWebhook?${params.toString()}`
);
const data = await res.json();
console.log("setWebhook ->", JSON.stringify(data, null, 2));
console.log("Webhook URL:", webhookUrl);
