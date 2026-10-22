// v1.6.4 (C&I v14.9) UI helper: a workspace folder — one folder the user chooses once per laptop (e.g. the Google Drive for desktop
// folder, which the Drive app keeps in sync on both laptops). The tool saves each filing's project file there, keeps
// automatic backups next to it, saves generated XML into it, and lists every filing in it. No change to the filing data:
// the project file is the same file "Save project" downloads (plus the version stamp `meta.lastSaved`).
//
// Layout (created by the tool; folders and names follow the filing's company, CIN, year and report type):
//   <workspace>/<Company name> (<CIN>)/FY 2025-26/
//       <COMPANY>_2025-26_Standalone.mca-indas.json          the project (the master file)
//       backups/<COMPANY>_2025-26_Standalone_2026-10-20_1542_v7.mca-indas.json   previous versions (last 10 kept)
//       backups/<COMPANY>_2025-26_Standalone_v8_for-XML-v3.mca-indas.json       the project an XML was generated from (kept)
//       xml/<CIN>_Standalone_2026-03-31_v3_2026-10-20.xml                     generated XML (numbered)
//
// Works on a directory handle of the browser's File System Access API (Chrome / Edge); only these methods are used:
// getDirectoryHandle(name, {create}), getFileHandle(name, {create}), values(), removeEntry(name), and on a file handle
// getFile().text() and createWritable() → write(text), close(). Pure otherwise (tested with an in-memory folder).

export const BACKUPS_KEPT = 10;
export const PROJECT_EXT = '.mca-indas.json'; // the name "Save project" uses

// characters Windows / Drive do not allow in names; runs of spaces; length
const clean = (s, max = 80) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, max).trim().replace(/[. ]+$/, '');
// v1.6.5 (C&I v15.3): names kept short — Windows limits a whole path to 260 characters, and a backup's path repeats the
// name twice (folder and file); a company name longer than this is cut at a word
const short = (s, max) => { const c = clean(s, 200); if (c.length <= max) return c; const cut = c.slice(0, max); const sp = cut.lastIndexOf(' '); return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[. ]+$/, ''); };
const under = (s, max = 40) => short(s, max).replace(/ /g, '_');
const pad = (n) => String(n).padStart(2, '0');

/** "2025-26" from the current-year dates */
export function fyLabel(meta) {
  const s = meta?.periods?.cy?.start, e = meta?.periods?.cy?.end;
  if (!s || !e) return 'year-not-set';
  return `${s.slice(0, 4)}-${e.slice(2, 4)}`;
}
/** folder names and the project file name of a filing */
export function projectPath(meta) {
  const name = short(meta?.name, 60) || 'Unnamed company';
  const company = meta?.cin ? `${name} (${clean(meta.cin, 30)})` : name;
  const base = `${under(meta?.name) || 'Unnamed_company'}_${fyLabel(meta)}_${under(meta?.reportType) || 'Standalone'}`;
  return { company, year: `FY ${fyLabel(meta)}`, base, file: base + PROJECT_EXT };
}
const stampName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const dayName = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** the version stamp written into the project on every save (workspace or download) */
export function stampProject(json, { device = '', build = '', now = new Date() } = {}) {
  const prev = json.meta?.lastSaved;
  const n = (Number(prev?.n) || 0) + 1;
  json.meta = { ...json.meta, lastSaved: { n, at: now.toISOString(), device: String(device || '').slice(0, 60), build: String(build || '') } };
  return json.meta.lastSaved;
}

// ---- folder helpers
async function dir(root, names, create) {
  let d = root;
  for (const n of names) d = await d.getDirectoryHandle(n, { create });
  return d;
}
async function tryDir(root, names) { try { return await dir(root, names, false); } catch { return null; } }
async function readText(d, name) { try { return await (await (await d.getFileHandle(name)).getFile()).text(); } catch { return null; } }
async function writeText(d, name, text) {
  const fh = await d.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text);
  await w.close();
}
async function names(d, kind = 'file') {
  const out = [];
  if (!d) return out;
  for await (const h of d.values()) if (h.kind === kind) out.push(h.name);
  return out.sort();
}
const parse = (text) => { try { return JSON.parse(text); } catch { return null; } };

