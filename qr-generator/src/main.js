import "./styles/main.css";
import QRCode from "qrcode";

import { buildUsername, toInt } from "./scripts/login.js";
import { buildPayload } from "./scripts/payload.js";
import {
  parseCsvFile,
  normalizeCsvRow,
  extractMasterUsernames,
  isProbablyHeaderRow,
  arraysToHeaderObjects,
} from "./scripts/csv.js";
import { buildQrPdfBatchedAndOpenWithProgress } from "./scripts/pdf.js";

const els = {
  // manual inputs
  group: document.getElementById("group"),
  period: document.getElementById("period"),
  teacher: document.getElementById("teacher"),
  headset: document.getElementById("headset"),
  prefix: document.getElementById("prefix"),
  pad: document.getElementById("pad"),

  btn: document.getElementById("btn"),
  download: document.getElementById("download"),
  printManual: document.getElementById("printManual"),

  username: document.getElementById("username"),
  payload: document.getElementById("payload"),
  canvas: document.getElementById("qr"),
  status: document.getElementById("status"),

  // csv
  csvFile: document.getElementById("csvFile"),
  csvGenerate: document.getElementById("csvGenerate"),
  csvClear: document.getElementById("csvClear"),
  csvPrint: document.getElementById("csvPrint"),
  csvStatus: document.getElementById("csvStatus"),
  csvResults: document.getElementById("csvResults"),

  // stateful cancel (only visible during export)
  cancelExport: document.getElementById("cancelExport"),
};

let lastManualPrintItem = null; // { payload, groupCode, username }
let csvPrintItems = []; // array of { payload, groupCode, username }

const exportJob = {
  running: false,
  cancelRequested: false,
};

function tryOpen(url) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  return !!w;
}

/**
 * On-page warning message (no browser alert/confirm).
 * Visible only while exporting.
 */
function setExportWarningText(text) {
  // Prefer CSV status line as the banner location (most visible while exporting)
  // Also update manual status so user sees it in either workflow.
  els.csvStatus.textContent = text || "";
  els.status.textContent = text || "";
}

function setExportUi(isRunning) {
  exportJob.running = isRunning;

  // Disable actions while running
  els.printManual.disabled = isRunning;
  els.csvPrint.disabled = isRunning;
  els.btn.disabled = isRunning;
  els.csvGenerate.disabled = isRunning;
  els.csvClear.disabled = isRunning;

  // Show cancel button only while exporting
  if (els.cancelExport) {
    els.cancelExport.style.display = isRunning ? "inline-block" : "none";
    els.cancelExport.disabled = !isRunning;
  }

  // Optional: button text
  if (isRunning) {
    els.csvPrint.textContent = "Exporting PDFs...";
    els.printManual.textContent = "Exporting PDFs...";
  } else {
    els.csvPrint.textContent = "Print CSV QRs";
    els.printManual.textContent = "Print This QR";
  }

  // Show/hide text warning
  if (isRunning) {
    setExportWarningText("Generating PDFs… please keep this tab open until finished. (You can cancel.)");
  } else {
    // Don’t erase user messages like “Done generating…” automatically
    // Only clear if the message is the generic export warning.
    const generic = "Generating PDFs… please keep this tab open until finished. (You can cancel.)";
    if (els.csvStatus.textContent === generic) els.csvStatus.textContent = "";
    if (els.status.textContent === generic) els.status.textContent = "";
  }
}

els.cancelExport?.addEventListener("click", () => {
  if (!exportJob.running) return;
  exportJob.cancelRequested = true;
  setExportWarningText("Cancelling… (will stop after the current batch)");
});

