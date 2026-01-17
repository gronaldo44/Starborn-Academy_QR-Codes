import Papa from "papaparse";

function normalizeKey(k) {
  return (k ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function cellStr(v) {
  return (v ?? "").toString().trim();
}

function isRowLabel(row, label) {
  return normalizeKey(row?.[0] ?? "") === normalizeKey(label);
}

function carryForward(values) {
  // if a column is blank, inherit previous non-empty value
  const out = [...values];
  let last = "";
  for (let i = 0; i < out.length; i++) {
    const v = cellStr(out[i]);
    if (v) last = v;
    else out[i] = last;
  }
  return out;
}

/**
 * Heuristic: first row contains at least 2 known-ish column labels.
 * Used to detect header CSVs without re-parsing.
 */
export function isProbablyHeaderRow(row) {
  if (!Array.isArray(row) || row.length < 2) return false;

  const keys = row.map((c) => normalizeKey(cellStr(c)));
  const known = new Set([
    "group",
    "group_code",
    "groupcode",
    "period",
    "per",
    "headset",
    "headset_number",
    "headsetnumber",
    "headset_no",
    "headset_num",
    "prefix",
    "pad",
    "padding",
    "headset_digits",
    "headset_pad",
  ]);

  let hits = 0;
  for (const k of keys) if (known.has(k)) hits++;
  return hits >= 2;
}

/**
 * Convert array-rows into objects based on the first row as headers.
 * Header keys are normalized the same way Papa's transformHeader would.
 */
export function arraysToHeaderObjects(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const header = rows[0].map((h) => normalizeKey(h));
  const out = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r)) continue;

    const obj = {};
    for (let c = 0; c < header.length; c++) {
      const key = header[c];
      if (!key) continue;
      obj[key] = r[c];
    }
    out.push(obj);
  }

  return out;
}

/**
 * Parses CSV file into either:
 * - array of arrays (header:false)
 * - array of objects (header:true) [not required by main.js anymore, but kept for flexibility]
 */
export function parseCsvFile(file, { hasHeader = false } = {}) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: hasHeader,
      skipEmptyLines: "greedy",
      transformHeader: hasHeader ? (h) => normalizeKey(h) : undefined,
      complete: (results) => {
        if (results.errors?.length) {
          reject(new Error(results.errors[0].message || "CSV parse error"));
          return;
        }
        resolve(results.data);
      },
      error: (err) => reject(err),
    });
  });
}

/**
 * Extracts (groupCode, username) pairs from the “Usernames Master” matrix.
 *
 * Expected structure:
 *  - a row where col A = "Group code"
 *  - a row where col A = "Usernames"
 *  - subsequent rows continue listing usernames in the same columns
 *
 * Output: [{ groupCode, username }, ...]
 */
export function extractMasterUsernames(rawRows) {
  if (!Array.isArray(rawRows) || !Array.isArray(rawRows[0])) return [];

  let teacherRowIndex = -1;
  let groupRowIndex = -1;
  let periodsRowIndex = -1;
  let usernamesRowIndex = -1;

  for (let i = 0; i < rawRows.length; i++) {
    const r = rawRows[i];
    if (!Array.isArray(r) || r.length === 0) continue;

    const label = normalizeKey(cellStr(r[0]));
    if (label === "teacher") teacherRowIndex = i;
    else if (label === "group_code") groupRowIndex = i;
    else if (label === "class_periods") periodsRowIndex = i;
    else if (label === "usernames") usernamesRowIndex = i;

    if (teacherRowIndex >= 0 && groupRowIndex >= 0 && periodsRowIndex >= 0 && usernamesRowIndex >= 0) break;
  }

  // Require at least group + usernames to qualify as master
  if (groupRowIndex < 0 || usernamesRowIndex < 0) return [];

  const teacherRow = teacherRowIndex >= 0 ? rawRows[teacherRowIndex] : null;
  const groupRow = rawRows[groupRowIndex];
  const periodsRow = periodsRowIndex >= 0 ? rawRows[periodsRowIndex] : null;

  // Columns are B..end (index 1+)
  const teachers = teacherRow ? carryForward(teacherRow.slice(1).map(cellStr)) : [];
  const groupCodes = carryForward(groupRow.slice(1).map(cellStr));
  const periods = periodsRow ? carryForward(periodsRow.slice(1).map(cellStr)) : [];

  const maxCols = groupCodes.length;
  const out = [];

  // usernames start *after* the "Usernames" row
  for (let r = usernamesRowIndex + 1; r < rawRows.length; r++) {
    const row = rawRows[r];
    if (!Array.isArray(row) || row.length < 2) continue;

    const cols = Math.min(maxCols, row.length - 1);
    for (let c = 1; c <= cols; c++) {
      const username = cellStr(row[c]);
      if (!username) continue;

      const groupCode = cellStr(groupCodes[c - 1]);
      if (!groupCode) continue;

      const teacher = teachers.length ? cellStr(teachers[c - 1]) : "";
      const period = periods.length ? cellStr(periods[c - 1]) : "";

      out.push({ groupCode, username, teacher, period });
    }
  }

  return out;
}

/**
 * Converts raw CSV row -> normalized input object:
 * { group, period, headset, prefix?, pad? }
 *
 * Supports header-based rows and array-based rows (no header).
 */
export function normalizeCsvRow(row, { hasHeader = true } = {}) {
  if (!hasHeader) {
    // row is an array in order: group, period, headset, prefix?, pad?
    const group = row?.[0];
    const period = row?.[1];
    const headset = row?.[2];
    const prefix = row?.[3];
    const pad = row?.[4];
    return { group, period, headset, prefix, pad };
  }

  // row is an object with normalized keys
  const r = row || {};

  const group = pick(r, ["group", "group_code", "groupcode"]);
  const period = pick(r, ["period", "per"]);
  const headset = pick(r, ["headset", "headset_number", "headsetnumber", "headset_no", "headset_num"]);
  const prefix = pick(r, ["prefix", "class_prefix", "teacher_prefix"]);
  const pad = pick(r, ["pad", "padding", "headset_pad", "headset_digits"]);

  return { group, period, headset, prefix, pad };
}