/**
 * Where a filing is saved: always the place its company name, CIN, year and report type give (v1.6.5, C&I v15.3 —
 * before, a filing kept the file it was opened from, so a filing imported under its XML file name stayed in a folder of
 * that name). `from`: the file it was opened from or last saved to (`link`), when that is the same filing (same CIN,
 * year and report type) in another place — e.g. the company name was corrected: the filing moves (moveFiling).
 */
export function targetPath(meta, link = null) {
  const std = projectPath(meta);
  const p = { ...std, folder: [std.company, std.year], xmlPrefix: `${clean(meta?.cin || 'instance', 30)}_${under(meta?.reportType) || 'Standalone'}_` };
  const same = link?.file && link.folder && (!link.key || link.key === filingKey(meta));
  if (same && (link.folder.join('/') !== p.folder.join('/') || link.file !== p.file)) p.from = { folder: link.folder, file: link.file, base: link.file.replace(/\.mca-indas\.json$/, '') };
  return p;
}
// v1.6.5 (C&I v15.3): one step of a save, named in the error ("A requested file or directory could not be found…" said
// nothing about which); a file-system error is tried once more after a moment (Google Drive for desktop may still be
// creating a folder)
async function step(label, fn) {
  try { return await fn(); } catch (e) {
    if (['NotFoundError', 'InvalidStateError', 'NoModificationAllowedError'].includes(e?.name)) {
      await new Promise((r) => setTimeout(r, 700));
      try { return await fn(); } catch (e2) { throw Object.assign(new Error(`${label}: ${e2.message}`), { name: e2.name, step: label }); }
    }
    throw Object.assign(new Error(`${label}: ${e?.message || e}`), { name: e?.name, step: label });
  }
}
/** what makes two projects the same filing (for keeping its file) */
export const filingKey = (meta) => `${meta?.cin || ''}|${meta?.periods?.cy?.start || ''}|${meta?.periods?.cy?.end || ''}|${meta?.reportType || ''}`;

/** the project file that is in the workspace now for this filing (its version stamp), or null */
export async function readWorkspaceProject(root, meta, link = null) {
  const p = targetPath(meta, link);
  let d = await tryDir(root, p.folder);
  let text = d && await readText(d, p.file);
  // not moved yet: the version in the place it was opened from
  if (text == null && p.from) { d = await tryDir(root, p.from.folder); text = d && await readText(d, p.from.file); }
  const json = text && parse(text);
  return json ? { path: p, json, text, lastSaved: json.meta?.lastSaved || null } : null;
}

/**
 * Is the file in the workspace newer than the version this laptop opened or last saved (`base` = its lastSaved)?
 * @returns {{ newer: boolean, other: object|null }} other = the workspace file's lastSaved
 */
export function newerElsewhere(base, other) {
  if (!other) return { newer: false, other: null };
  if (!base) return { newer: true, other };
  const n = Number(other.n) || 0, b = Number(base.n) || 0;
  return { newer: n > b || (n === b && other.at !== base.at), other };
}

/**
 * Save the project into the workspace. The version in the folder before this save is kept in backups (last 10).
 * @param json    the project (Filing.toJSON()); it is stamped here (meta.lastSaved)
 * @param base    lastSaved of the version this laptop opened / last saved, for the "newer elsewhere" check
 * @param force   save even if the folder has a newer version (the user confirmed; that version is backed up)
 * @returns {{ status: 'saved', path, lastSaved, backedUp } | { status: 'newer', path, other }}
 */
