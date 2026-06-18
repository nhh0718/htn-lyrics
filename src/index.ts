// Entry point production cho Render: long-polling (không bị giới hạn 10s như
// webhook) + một HTTP server nhỏ để bind $PORT (Render yêu cầu) và tự ping để
// service free không bị ngủ.
import "./load-env.js";
import { createServer } from "node:http";
import { createBot } from "./bot.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Thiếu BOT_TOKEN trong biến môi trường.");
  process.exit(1);
}

const bot = createBot(token);
bot.catch((err) => console.error("Bot error:", err));

const PORT = Number(process.env.PORT) || 3000;

// HTTP server tối thiểu: Render cần service bind vào $PORT, và endpoint này
// cũng dùng cho self-ping chống ngủ.
const server = createServer((_req, res) => {
  res.statusCode = 200;
  res.end("Lyrics bot is running.");
});
server.listen(PORT, () => {
  console.log(`HTTP server đang chạy ở cổng ${PORT}`);
});

// Tự ping mỗi 10 phút để Render free không cho service ngủ (idle 15 phút).
const selfUrl = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
if (selfUrl) {
  setInterval(() => {
    fetch(selfUrl).catch(() => {});
  }, 10 * 60 * 1000);
}

async function main() {
  // Xóa webhook cũ (Vercel/Render trước đó) để long-polling không bị 409 Conflict.
  await bot.api.deleteWebhook({ drop_pending_updates: true });
  console.log("Bot đang chạy ở chế độ long-polling.");
  await bot.start({
    onStart: (info) => console.log(`Đã đăng nhập: @${info.username}`),
  });
}

main().catch((err) => {
  console.error("Không khởi động được bot:", err);
  process.exit(1);
});