function readManualForm() {
  const groupCode = els.group.value;
  const period = toInt(els.period.value);
  const teacher = (els.teacher?.value || "").trim();
  const headsetNumber = toInt(els.headset.value);
  const prefix = (els.prefix.value || "").trim() || "a";
  const headsetPad = toInt(els.pad.value) || 3;

  if (!Number.isFinite(period) || period < 1) throw new Error("Period must be a positive integer.");
  if (!Number.isFinite(headsetNumber) || headsetNumber < 1) throw new Error("Headset # must be a positive integer.");
  if (!prefix) throw new Error("Prefix is required.");
  if (!teacher) throw new Error("Teacher Name is required for printing.");

  const username = buildUsername({ prefix, headsetNumber, headsetPad });
  const payload = buildPayload({ groupCode, username });

  return { groupCode, period, teacher, headsetNumber, prefix, headsetPad, username, payload };
}

function readRowAsInput(rowObj) {
  const groupCode = rowObj.group;
  const period = toInt(rowObj.period);
  const headsetNumber = toInt(rowObj.headset);

  const prefix = (rowObj.prefix ?? "").toString().trim() || "a";

  const padInt = toInt(rowObj.pad);
  const headsetPad = Number.isFinite(padInt) ? padInt : 3;

  if (!groupCode || groupCode.length !== 4) throw new Error("Bad group code (expected 4 digits).");
  if (!Number.isFinite(period) || period < 1) throw new Error("Bad period (expected positive integer).");
  if (!Number.isFinite(headsetNumber) || headsetNumber < 1) throw new Error("Bad headset # (expected positive integer).");

  const username = buildUsername({ prefix, headsetNumber, headsetPad });
  const payload = buildPayload({ groupCode, username });

  return { groupCode, period, headsetNumber, prefix, headsetPad, username, payload };
}

async function renderQRToCanvas(canvas, payload, size = 256) {
  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "M",
    width: size,
    margin: 2,
  });
}

function downloadCanvasPng(canvas, filename) {
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function clearCsvResults() {
  els.csvResults.innerHTML = "";
  els.csvStatus.textContent = "";
  csvPrintItems = [];
}

function makeResultCard({ index, input, canvas }) {
  const card = document.createElement("div");
  card.className = "result-card";

  const title = document.createElement("h3");
  title.className = "result-title";
  title.textContent = `Row ${index + 1}: ${input.username}`;
  card.appendChild(title);

  const meta = document.createElement("p");
  meta.className = "result-meta";
  meta.textContent =
    `Group ${input.groupCode}` +
    `${input.username ? ` • ${input.username}` : ""}` +
    `${input.teacher ? ` • Teacher ${input.teacher}` : ""}` +
    `${input.period ? ` • Period ${input.period}` : ""}` +
    `${input.headsetNumber ? ` • Headset ${input.headsetNumber}` : ""}`;
  card.appendChild(meta);

  canvas.className = "result-canvas";
  card.appendChild(canvas);

  const actions = document.createElement("div");
  actions.className = "result-actions";

  const copyBtn = document.createElement("button");
  copyBtn.className = "small-btn secondary";
  copyBtn.type = "button";
  copyBtn.textContent = "Copy JSON";
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(input.payload);
    els.csvStatus.textContent = `Copied payload for Row ${index + 1}.`;
  });

  const dlBtn = document.createElement("button");
  dlBtn.className = "small-btn";
  dlBtn.type = "button";
  dlBtn.textContent = "Download PNG";
  dlBtn.addEventListener("click", () => {
    // filename uses whatever info we have
    const p = input.period ? `_p${input.period}` : "";
    const h = input.headsetNumber ? `_h${input.headsetNumber}` : "";
    downloadCanvasPng(canvas, `starborn_${input.groupCode}${p}${h}.png`);
  });

  actions.appendChild(copyBtn);
  actions.appendChild(dlBtn);
  card.appendChild(actions);

  return card;
}

async function generateManual() {
  els.status.textContent = "";
  const { groupCode, period, teacher, headsetNumber, username, payload } = readManualForm();

  els.username.textContent = username;
  els.payload.textContent = payload;

  await renderQRToCanvas(els.canvas, payload, 256);
  els.status.textContent = "QR generated.";

  lastManualPrintItem = { payload, groupCode, username, teacher, period };
}

