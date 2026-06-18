// Nạp biến môi trường từ file .env khi chạy local.
// Trên Vercel, env vars được cung cấp sẵn nên file .env không tồn tại -> bỏ qua.
import { existsSync } from "node:fs";

const ENV_PATH = ".env";

if (existsSync(ENV_PATH) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(ENV_PATH);
}