export async function saveToWorkspace(root, json, { base = null, force = false, device = '', build = '', now = new Date(), link = null } = {}) {
  const p = targetPath(json.meta, link);
  const where = (...n) => [...p.folder, ...n].join(' / ');
  const d = await step(`folder ${where()}`, () => dir(root, p.folder, true));
  let curText = await readText(d, p.file);
  // a filing opened from another place (name corrected): its version there is the one this save replaces
  const old = p.from ? await tryDir(root, p.from.folder) : null;
  if (curText == null && old) curText = await readText(old, p.from.file);
  const cur = curText && parse(curText);
  if (cur && !force && newerElsewhere(base, cur.meta?.lastSaved).newer) return { status: 'newer', path: p, other: cur.meta?.lastSaved || null };
  let backedUp = null;
  if (curText) {
    const bk = await step(`folder ${where('backups')}`, () => dir(d, ['backups'], true));
    const ls = cur?.meta?.lastSaved;
    const when = ls?.at ? new Date(ls.at) : now;
    backedUp = `${p.base}_${stampName(when)}_v${ls?.n ?? 0}${PROJECT_EXT}`;
    if (!(await names(bk)).includes(backedUp)) await step(`file ${where('backups', backedUp)}`, () => writeText(bk, backedUp, curText));
  }
  const lastSaved = stampProject(json, { device, build, now });
  await step(`file ${where(p.file)}`, () => writeText(d, p.file, JSON.stringify(json, null, 1)));
  const moved = old ? await moveFiling(root, p, old) : null;
  if (curText) await pruneBackups(await dir(d, ['backups'], true), p.base);
  return { status: 'saved', path: p, lastSaved, backedUp, moved };
}
/**
 * v1.6.5 (C&I v15.3): the rest of a filing that moved (its company name was corrected): its backups and XML files are
 * copied into the new place (backups renamed to the new name), then removed from the old place — the old folders too,
 * when that leaves them empty. Nothing is removed unless its copy was written. Best effort: what cannot be moved stays
 * where it is. The other report type's files in the same folder stay.
 * @returns {{ from: string, copied: number, left: string[] }}
 */
