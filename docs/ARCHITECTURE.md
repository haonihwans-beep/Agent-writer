# Arsitektur

```text
src/
  cli.ts                 entry point: parsing argumen, dispatch, error handling
  core/
    types.ts             semua tipe domain (plain JSON)
    store.ts             layout project + IO atomik (tmp+rename), discovery
    style-default.ts     kontrak gaya default + daftar frasa terlarang (AI tells)
    llm.ts               interface provider + Mock / Anthropic / OpenAI-compatible
    mock-provider.ts     generator deterministik (offline/tests)
    prompts.ts           pembangun prompt (setiap prompt menarik potongan bible
                         relevan, style guide, lesson, dan tail chapter sebelumnya)
    creator.ts           idea → premise → bible → outline (tersanitasi)
    writer.ts            pipeline tulis 1 chapter + loop check-and-fix
    critic.ts            critic deterministik + self-review LLM
    lessons.ts           jurnal belajar mandiri (dedup, hits, eskalasi severity)
    scheduler.ts         burst + pace harian (daemon/tick/cron), resume-safe
    export.ts            md/txt/json/EPUB + adaptor publikasi
    zip.ts               penulis ZIP minimal (CRC32 + deflate) untuk EPUB
  util/                  rng, text, json-loose, ids, clock, log
tests/                   node:test: store, text, critic, lessons, zip, pipeline e2e
```

## Aliran data satu chapter

1. `writer.writeChapter` memuat config, bible, style, lesson aktif.
2. `prompts.buildChapterPrompt` menyusun system (kontrak gaya + aturan prosa) dan
   user (summary, beats, potongan bible yang relevan, lesson, tail chapter N-1),
   lalu menambahkan blok `## DATA` JSON — inilah yang membuat provider dapat
   ditukar tanpa mengubah prompt.
3. Contoh chapter dibersihkan dari scaffolding (`cleanProse`), lalu:
   - `critic.checkContinuity` — aturan deterministik.
   - `critic.reviewChapter` — self-review LLM (JSON: score, verdict, issues).
4. Jika ada ≥2 error dan `autoFix` aktif → `prompts.buildFixPrompt` → tulis ulang
   (maksimal 2 percobaan).
5. Temuat disimpan ke `bible/lessons.json`; chapter ditulis sebagai markdown
   ber-frontmatter dan dicatat di `chapters/index.json`.

## Kenapa kualitas "manusiawi" bisa dipertahankan

- **Satu sumber kebenaran.** Semua klaim chapter divalidasi terhadap bible; proper
  noun tak terdaftar, usia yang berubah, dan karakter mati yang muncul ditandai.
- **Kontrak gaya eksplisit.** Daftar frasa terlarang (delves, tapestry, "a wave of
  … washed over", …) diperiksa sebagai *error*, bukan saran.
- **Belajar umpan balik.** Temuan berulang menjadi lesson; lesson dengan severity
  dan frekuensi tertinggi disuntikkan ke prompt berikutnya.
- **Kontinuitas antar chapter.** Ekor 150 kata chapter sebelumnya ikut dalam prompt,
  jadi chapter baru melanjutkan, bukan mengulang.

## Scheduler

`planToday` menentukan kuota harian: *burst* (mis. 30 chapter pada hari pertama,
mencukupi sampai total `burst`) lalu kuota deterministik 3–5 chapter/hari
(`quotaForDate`, seed = nama project + tanggal, jadi restart menghasilkan rencana
yang sama). `runSchedule` adalah daemon: tulis → catat di `state.json` → tidur
sampai jam berikutnya. `runTick` mode cron: satu hari produksi per invokasi,
idempoten untuk tanggal yang sama.

## Persistensi

Semua tulisan lewat `Store.saveJSON`/`writeText` (tmp + rename) — daemon yang
di-`kill` di chapter tengah tetap meninggalkan project konsisten. `state.json`
menyimpan riwayat hari produksi sehingga `resume` hanya melengkapi yang belum ada.

## Pengujian

`tests/pipeline.test.ts` menjalankan pipeline penuh (premise → bible → outline →
tulis → check → lesson → export md/txt/json/EPUB → publish) dengan provider mock,
plus scheduler dengan jam palsu. `tests/zip.test.ts` memvalidasi arsip EPUB dengan
`unzip -t` (CRC diperiksa end-to-end).
