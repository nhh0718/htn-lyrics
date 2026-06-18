// Chạy bot bằng long-polling để test trên máy local (không cần webhook/HTTPS).
// Dùng: npm run dev
import "./load-env.js";
import { createBot } from "./bot.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Thiếu BOT_TOKEN. Tạo file .env từ .env.example.");
  process.exit(1);
}

const bot = createBot(token);

bot.catch((err) => {
  console.error("Bot error:", err);
});

console.log("Bot đang chạy ở chế độ long-polling. Nhấn Ctrl+C để dừng.");
bot.start({
  onStart: (info) => console.log(`Đã đăng nhập: @${info.username}`),
});
