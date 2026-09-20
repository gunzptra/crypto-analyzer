# Crypto Trading Intelligence V1.4.2

Patch V1.4.2 memperbaiki fallback Supabase yang dapat terjadi saat migrasi paper trade legacy gagal. Koneksi Supabase sekarang tetap dianggap persistent bila auth/query berhasil, migrasi legacy memakai ID baru agar tidak konflik dengan anonymous user lama, dan error client ditampilkan eksplisit di dashboard.

# Crypto Trading Intelligence V1.4

V1.4 melanjutkan V1.3 yang sudah stabil di local dan menambahkan **persistent storage + background jobs**. Tujuan versi ini adalah agar paper trade, checkpoint validation, dan market snapshot tetap tersimpan serta dapat diproses walaupun browser/laptop tidak sedang membuka dashboard.

> V1.4 tetap **paper-trading / decision-support only**. Tidak ada API key exchange, order placement, futures execution, atau auto-buy/sell.

## Apa yang baru di V1.4

- Supabase menjadi mode persistence utama bila environment variable tersedia.
- Migrasi otomatis dari paper trade localStorage lama ke Supabase ketika anonymous user pertama kali terhubung.
- Watchlist persistent per anonymous Supabase user.
- Protected background validator (`/api/cron/validate`).
- Protected 4H scanner snapshot (`/api/cron/snapshot`).
- `background_runs` untuk audit status job terakhir.
- GitHub Actions workflow siap pakai:
  - validator setiap jam;
  - snapshot scanner setiap 4 jam.
- Scanner snapshot menyimpan Opportunity, Quality, Risk, Setup Status, full item payload, **dan market regime saat snapshot dibuat**.
- Background status ditampilkan di dashboard.
- Export Paper Trade CSV.
- LocalStorage fallback tetap tersedia jika Supabase belum dikonfigurasi.

## Arsitektur

```text
                         Binance public market data
                                  │
                                  ▼
                    Scanner + Technical Analysis
                     1D / 4H closed candles
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
          Dashboard / Browser                Background jobs
          IDR display + paper trade          GitHub Actions
                 │                                 │
                 │                         ┌───────┴────────┐
                 │                         ▼                ▼
                 │                    Hourly validate   4H snapshot
                 │                         │                │
                 └───────────────► Supabase PostgreSQL ◄───┘
                                  │
                                  ▼
                     Historical validation dataset
```

Harga tampilan tetap IDR. Technical analysis tetap berasal dari Binance USDT closed candles agar indikator konsisten.

## Local-only mode masih didukung

Jika ini dibiarkan kosong:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

maka:

- scanner tetap berjalan;
- IDR conversion tetap berjalan;
- watchlist memakai localStorage;
- paper trade memakai localStorage;
- checkpoint validation berjalan saat app dibuka / manual refresh;
- background job ditampilkan sebagai `not configured`.

Jadi Supabase tidak diperlukan hanya untuk mencoba UI.

---

# 1. Menjalankan secara local

```bash
npm install
```

Copy environment:

Git Bash / macOS / Linux:

```bash
cp .env.example .env.local
```

Windows CMD:

```bat
copy .env.example .env.local
```

Minimal environment tanpa Supabase:

