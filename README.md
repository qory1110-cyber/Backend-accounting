# Accounting Backend (Fastify 5 + Drizzle + Zod)

Dibangun mengikuti `Backend-Boilerplate-Guide.pdf` (standar internal, 9 September
2026) — pnpm, TypeScript strict ESM, **flat route → repository tanpa Service
layer**, Zod untuk validasi + OpenAPI, Drizzle ORM + PostgreSQL.

Ini menggantikan dua project belajar sebelumnya (NestJS & Fastify-manual) —
sekarang berdasarkan standar resmi dari atasan, bukan latihan lagi.

## Pemetaan ke 6 subtugas 1.2 Backend

| Subtugas | Lokasi kode |
|---|---|
| Pilih & setup framework, struktur folder, konvensi | Seluruh `src/`, ikuti peta folder §3 boilerplate guide persis |
| Autentikasi | `plugins/AuthRoutes.ts` + `repositories/RefreshTokenRepository.ts` + `libs/jwt.ts`, `libs/password.ts` |
| Multi-tenant isolation | `plugins/AuthMiddleware.ts` (`requireBusinessScope`) + `repositories/BusinessRepository.ts` (`findMembership`, semua query filter `businessId`) |
| Modul Users + hak akses per bisnis | `plugins/UserRoutes.ts` (profil) + endpoint `/businesses/:id/members` di `BusinessRoutes.ts` + `requireRole` guard |
| Modul Businesses | `plugins/BusinessRoutes.ts` + `repositories/BusinessRepository.ts` |
| Kerangka OpenAPI | `index.ts` (registrasi `@fastify/swagger` dengan `jsonSchemaTransform` dari `fastify-type-provider-zod`) — otomatis baca skema Zod yang sama dipakai validasi |

## Menjalankan

Prasyarat: Node.js 20+, pnpm (`corepack enable` lalu `corepack prepare pnpm@latest --activate`), Docker (untuk Postgres) atau PostgreSQL native.

```bash
cp .env.example .env
# edit .env sesuai kredensial database kamu

pnpm install

# Opsi A - pakai Docker untuk Postgres:
pnpm run db:up

# Opsi B - PostgreSQL native yang sudah kamu install sebelumnya juga bisa
# dipakai, tinggal sesuaikan DATABASE_URL di .env, nama database boleh beda
# dari project NestJS/Fastify-belajar kamu (mis. accounting_db_v2).

pnpm run migrations:generate   # hasilkan SQL migration dari src/db/schema.ts
pnpm run migrations:run        # jalankan migration ke database
pnpm run seed                  # buat 1 user + bisnis contoh untuk dicoba

pnpm dev
```

Setelah jalan:
- Health check: `http://localhost:8014/health`
- Dokumentasi API (Swagger): `http://localhost:8014/documentation`

Login pakai hasil seed:
```json
{ "email": "admin@example.com", "password": "Password123!" }
```

## Menjalankan test

```bash
pnpm run migrations:run
pnpm run seed
pnpm test
```

## Keputusan yang SENGAJA berbeda dari dokumen boilerplate

Karena dokumen menyebut dirinya pola generik (bukan aturan absolut untuk
semua project), dua hal ini disederhanakan untuk fase saat ini:

1. **RabbitMQ tidak disertakan.** Tidak ada satupun dari 6 subtugas 1.2 yang
   butuh proses async/queue. Foldernya (`src/delivery/messaging/`) tetap
   dibuat kosong supaya strukturnya siap kalau nanti dibutuhkan.
2. **`requirePermissions` (izin granular) belum diimplementasikan.** Role kita
   cuma 3 level kasar (admin/accountant/viewer) sesuai instruksi tugas —
   `requireRole` saja sudah cukup. Bisa ditambah nanti kalau kebutuhannya
   berkembang ke izin yang lebih detail per fitur.
3. **Audit log (`audit_logs`) belum ditulis otomatis lewat hook generik.**
   Guide menyarankan `onResponse` hook global, tapi itu butuh tahu
   `entityType`/`entityId`/nilai lama-baru per route yang sifatnya spesifik
   per domain. Untuk sekarang, pencatatan audit akan ditambahkan langsung di
   repository saat modul yang benar-benar mengubah data finansial dibangun
   (Chart of Accounts, Journal Entries, dst. — Fase berikutnya), bukan di
   sini karena Businesses/Users belum representatif untuk pola diff
   old/new yang berguna.

## Yang TIDAK disentuh dari desain sebelumnya

- `src/db/schema.ts` — port 1:1 dari `LAPORAN_FASE_1_1_Desain_Database.docx`
  (termasuk Adendum 1.1 soft-delete). Kalau ada perubahan skema, edit laporan
  1.1 dulu, baru port ke sini — jangan sebaliknya.
- Aturan wajib `businessId` eksplisit di setiap query (§2.4
  `LAPORAN_FASE_1_2_Backend.docx`) — tetap berlaku persis, cuma sekarang
  ditegakkan lewat Drizzle alih-alih Prisma.
