# Usage

Contoh lengkap pemakaian harian. Semua perintah bisa dijalankan langsung dari TypeScript
(`node src/cli.ts …`) tanpa build, atau dari hasil build (`node dist/src/cli.js …`).

## 1. Membuat novel dari ide kasar

```bash
node src/cli.ts new \
  --idea "seorang juru tulis pelabuhan yang bisa membaca hutang di telapak tangan" \
  --genre mystery --chapters 120 --words 2500 --lang id --author "Nadia"
```

Yang terjadi:
1. Premise (judul, logline, sinopsis, tema, tropes/subversions, hook promise).
2. Bible: aturan kanon, lokasi, faksi, 5+ karakter (motivasi, voice, rahasia).
3. Outline: arcs + 120 chapter (POV, lokasi, pemeran, beat, ringkasan, target kata).

## 2. Menulis beberapa chapter

```bash
node src/cli.ts write 5            # 5 chapter berikutnya
node src/cli.ts write --all        # sampai habis
node src/cli.ts write --provider anthropic --no-review
```

Tiap chapter: tulis → critic + self-review → (jika perlu) tulis-ulang → lesson →
simpan dengan status `final|reviewed|draft`.

## 3. Jadwal produksi (30 chapter hari ini, 3–5/hari setelahnya)

```bash
# daemon: tulis hari ini lalu lanjut setiap jam 08:00
node src/cli.ts schedule run --burst 30 --pace 3-5 --hour 8 --max-days 7

# mode cron: sekali jalan per hari
node src/cli.ts schedule cron
0 8 * * * cd "/path/to/project" && /usr/local/bin/node "/path/to/cli.js" schedule tick >> .schedule.log 2>&1
```

Selesai? `run` otomatis membuat `exports/` (md, txt, bundle.json, EPUB) dan
`publish/` (Royal Road, Wattpad, HTML). Matikan perilaku ini dengan `--no-export`.

Pantau:

```bash
node src/cli.ts status
# chapters: 33/120 [███░░░░░░░] 28% · words: 82.500
# pending: 87 · today's plan: 4 chapter(s) [daily]
# lessons: 6 active / 9 total
```

## 4. Belajar mandiri

```bash
node src/cli.ts check            # periksa semua chapter yang sudah ditulis
node src/cli.ts check 12         # satu chapter
node src/cli.ts learn add "chapter pembuka tidak boleh membuka dengan dialog"
node src/cli.ts learn list
node src/cli.ts learn dismiss les_paci_ab12cd
```

Lesson otomatis berasal dari temuan critic & self-review; lesson manual berasal dari
Anda. Semuanya disunting jadi "MISTAKES TO AVOID" pada prompt berikutnya.

## 5. Ekspor & publikasi

```bash
node src/cli.ts export md,txt,epub      # atau: export (semua)
node src/cli.ts publish royalroad,web  # atau: publish (semua)
```

Isi paket:
- `exports/markdown/manuscript.md` + per-chapter, `exports/txt/<nama>.txt`,
  `exports/bundle.json` (project + bible + outline + chapter, siap untuk layanan),
  `exports/<nama>.epub` (EPUB 3 dengan nav + toc).
- `publish/royalroad/000-frontmatter.md` + chapter bernomor, `publish/wattpad/`,
  `publish/web/index.html`.

## 6. Novel buatan agen sendiri

```bash
node src/cli.ts idea --surprise --count 5      # brainstorm tanpa ide dari Anda
node src/cli.ts new --surprise --chapters 200  # satu judul dipilih otomatis
```

## 7. Variabel lingkungan

| Variabel | Fungsi |
|---|---|
| `NOVEL_LLM_PROVIDER` | `mock` \| `anthropic` \| `openai-compatible` |
| `NOVEL_LLM_API_KEY` | API key provider |
| `NOVEL_LLM_MODEL` | nama model |
| `NOVEL_LLM_BASE_URL` | base URL untuk OpenAI-compatible (Ollama, vLLM, …) |
| `NOVEL_AUTHOR` | nama penulis di ekspor |

## 8. Tips

- Edit `style.json` (aturan + frasa terlarang) dan bible JSON langsung — sistem
  menghormatinya; `novel start` hanya melengkapi yang kosong.
- Untuk novel panjang, jalankan `novel status` sebelum menulis; jika daftar pending
  kosong, selesaikan outline dengan menambah chapter di `outline/outline.json`.
- Setelah mengubah bible (mis. usia karakter), jalankan `novel check --learn` untuk
  menandai chapter lama yang kini bertentangan.
