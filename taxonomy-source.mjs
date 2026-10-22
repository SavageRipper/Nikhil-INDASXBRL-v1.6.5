// Extracts the Ind AS taxonomy package (Taxonomy-2017-03-31.zip, kept as supplied) into .taxonomy/ (git-ignored) so the
// DTS loader can read it. Pure Node (zlib), no dependencies.
// v1.6: the package is the taxonomy the MCA validator downloads (it carries the two-letter SRN pattern and the corrected
// biological-assets roll-forward, not yet in the package published on the MCA website). Its files sit at the zip root;
// the published package nested them under 'Ind AS taxonomy/Ind AS taxonomy/'. The folder holding the entry point is
// taken as the root either way, and the extraction is redone whenever the zip changes (.source-sha256).
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const TAXONOMY_ZIP_NAME = 'Taxonomy-2017-03-31.zip';
export const TAXONOMY_ZIP = path.join(ROOT, TAXONOMY_ZIP_NAME);
export const TAXONOMY_DIR = path.join(ROOT, '.taxonomy');
// extracted to .taxonomy/IndAS/ (no spaces, so file URLs stay plain for external processors such as Arelle)
export const TAXONOMY_ROOT = path.join(TAXONOMY_DIR, 'IndAS');
export const ENTRY_POINT = 'in-ci-ent-2017-03-31.xsd';

export function ensureTaxonomy() {
  const buf = readFileSync(TAXONOMY_ZIP);
  const stamp = path.join(TAXONOMY_ROOT, '.source-sha256'), sha = createHash('sha256').update(buf).digest('hex');
  if (existsSync(path.join(TAXONOMY_ROOT, ENTRY_POINT)) && existsSync(stamp) && readFileSync(stamp, 'utf8') === sha) return TAXONOMY_ROOT;
  rmSync(TAXONOMY_ROOT, { recursive: true, force: true });
  // end of central directory record
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Taxonomy zip: end of central directory not found');
  const count = buf.readUInt16LE(eocd + 10);
  // the folder of the entry point is the taxonomy root
  const names = [];
  { let q = buf.readUInt32LE(eocd + 16); for (let i = 0; i < count; i++) { const nl = buf.readUInt16LE(q + 28), xl = buf.readUInt16LE(q + 30), cl = buf.readUInt16LE(q + 32); names.push(buf.toString('utf8', q + 46, q + 46 + nl).replace(/\\/g, '/')); q += 46 + nl + xl + cl; } }
  const entry = names.find((n) => n === ENTRY_POINT || n.endsWith('/' + ENTRY_POINT));
  if (!entry) throw new Error(`Taxonomy zip: entry point ${ENTRY_POINT} not found`);
  const PACKAGE_PREFIX = entry.slice(0, entry.length - ENTRY_POINT.length);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Taxonomy zip: bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen).replace(/\\/g, '/');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (name.split('/').includes('..')) throw new Error(`Taxonomy zip: unsafe path ${name}`);
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    if (!name.startsWith(PACKAGE_PREFIX)) continue;
    const out = path.join(TAXONOMY_ROOT, name.slice(PACKAGE_PREFIX.length));
    mkdirSync(path.dirname(out), { recursive: true });
    if (method === 0) writeFileSync(out, data);
    else if (method === 8) writeFileSync(out, inflateRawSync(data));
    else throw new Error(`Taxonomy zip: unsupported compression ${method} for ${name}`);
  }
  writeFileSync(stamp, sha);
  return TAXONOMY_ROOT;
}
