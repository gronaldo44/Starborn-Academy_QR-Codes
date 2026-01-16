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
 * Parses any CSV file into either:
 * - array of objects (header mode)
 * - array of arrays (no header)
 */
export function parseCsvFile(file, { hasHeader = true } = {}) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: hasHeader,
      skipEmptyLines: "greedy",
      transformHeader: (h) => normalizeKey(h),
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
 * NEW: Extracts (groupCode, username) pairs from the “Usernames Master” matrix.
 *
 * Expected structure:
 *  - a row where col A = "Group code"
 *  - a row where col A = "Class periods" (optional, we don’t need it for payload)
 *  - a row where col A = "Usernames"
 *  - subsequent rows continue listing usernames in the same columns
 *
 * Output: [{ groupCode, username }, ...]
 */
export function extractMasterUsernames(rawRows) {
  // rawRows must be arrays (header:false)
  if (!Array.isArray(rawRows) || !Array.isArray(rawRows[0])) return [];

  const groupRowIndex = rawRows.findIndex((r) => isRowLabel(r, "Group code"));
  const usernamesRowIndex = rawRows.findIndex((r) => isRowLabel(r, "Usernames"));

  if (groupRowIndex < 0 || usernamesRowIndex < 0) return [];

  const groupRow = rawRows[groupRowIndex];
  const groupCodes = carryForward(groupRow.slice(1).map(cellStr)); // columns B..end

  const out = [];

  // usernames start on the "Usernames" row and continue below it
  for (let r = usernamesRowIndex; r < rawRows.length; r++) {
    const row = rawRows[r];
    // skip if row is too short
    if (!Array.isArray(row) || row.length < 2) continue;

    for (let c = 1; c < row.length; c++) {
      const username = cellStr(row[c]);
      const groupCode = cellStr(groupCodes[c - 1]);

      if (!username) continue;
      if (!groupCode) continue;

      out.push({ groupCode, username });
    }
  }

  return out;
}

/**
 * Old behavior: Converts raw CSV row -> normalized input object:
 * { group, period, headset, prefix?, pad? }
 *
 * Supports header-based rows and array-based rows (no header).
 */
export function normalizeCsvRow(row, { hasHeader = true } = {}) {
  if (!hasHeader) {
    // row is an array in order: group, period, headset, prefix?, pad?
    const group = row[0];
    const period = row[1];
    const headset = row[2];
    const prefix = row[3];
    const pad = row[4];
    return { group, period, headset, prefix, pad };
  }

  // row is an object with normalized keys
  const r = row;

  const group = pick(r, ["group", "group_code", "groupcode"]);
  const period = pick(r, ["period", "per"]);
  const headset = pick(r, [
    "headset",
    "headset_number",
    "headsetnumber",
    "headset_no",
    "headsetnumber_",
    "headset_number_",
    "headset-number",
  ]);
  const prefix = pick(r, ["prefix", "class_prefix", "teacher_prefix"]);
  const pad = pick(r, ["pad", "padding", "headset_pad", "headset_digits"]);

  return { group, period, headset, prefix, pad };
}