```env
BINANCE_REST_BASE=https://data-api.binance.vision
NEXT_PUBLIC_BINANCE_WS_BASE=wss://data-stream.binance.vision

COINGECKO_API_BASE=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

Run:

```bash
npm run dev
```

Buka:

```text
http://localhost:3000
```

Sebelum production deployment:

```bash
npm run build
```

---

# 2. Setup Supabase

V1.4 adalah titik di mana Supabase mulai disarankan karena data hasil validasi sudah bernilai untuk calibration.

## 2.1 Buat project

Buat project Supabase lalu buka **SQL Editor**.

Copy seluruh isi:

```text
supabase/schema.sql
```

kemudian Run.

Schema membuat:

```text
watchlist
scan_snapshots
paper_trades
background_runs
```

## 2.2 Aktifkan Anonymous Authentication

Buka:

```text
Authentication
→ Providers
→ Anonymous Sign-Ins
```

aktifkan Anonymous Sign-Ins.

Dashboard akan membuat anonymous user browser sehingga watchlist dan paper trade memiliki `user_id` tanpa membuat halaman login terlebih dahulu.

## 2.3 Ambil frontend keys

Masukkan ke `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=xxxxx
```

Gunakan **publishable / anon browser-safe key** sesuai dashboard Supabase milikmu.

## 2.4 Service Role — server only

Background validator membutuhkan akses server untuk membaca paper trades seluruh user dan menulis historical snapshots.

Tambahkan:

```env
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

**JANGAN** pernah menulis:

```env
NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=...
```

Service-role key hanya boleh berada di server environment. Jangan commit `.env.local` ke GitHub.

## 2.5 Cron secret

Buat secret random yang panjang, contoh menggunakan Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Masukkan hasilnya:

```env
CRON_SECRET=hasil_random_secret
```

Endpoint background memerlukan header:

```text
Authorization: Bearer <CRON_SECRET>
```

Tanpa secret yang benar endpoint akan menolak request.

Restart local server setelah environment berubah.

---

# 3. Apa yang terjadi saat Supabase pertama kali aktif?

V1.4 membaca paper trades lokal yang dibuat dari V1.2/V1.3.

Jika Supabase user belum mempunyai paper trade tetapi browser mempunyai data lama, dashboard mencoba memigrasikannya ke tabel `paper_trades`.

Setelah itu mode dashboard akan menunjukkan:

```text
Data mode: Supabase persistent
```

bukan:

```text
Local browser
```

Jangan menghapus localStorage sampai kamu sudah memastikan data muncul dari Supabase.

---

# 4. Background validator

Endpoint:

```text
GET /api/cron/validate
```

Job mencari paper trade:

```text
status = OPEN
opened_at <= now - 4 hours
```

maksimum 50 trade per run, lalu menjalankan evaluator yang sama dengan dashboard.

Evaluator memperbarui:

```text
4H
12H
24H
3D
7D
MFE
MAE
TP1 / TP2 / STOP / AMBIGUOUS
```

Hasil ditulis ke `paper_trades.evaluation`.

Setiap run juga dicatat di:

```text
background_runs
```

sehingga dashboard dapat menampilkan job terakhir.

---

# 5. Automatic 4H scanner snapshot

Endpoint:

```text
GET /api/cron/snapshot
```

Alurnya:

```text
/api/scanner
    ↓
Top liquid USDT universe
    ↓
Quality / Opportunity / Risk / Setup Status
    ↓
4H UTC scan slot
    ↓
Supabase scan_snapshots
```

Setiap row menyimpan:

```text
symbol
price
quality_score
opportunity_score
risk_score
setup_status
scan_slot
full scanner payload
market regime / entry environment dalam payload.market
```

Unique index `(symbol, timeframe, scan_slot)` mencegah duplicate snapshot bila job yang sama terpanggil dua kali di slot 4 jam yang sama.

Data ini nantinya menjadi dataset untuk market-regime calibration dan strategy backtest V1.5+.

---

# 6. Scheduling gratis dengan GitHub Actions

Folder:

```text
.github/workflows/
```

sudah mempunyai:

```text
hourly-validator.yml
4h-snapshot.yml
```

Jadwal validator:

```text
17 * * * *
```

sekitar sekali per jam.

Jadwal scanner snapshot:

```text
23 */4 * * *
```

sekitar setiap 4 jam.

Menit 17/23 sengaja dipilih supaya tidak tepat di menit `00`, dan scanner menggunakan closed candles.

