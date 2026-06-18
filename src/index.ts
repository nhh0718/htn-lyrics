// Entry point production cho Render: long-polling (không bị giới hạn 10s như
// webhook) + một HTTP server nhỏ để bind $PORT (Render yêu cầu) và tự ping để
// service free không bị ngủ.
import "./load-env.js";
import { createServer } from "node:http";
import { createBot, escapeHtml } from "./bot.js";
import { exchangeSpotifyCode } from "./spotify.js";
import { setSpotifyUser } from "./spotify-store.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Thiếu BOT_TOKEN trong biến môi trường.");
  process.exit(1);
}

const bot = createBot(token);
bot.catch((err) => console.error("Bot error:", err));

const PORT = Number(process.env.PORT) || 3000;

// HTTP server: health-check + Spotify OAuth callback.
const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (url.pathname === "/spotify/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<h1>Lỗi Spotify: ${escapeHtml(error)}</h1>`);
      return;
    }

    if (!code || !state) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<h1>Thiếu code hoặc state.</h1>");
      return;
    }

    const [chatIdStr, userIdStr] = state.split(":");
    const chatId = Number(chatIdStr);
    const userId = Number(userIdStr);

    if (!chatId || !userId) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end("<h1>State không hợp lệ.</h1>");
      return;
    }

    try {
      const tokens = await exchangeSpotifyCode(code);

      // Lấy tên hiển thị từ Spotify
      let displayName: string | undefined;
      try {
        const meRes = await fetch("https://api.spotify.com/v1/me", {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as any;
          displayName = me.display_name;
        }
      } catch {
        /* bỏ qua lỗi lấy profile */
      }

      setSpotifyUser(chatId, {
        userId,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        firstName: displayName,
      });

      await bot.api.sendMessage(
        userId,
        `✅ Kết nối Spotify thành công!${
          displayName ? `\nTài khoản: <b>${escapeHtml(displayName)}</b>` : ""
        }\n\nBạn bè giờ có thể dùng <code>/nowplaying</code> để xem bạn đang phát gì 🎧`,
        { parse_mode: "HTML" }
      );

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<!DOCTYPE html>
<html lang="vi">
<head><meta charset="utf-8"><title>Spotify Connected</title></head>
<body style="font-family:sans-serif;text-align:center;padding:50px;">
  <h1>✅ Kết nối thành công!</h1>
  <p>Bạn có thể đóng tab này và quay lại Telegram.</p>
</body>
</html>`
      );
    } catch (err) {
      console.error("[Spotify callback] lỗi:", err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        `<h1>Lỗi</h1><p>${escapeHtml(String((err as Error).message))}</p>`
      );
    }
    return;
  }

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
