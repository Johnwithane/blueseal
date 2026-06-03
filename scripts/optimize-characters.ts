/**
 * Convert mascot source PNGs → optimized transparent .webp shipped by the site.
 *
 * Sources live in public/characters/png/ (gitignored — they don't deploy); the
 * .webp outputs land in public/characters/ (committed, served at /characters/…).
 * Loose PNGs left directly in public/characters/ are picked up too, for
 * convenience.
 *
 * The art is flat cartoon line-work, which WebP crushes far smaller than PNG
 * while keeping crisp alpha transparency. This script also:
 *   - caps height at MAX_HEIGHT (downscale only — never upscales a small source);
 *   - normalizes stray trailing underscores ("cleaning_" → "cleaning") so the
 *     output matches the name <SealCharacter> expects;
 *   - skips malformed names with no id (e.g. "seal-trade-.png");
 *   - skips accidental duplicate downloads ("…-1.png", "…-2.png").
 *
 * Idempotent: re-run any time you add PNGs. Run: npm run optimize:characters
 */
import sharp from "sharp";
import { readdir, stat } from "node:fs/promises";
import { join, parse } from "node:path";

const OUT_DIR = "public/characters";
const SRC_DIRS = [join(OUT_DIR, "png"), OUT_DIR]; // prefer png/, also catch loose files
const MAX_HEIGHT = 768; // largest on-page use is ~220px tall; 768 covers hi-dpi + zoom
const QUALITY = 80;

/** Output stem, or null to skip a file. */
function outName(stem: string): string | null {
  const clean = stem.replace(/_+$/, ""); // drop trailing underscores
  if (/^seal-(trade|pose|scene)-$/.test(clean)) return null; // empty id
  if (/-\d+$/.test(clean)) return null; // accidental "…-1" duplicate download
  return clean;
}

async function main() {
  // Collect (dir, file) jobs from each source dir that exists.
  const jobs: { dir: string; file: string }[] = [];
  for (const dir of SRC_DIRS) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue; // dir doesn't exist — fine
    }
    for (const file of entries) {
      if (file.toLowerCase().endsWith(".png")) jobs.push({ dir, file });
    }
  }

  let inBytes = 0;
  let outBytes = 0;
  let converted = 0;
  const skipped: string[] = [];

  for (const { dir, file } of jobs) {
    const out = outName(parse(file).name);
    if (!out) {
      skipped.push(file);
      continue;
    }
    const src = join(dir, file);
    const dest = join(OUT_DIR, `${out}.webp`);

    try {
      const before = (await stat(src)).size;
      await sharp(src)
        .resize({ height: MAX_HEIGHT, withoutEnlargement: true })
        .webp({ quality: QUALITY, alphaQuality: 100, effort: 6 })
        .toFile(dest);
      const after = (await stat(dest)).size;
      inBytes += before;
      outBytes += after;
      converted += 1;
      console.log(
        `  ${file.padEnd(34)} ${String(Math.round(before / 1024)).padStart(4)}KB → ${out}.webp ${String(Math.round(after / 1024)).padStart(3)}KB`,
      );
    } catch (err) {
      // A file that vanished/changed mid-run (live editing) shouldn't abort the
      // whole batch — note it and carry on. Re-running picks it up.
      skipped.push(`${file} (${(err as NodeJS.ErrnoException).code ?? "error"})`);
    }
  }

  const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
  console.log(`\n✓ ${converted} converted${skipped.length ? `, ${skipped.length} skipped: ${skipped.join(", ")}` : ""}`);
  if (inBytes > 0) {
    console.log(`  ${mb(inBytes)} MB PNG → ${mb(outBytes)} MB WebP  (${Math.round((1 - outBytes / inBytes) * 100)}% smaller)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
