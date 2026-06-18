# Lyrics Bot (Telegram + Genius)

Bot Telegram tìm lời bài hát trên [Genius.com](https://genius.com). Người dùng gõ
`/lyric <tên bài hát>`, bot trả về danh sách kết quả dưới dạng nút bấm (inline
callback buttons), chọn xong sẽ trả về lời bài hát đã format.

Stack: **TypeScript + [grammY](https://grammy.dev) + [cheerio](https://cheerio.js.org/)**,
deploy **serverless trên Vercel** (Node runtime, webhook).

## Cách hoạt động

```
/lyric shape of you
        │
        ▼
Genius API /search  ──►  danh sách kết quả  ──►  inline buttons (callback = song id)
        │
   user bấm chọn
        │
        ▼
Genius API /songs/:id  ──►  URL bài hát  ──►  scrape HTML (cheerio)  ──►  lyric đã format
        │
        ▼
gửi về Telegram (tự chia nhỏ nếu > 4096 ký tự)
```

> **Lưu ý:** Genius API **không** trả về full lyrics (lý do bản quyền). API chỉ
> dùng để tìm kiếm và lấy URL; phần lời bài hát được lấy bằng cách parse HTML
> trang bài hát. Đây là cách các thư viện như `lyricsgenius` vẫn làm. Hãy dùng
> đúng giới hạn và tôn trọng điều khoản của Genius.

## Cấu trúc thư mục

```
lyrics_bot/
├── api/bot.ts            # Vercel serverless function (webhook handler)
├── src/
│   ├── bot.ts            # Logic bot: command /lyric, callback buttons, format
│   ├── genius.ts         # Search + scrape lyrics từ Genius
│   └── dev.ts            # Chạy local bằng long-polling để test
├── scripts/set-webhook.ts# Đăng ký webhook với Telegram sau khi deploy
├── vercel.json           # Cấu hình function (maxDuration 30s)
├── .env.example          # Mẫu biến môi trường
└── package.json
```

## 1. Chuẩn bị token

**Telegram Bot Token**
1. Mở [@BotFather](https://t.me/BotFather) trên Telegram.
2. `/newbot` → đặt tên → nhận `BOT_TOKEN`.

**Genius Access Token**
1. Vào https://genius.com/api-clients → **New API Client**.
2. Điền thông tin bất kỳ (App Name, URL) → tạo.
3. Bấm **Generate Access Token** → copy *Client Access Token* → đó là
   `GENIUS_ACCESS_TOKEN`.

## 2. Cài đặt & chạy local (test)

```bash
npm install
cp .env.example .env   # rồi điền BOT_TOKEN và GENIUS_ACCESS_TOKEN
npm run dev            # chạy long-polling, không cần HTTPS
```

Vào Telegram chat với bot, gõ `/lyric let it be` để thử.

Kiểm tra type:

```bash
npm run build
```

## 3. Deploy serverless lên Vercel

1. Push code lên GitHub.
2. Vào [vercel.com](https://vercel.com) → **Add New Project** → import repo.
3. Trong **Settings → Environment Variables**, thêm:
   - `BOT_TOKEN`
   - `GENIUS_ACCESS_TOKEN`
   - `WEBHOOK_SECRET` (một chuỗi ngẫu nhiên do bạn tự đặt)
4. **Deploy**. Sau khi xong, lấy domain ví dụ `https://lyrics-bot.vercel.app`.

### Đăng ký webhook

Điền `PUBLIC_URL` và `WEBHOOK_SECRET` vào `.env` (giống giá trị đã đặt trên Vercel),
rồi chạy:

```bash
npm run set-webhook
```

Lệnh này gọi Telegram `setWebhook` trỏ tới `https://<domain>/api/bot`.
Nếu thành công Telegram trả `{"ok":true}`.

> Webhook endpoint kiểm tra header `X-Telegram-Bot-Api-Secret-Token` khớp với
> `WEBHOOK_SECRET` để chặn request giả mạo.

## Các nền tảng serverless khác

| Nền tảng            | Ghi chú                                                                 |
|---------------------|-------------------------------------------------------------------------|
| **Vercel** (dùng)   | Node runtime đầy đủ, cheerio chạy tốt, `maxDuration` tới 60s.            |
| Cloudflare Workers  | Free tier mạnh nhưng không có DOM Node → phải parse HTML bằng `HTMLRewriter`/regex. |
| AWS Lambda          | Linh hoạt, cần cấu hình API Gateway cho webhook.                        |
| Deno Deploy         | Hợp với grammY (adapter `std/http`), Web API sẵn có.                    |

## Lệnh bot

- `/start` – giới thiệu.
- `/help` – hướng dẫn.
- `/lyric <tên bài hát>` – tìm và lấy lời bài hát.
