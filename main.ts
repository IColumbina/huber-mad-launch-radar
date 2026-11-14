import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/huber.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX = 65_536;
const SHOTS_CAP = { max: 4, max_bytes: 524_288 };
const SAFE_IMG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flag(key: string, def: string): string {
  const i = process.argv.indexOf(`--${key}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${key}=`));
  return eq === undefined ? def : eq.slice(key.length + 3);
}

const inPath = flag('input', '/input');
const snapFile = inPath.endsWith('.json') ? inPath : join(inPath, 'snapshot.json');
if (!existsSync(snapFile)) {
  process.stderr.write(`Missing snapshot: ${snapFile}\n`);
  process.exit(2);
}

const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(snapFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const err = boardIssue(board, snapshot);
if (err !== null) {
  process.stderr.write(`Gate issue: ${err}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

function mirrorDir(src: string, dst: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dst, { recursive: true });
  const files: string[] = [];
  for (const name of readdirSync(src).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(src, name);
    if (!statSync(p).isFile()) continue;
    copyFileSync(p, join(dst, name));
    files.push(name);
  }
  return files;
}

const dashFiles = mirrorDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = mirrorDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shotFiles.length < 3 || shotFiles.some((f) => !SAFE_IMG.test(f))) {
  process.stderr.write(`Expected >=3 valid screenshot PNGs\n`);
  process.exit(1);
}

writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, {
  text_max_bytes: TEXT_MAX,
  screenshots: SHOTS_CAP,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
}));

process.stdout.write(`${radar.model_version}: ${board.length} ranked (${dashFiles.length} dash files, ${shotFiles.length} shots)\n`);