Scheduled workflow tidak harus berjalan tepat pada detik yang sama setiap run; untuk sistem swing 1H/4H ini keterlambatan kecil tidak mengubah ruleset karena evaluator menggunakan timestamp candle.

## 6.1 GitHub repository secrets

Di repository GitHub:

```text
Settings
→ Secrets and variables
→ Actions
→ New repository secret
```

buat:

```text
APP_URL
CRON_SECRET
```

Contoh:

```text
APP_URL=https://crypto-trading-intelligence.vercel.app
```

`CRON_SECRET` harus sama persis dengan yang ada di Vercel.

Tidak perlu memasukkan `SUPABASE_SERVICE_ROLE_KEY` ke GitHub Actions. Service-role key tetap hanya berada di Vercel; GitHub hanya memanggil endpoint yang dilindungi `CRON_SECRET`.

---

# 7. Deployment Vercel

Environment variables di Vercel:

```env
BINANCE_REST_BASE=https://data-api.binance.vision
NEXT_PUBLIC_BINANCE_WS_BASE=wss://data-stream.binance.vision
COINGECKO_API_BASE=https://api.coingecko.com/api/v3
COINGECKO_API_KEY=

NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...
```

Setelah environment variables ditambahkan, lakukan **Redeploy**.

Kemudian buka dashboard. Bagian status harus berubah menjadi kurang lebih:

```text
Data mode: Supabase persistent
Background: server configured
```

Setelah workflow pernah berjalan akan muncul waktu validator/snapshot terakhir.

---

# 8. Test background job secara manual

Cara paling mudah adalah GitHub:

```text
Actions
→ CTI Hourly Paper Validator
→ Run workflow
```

kemudian:

```text
Actions
→ CTI 4H Scanner Snapshot
→ Run workflow
```

Refresh dashboard dan periksa status background.

Kamu juga dapat membuka Supabase Table Editor:

```text
background_runs
scan_snapshots
```

untuk memastikan row berhasil masuk.

---

# 9. Export CSV

Di halaman **Paper Trades** terdapat tombol:

```text
Export CSV
```

File berisi parameter setup dan checkpoint sehingga dapat dianalisa lebih lanjut di Excel/Python.

CSV adalah export dari paper trade user aktif di dashboard; historical market snapshots tetap tersimpan di Supabase.

---

# 10. Security model

Frontend browser hanya mempunyai:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

RLS memastikan:

- user hanya membaca/mengubah watchlist sendiri;
- user hanya membaca/mengubah paper trade sendiri.

Server background mempunyai:

```text
SUPABASE_SERVICE_ROLE_KEY
```

dan endpoint-nya dilindungi:

```text
CRON_SECRET
```

Service-role key tidak pernah dikirim ke browser.

---

# 11. Workflow V1.4 yang disarankan

```text
Scanner
  ↓
Qualified / Watch setup
  ↓
Create Paper Trade
  ↓
Supabase persistence
  ↓
Hourly background validator
  ↓
4H / 12H / 24H / 3D / 7D checkpoints
  ↓
Performance & Calibration
```

Secara paralel:

```text
4H market scanner
  ↓
scan_snapshots
  ↓
historical market dataset
```

Target awal tetap **mengumpulkan sampel**, bukan mengoptimalkan parameter terlalu cepat.

---

# 12. Setelah V1.4

Jangan ubah ruleset hanya karena beberapa trade pertama. Kumpulkan data terlebih dahulu.

Tahap berikut yang masuk akal setelah V1.4 stabil:

```text
V1.5
├─ Historical snapshot explorer
├─ Market-regime calibration
├─ Automatic score-vs-forward-return analysis
├─ Strategy versioning agar perubahan formula dapat dibandingkan fair
└─ Data-quality / missing-run monitor

V2
├─ Telegram alert
├─ Alert hanya untuk qualified setups
├─ Daily / evening summary
└─ optional AI explanation layer
```

V1.4 sengaja belum melakukan automatic real-money execution.