async function generateFromCsv() {
  const file = els.csvFile.files?.[0];
  if (!file) {
    alert("Choose a CSV file first.");
    return;
  }

  clearCsvResults();
  csvPrintItems = [];

  els.csvStatus.textContent = "Parsing CSV...";

  // Parse ONCE as arrays so we can detect master matrix OR header CSV without re-parsing.
  const rawRows = await parseCsvFile(file, { hasHeader: false });

  // 1) Try master matrix first
  const masterItems = extractMasterUsernames(rawRows);

  if (masterItems.length > 0) {
    const PREVIEW_LIMIT = 80;
    els.csvStatus.textContent = `Found master sheet format. Generating ${masterItems.length} QR codes...`;

    let ok = 0;
    let bad = 0;

    for (let i = 0; i < masterItems.length; i++) {
      try {
        const { groupCode, username, teacher, period } = masterItems[i];

        const payload = buildPayload({ groupCode, username });

        // Only render previews for the first N to avoid lag
        if (i < PREVIEW_LIMIT) {
          const canvas = document.createElement("canvas");
          canvas.width = 256;
          canvas.height = 256;
          await renderQRToCanvas(canvas, payload, 256);

          const input = {
            groupCode,
            period: period || "",
            headsetNumber: "",
            username,
            payload,
            teacher: teacher || "",
          };

          const card = makeResultCard({ index: i, input, canvas });
          els.csvResults.appendChild(card);
        }

        csvPrintItems.push({
          payload,
          groupCode,
          username,
          teacher: teacher || "",
          period: period || "",
        });

        ok++;
      } catch {
        bad++;
      }

      if (i > 0 && i % 200 === 0) {
        els.csvStatus.textContent = `Generating… ${i}/${masterItems.length} processed.`;
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    els.csvStatus.textContent = `Done. ${ok} generated, ${bad} failed. (Previewing first ${Math.min(PREVIEW_LIMIT, ok)} only)`;
    return;
  }

  // 2) Fallback: row-per-user CSV flow
  // Decide whether row0 is a header row
  const hasHeader = isProbablyHeaderRow(rawRows?.[0]);

  let normalized;
  if (hasHeader) {
    // Convert arrays -> objects using normalized header keys, then normalize
    const objRows = arraysToHeaderObjects(rawRows);
    normalized = objRows.map((r) => normalizeCsvRow(r, { hasHeader: true }));
  } else {
    // Treat each row as positional columns: group, period, headset, prefix?, pad?
    normalized = rawRows.map((r) => normalizeCsvRow(r, { hasHeader: false }));
  }

  const rows = normalized.filter(
    (r) => (r.group ?? "") !== "" || (r.period ?? "") !== "" || (r.headset ?? "") !== ""
  );

  if (rows.length === 0) {
    els.csvStatus.textContent = "No usable rows found in CSV.";
    return;
  }

  const PREVIEW_LIMIT = 80;
  els.csvStatus.textContent = `Generating ${rows.length} QR codes...`;

  let ok = 0;
  let bad = 0;

  for (let i = 0; i < rows.length; i++) {
    try {
      const input = readRowAsInput(rows[i]);

      // Preview only first N
      if (i < PREVIEW_LIMIT) {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        await renderQRToCanvas(canvas, input.payload, 256);

        const card = makeResultCard({ index: i, input, canvas });
        els.csvResults.appendChild(card);
      }

      csvPrintItems.push({
        payload: input.payload,
        groupCode: input.groupCode,
        username: input.username,
      });

      ok++;
    } catch (err) {
      bad++;

      if (i < PREVIEW_LIMIT) {
        const card = document.createElement("div");
        card.className = "result-card";

        const title = document.createElement("h3");
        title.className = "result-title";
        title.textContent = `Row ${i + 1}: Error`;
        card.appendChild(title);

        const meta = document.createElement("p");
        meta.className = "result-meta";
        meta.textContent = err?.message || "Invalid row.";
        card.appendChild(meta);

        els.csvResults.appendChild(card);
      }
    }

    if (i > 0 && i % 200 === 0) {
      els.csvStatus.textContent = `Generating… ${i}/${rows.length} processed.`;
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  els.csvStatus.textContent = `Done. ${ok} generated, ${bad} failed. (Previewing first ${Math.min(PREVIEW_LIMIT, ok)} only)`;
}

// Manual handlers
els.btn.addEventListener("click", () => {
  generateManual().catch((err) => {
    els.status.textContent = "";
    alert(err.message);
  });
});

els.download.addEventListener("click", () => {
  try {
    downloadCanvasPng(els.canvas, "starborn-qr.png");
  } catch {
    alert("Generate a QR code first.");
  }
});

els.printManual.addEventListener("click", async () => {
  if (exportJob.running) return;

  if (!lastManualPrintItem) {
    alert("Generate a manual QR first.");
    return;
  }

  exportJob.cancelRequested = false;
  setExportUi(true);

  try {
    setExportWarningText("Generating PDFs… please keep this tab open until finished. (You can cancel.)");

    await buildQrPdfBatchedAndOpenWithProgress([lastManualPrintItem], {
      title: "Starborn Academy - Manual QR",
      perPage: 12,
      maxPagesPerPdf: 10,
      isCancelled: () => exportJob.cancelRequested,
      onProgress: (info) => {
        els.status.textContent = info.message;
      },
    });

    if (!exportJob.cancelRequested) {
      els.status.textContent += " PDFs opened in new tabs.";
    }
  } catch (err) {
    alert(err?.message || "PDF export failed.");
    els.status.textContent = "";
  } finally {
    setExportUi(false);
    exportJob.cancelRequested = false;
  }
});

// CSV handlers
els.csvGenerate.addEventListener("click", () => {
  generateFromCsv().catch((err) => {
    els.csvStatus.textContent = "";
    alert(err.message || "CSV import failed.");
  });
});

els.csvClear.addEventListener("click", clearCsvResults);

els.csvPrint.addEventListener("click", async () => {
  if (exportJob.running) return;

  if (!csvPrintItems.length) {
    alert("Generate CSV QRs first.");
    return;
  }

  exportJob.cancelRequested = false;
  setExportUi(true);

  try {
    // Tell user we’re batching if needed
    const perPage = 12;
    const maxPagesPerPdf = 10;
    const totalPages = Math.ceil(csvPrintItems.length / perPage);

    if (totalPages > maxPagesPerPdf) {
      const parts = Math.ceil(totalPages / maxPagesPerPdf);
      setExportWarningText(
        `Large export detected (${csvPrintItems.length} QRs, ${totalPages} pages). Exporting in ${parts} PDF batch(es) of ${maxPagesPerPdf} pages each…`
      );
    } else {
      setExportWarningText("Generating PDFs… please keep this tab open until finished. (You can cancel.)");
    }

    await buildQrPdfBatchedAndOpenWithProgress(csvPrintItems, {
      title: "Starborn Academy - CSV QRs",
      perPage,
      maxPagesPerPdf,
      isCancelled: () => exportJob.cancelRequested,
      onProgress: (info) => {
        els.csvStatus.textContent = info.message;
      },
    });

    if (!exportJob.cancelRequested) {
      els.csvStatus.textContent += " PDFs opened in new tabs.";
    }
  } catch (err) {
    alert(err?.message || "PDF export failed.");
    els.csvStatus.textContent = "";
  } finally {
    setExportUi(false);
    exportJob.cancelRequested = false;
  }
});

// Defaults
els.group.value = "0004";
els.period.value = "1";
els.headset.value = "48";
els.prefix.value = "a";
els.pad.value = "3";
els.teacher.value = "Doe";

// Auto-generate manual once on load
generateManual().catch(() => { });
