# Agent-writer

Agen penulis novel/webnovel siap-produksi. Anda cukup memberikan **ide kasar**; agen
melakukan sisanya: merakit premise, membangun worldbuilding bible sebagai *sumber
kebenaran* (canon), memecah outline per chapter, menulis chapter secara terjadwal,
memeriksa kontinuitas + gaya setiap chapter, **belajar dari kesalahannya sendiri**,
lalu mengekspor manuskrip (md/txt/json/EPUB) serta paket publikasi (Royal Road /
Wattpad / web).

Dibuat dengan TypeScript + Node, **tanpa dependency runtime** (hanya builtin `node:`),
jadi `npm install` hanya butuh devDependency (typescript) untuk build.

## Fitur

| Kebutuhan | Implementasi |
|---|---|
| Ide kasar → semuanya dikerjakan agen | `novel new --idea "..."` → premise → bible → outline |
| Worldbuilding akurat, tidak bertentangan | Bible kanon + *continuity critic* (usia, nama, status, lokasi, aturan) di setiap chapter |
| Terjadwal (30 chapter hari ini, 3–5/hari setelahnya) | `novel schedule run --burst 30 --pace 3-5` (daemon) atau `schedule tick` via cron |
| Belajar dari kesalahan sendiri | Lesson journal (`bible/lessons.json`) yang otomatis disuntikkan ke prompt chapter berikutnya |
| Novel buatan agen sendiri | `novel new --surprise`, `novel idea --surprise` |
| Siap dibagikan ke layanan | Export EPUB/MD/TXT/JSON + paket Royal Road/Wattpad/HTML |
| Aman dipakai lama | Semua tulisan atomic (tmp+rename); daemon bisa di-kill kapan pun dan dilanjutkan |

## Instalasi & quickstart

```bash
npm install          # hanya devDependency (typescript)

# 0. Mode offline (tanpa API key, kualitas "outline-grade") — untuk mencoba pipeline
node src/cli.ts new --idea "seorang saksi menjual ingatannya sendiri kepada juru tulis pelabuhan" \
  --chapters 30 --words 2500 --lang id
node src/cli.ts status
node src/cli.ts write 5
node src/cli.ts export          # md + txt + json + epub
node src/cli.ts publish         # paket royalroad/wattpad/web
```

### Produksi nyata (pakai LLM)

```bash
export NOVEL_LLM_PROVIDER=anthropic        # atau openai-compatible
export NOVEL_LLM_API_KEY=sk-ant-...          # atau key provider lain
export NOVEL_LLM_MODEL=claude-sonnet-4-5   # opsional
# openai-compatible juga mendukung Ollama/vLLM/LM Studio:
#   NOVEL_LLM_PROVIDER=openai-compatible NOVEL_LLM_BASE_URL=http://localhost:11434/v1

node src/cli.ts new --idea "..." --provider anthropic
node src/cli.ts schedule run --burst 30 --pace 3-5 --hour 8
```

Saat fokus ke kualitas: `novel write --no-review` untuk lewati self-review LLM (lebih murah),
atau `--provider mock` untuk offline.

## Alur kerja penulis

```text
ide kasar ──► premise ──► bible (canon) ──► outline/arc/chapter
                                             │
              ┌──────────────────────────────┼───────────────────────────────┐
              ▼                              ▼                               ▼
        write chapter ──► continuity critic ──► (error?) ──► fix loop ──► self-review LLM
              │                                                                    │
              └──► lesson journal ──► disuntikkan ke prompt chapter berikutnya ◄─────┘
```

Contoh sesi sehari:

```bash
novel new --idea "petualang kelas rendah menemukan sistem yang menghitung setiap nyawa" --chapters 120
novel schedule run --burst 30 --pace 3-5 --hour 8    # 30 chapter hari ini, 3–5/hari sampai selesai
# ... esok hari daemon otomatis lanjut; begitu selesai, export + paket publikasi dibuat otomatis
```

Atau pakai cron kalau tidak ingin daemon jalan terus:

```bash
novel schedule cron     # tampilkan baris crontab untuk `schedule tick` sekali sehari
```

## Belajar dari kesalahan

Setiap chapter lewat dua lapis pemeriksaan: **critic deterministik** (nama tak terdaftar,
usia ≠ bible, karakter mati muncul, frasa/AI-tell terlarang, dialogue ratio, hook lemah,
word count, meta-language) dan **self-review LLM**. Temuan non-info disimpan sebagai
*lesson* dengan kategori + jumlah kemunculan; lesson dengan severity error dan hits
terbanyak disuntikkan ke setiap prompt chapter berikutnya. Anda juga bisa mengajarinya:

```bash
novel learn add "jangan pakai kata 'sang' di dialog"
novel learn list
novel learn dismiss les_styl_108v83m
```

## Struktur project yang dihasilkan

```text
novels/<nama>/
  novel.json            # konfigurasi (judul, genre, target chapter, LLM, jadwal)
  style.json            # kontrak gaya + daftar frasa terlarang (bisa diedit)
  state.json            # state scheduler (resume-safe)
  bible/world.json      # canon: fakta dunia, lokasi, faksi, karakter, timeline
  bible/lessons.json    # jurnal belajar mandiri
  outline/outline.json  # arcs + outline tiap chapter
  outline/premise.json
  chapters/001-slug.md  # chapter dengan frontmatter status
  chapters/index.json
  exports/              # md, txt, bundle.json, <nama>.epub
  publish/              # royalroad/, wattpad/, web/index.html
```

Bible, style guide, dan outline adalah JSON biasa — Anda boleh mengedit manual;
sistem hanya melengkapi yang belum ada (`novel start`).

## Perintah

```
novel new --idea "..." | --surprise   buat project lengkap (premise → bible → outline)
novel start --idea "..."              lengkapi/renovasi plan project yang ada
novel idea [--surprise] [--count N]   brainstorm logline
novel write [n] [--all]               tulis chapter berikutnya (dengan check + fix)
novel check [n]                       periksa chapter yang sudah ditulis
novel fix <n>                         tulis ulang chapter dengan loop perbaikan
novel learn add|list|dismiss          jurnal pembelajaran
novel status                          dashboard progres
novel outline                         arcs + antrian chapter
novel canon                           dump dunia/karakter
novel schedule run|cron|status|tick   produksi terjadwal
novel export [md|txt|json|epub]       ekspor manuskrip
novel publish [royalroad|wattpad|web] paket publikasi
```

Selalu ada `novel help` dan flag `--project <dir>` untuk memakai project lain.

## Batasan

- Provider `mock` adalah generator deterministik untuk pengujian/offline: strukturnya
  benar (beat, dialog, panjang), tapi prosa kelas outline — untuk naskah publikasi
  pakai `anthropic` atau `openai-compatible`.
- Pilihan model/parameter lewat env `NOVEL_LLM_MODEL`, `NOVEL_LLM_BASE_URL`.
- Critic memakai heuristik + LLM review; ia menandai masalah, tapi keputusan akhir
  penerbitan tetap pada Anda (`status`, `check`, `learn list`).

## Pengembangan

```bash
npm run typecheck   # tsc --noEmit (wajib lolos)
npm test            # node --test tests/*.test.ts
npm run build       # → dist/, bin dist/src/cli.js
node dist/src/cli.js --help
```

Lihat `docs/ARCHITECTURE.md` untuk struktur modul dan `docs/USAGE.md` untuk contoh
lengkap (jadwal, ekspor, publikasi, belajar mandiri).