async function moveFiling(root, p, old) {
  const d = await dir(root, p.folder, true);
  const out = { from: p.from.folder.join(' / '), copied: 0, left: [] };
  for (const sub of ['backups', 'xml']) {
    const src = await tryDir(old, [sub]);
    if (!src) continue;
    const dst = await dir(d, [sub], true);
    const have = new Set(await names(dst));
    for (const n of await names(src)) {
      if (sub === 'backups' && !n.startsWith(p.from.base + '_')) continue;
      if (sub === 'xml' && !n.startsWith(p.xmlPrefix)) continue;
      const to = sub === 'backups' ? p.base + n.slice(p.from.base.length) : n;
      try {
        const text = await readText(src, n);
        if (text == null) { out.left.push(`${sub}/${n}`); continue; }
        if (!have.has(to)) await writeText(dst, to, text);
        await src.removeEntry(n); out.copied++;
      } catch { out.left.push(`${sub}/${n}`); }
    }
  }
  try { await old.removeEntry(p.from.file); } catch { out.left.push(p.from.file); }
  // empty folders of the old place
  const empty = async (dd) => { for await (const _ of dd.values()) return false; return true; };
  try {
    for (const sub of ['backups', 'xml']) { const s = await tryDir(old, [sub]); if (s && await empty(s)) await old.removeEntry(sub); }
    if (await empty(old)) {
      const parent = await tryDir(root, p.from.folder.slice(0, -1));
      if (parent) { await parent.removeEntry(p.from.folder.at(-1)); if (p.from.folder.length > 1 && await empty(parent)) await (await tryDir(root, p.from.folder.slice(0, -2)) || root).removeEntry(p.from.folder.at(-2)); }
    }
  } catch { /* folders left as they are */ }
  return out;
}
const DATED = (base) => new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{4}-\\d{2}-\\d{2}_\\d{4}_v\\d+\\.mca-indas\\.json$`);
async function pruneBackups(bk, base) {
  const re = DATED(base);
  const dated = (await names(bk)).filter((n) => re.test(n)).sort();
  for (const n of dated.slice(0, Math.max(0, dated.length - BACKUPS_KEPT))) await bk.removeEntry(n);
}

/**
 * Save a generated XML into the workspace (numbered), with the project it was generated from (kept in backups).
 * The project itself is saved first (saveToWorkspace); call this after a successful save.
 */
export async function saveXmlToWorkspace(root, json, xml, { withErrors = false, now = new Date(), link = null } = {}) {
  const p = targetPath(json.meta, link);
  const where = (...n) => [...p.folder, ...n].join(' / ');
  const d = await step(`folder ${where()}`, () => dir(root, p.folder, true));
  const x = await step(`folder ${where('xml')}`, () => dir(d, ['xml'], true));
  const m = json.meta;
  const prefix = `${clean(m.cin || 'instance', 30)}_${under(m.reportType) || 'Standalone'}_${m.periods?.cy?.end || 'date'}_v`;
  const nums = (await names(x)).filter((n) => n.startsWith(prefix)).map((n) => Number(/_v(\d+)_/.exec(n.slice(prefix.length - 2))?.[1]) || 0);
  const k = Math.max(0, ...nums) + 1;
  const file = `${prefix}${k}_${dayName(now)}${withErrors ? '_with-errors' : ''}.xml`;
  await step(`file ${where('xml', file)}`, () => writeText(x, file, xml));
  const bk = await step(`folder ${where('backups')}`, () => dir(d, ['backups'], true));
  const snap = `${p.base}_v${m.lastSaved?.n ?? 0}_for-XML-v${k}${PROJECT_EXT}`;
  await step(`file ${where('backups', snap)}`, () => writeText(bk, snap, JSON.stringify(json, null, 1)));
  return { file, version: k, snapshot: snap, path: p };
}

/** every filing in the workspace: <company>/<FY>/<project>.mca-indas.json (and project files directly in those folders) */
export async function listWorkspace(root) {
  const out = [];
  const visit = async (d, at, depth) => {
    for await (const h of d.values()) {
      if (h.kind === 'file' && h.name.endsWith(PROJECT_EXT)) {
        let json = null;
        try { json = parse(await (await h.getFile()).text()); } catch { /* a file Drive has not brought down yet: skipped */ }
        if (!json || json.format !== 'mca-indas-xbrl-project') continue;
        const m = json.meta || {};
        // a standalone and a consolidated filing of the same year share the folder: their files are told apart by name
        const own = h.name.slice(0, -PROJECT_EXT.length) + '_';
        const xmlPrefix = `${clean(m.cin || 'instance', 30)}_${under(m.reportType) || 'Standalone'}_`;
        const xml = (await names(await tryDir(d, ['xml']))).filter((n) => n.startsWith(xmlPrefix));
        const backups = (await names(await tryDir(d, ['backups']))).filter((n) => n.startsWith(own));
        out.push({ folder: at, file: h.name, name: m.name || '', cin: m.cin || '', reportType: m.reportType || '', fy: fyLabel(m), lastSaved: m.lastSaved || null, xml, backups });
      } else if (h.kind === 'directory' && depth < 2 && h.name !== 'backups' && h.name !== 'xml') {
        await visit(h, [...at, h.name], depth + 1);
      }
    }
  };
  await visit(root, [], 0);
  return out.sort((a, b) => a.name.localeCompare(b.name) || b.fy.localeCompare(a.fy) || a.reportType.localeCompare(b.reportType));
}
/** read a file of a listed filing: its project, or one of its backups / XML files */
export async function readWorkspaceFile(root, folder, file, sub = null) {
  const d = await tryDir(root, sub ? [...folder, sub] : folder);
  const text = d && await readText(d, file);
  if (text == null) throw new Error(`${[...folder, sub, file].filter(Boolean).join(' / ')} could not be read`);
  return text;
}
