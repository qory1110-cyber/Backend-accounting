import 'dotenv/config';

// Aturan dari Backend-Boilerplate-Guide.pdf §8.1: tidak ada file lain yang
// boleh membaca process.env selain modul ini. Modul ini yang mengetik dan
// memberi default.
const env = {
  PORT: Number(process.env.PORT) || 8014,
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL:
    process.env.LOG_LEVEL || (process.env.NODE_ENV === 'development' ? 'debug' : 'info'),
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL || 'http://localhost:8014',

  DATABASE_URL: process.env.DATABASE_URL as string,
  DB_POOL_MAX: Number(process.env.DB_POOL_MAX) || 20,
  DB_POOL_IDLE_TIMEOUT_MS: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS) || 30000,
  DB_POOL_CONNECTION_TIMEOUT_MS: Number(process.env.DB_POOL_CONNECTION_TIMEOUT_MS) || 5000,

  JWT_SECRET: process.env.JWT_SECRET as string,
  JWT_SECRET_OLD: process.env.JWT_SECRET_OLD, // rotasi tanpa downtime
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '15m',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET as string,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d',

  CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
  ENABLE_SWAGGER: process.env.ENABLE_SWAGGER !== 'false',

  RATE_LIMIT_MAX: Number(process.env.RATE_LIMIT_MAX) || 500,
  RATE_LIMIT_TIME_WINDOW_MS: Number(process.env.RATE_LIMIT_TIME_WINDOW_MS) || 60000,
  RATE_LIMIT_ALLOW_LIST: (process.env.RATE_LIMIT_ALLOW_LIST || '127.0.0.1').split(','),

  BCRYPT_SALT_ROUNDS: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,
} as const;

// Fail-fast: variabel yang benar-benar wajib dicek sekali saat boot,
// supaya error jelas di awal, bukan error samar di tengah request pertama.
const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'] as const;
for (const key of required) {
  if (!env[key]) {
    throw new Error(`Env var ${key} wajib diisi (cek file .env)`);
  }
}

export default env;
