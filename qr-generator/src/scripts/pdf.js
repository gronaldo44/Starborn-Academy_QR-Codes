import { jsPDF } from "jspdf";
import QRCode from "qrcode";

const DEFAULTS = {
    title: "Starborn Academy - QR Codes",
    perPage: 12, // 3 cols x 4 rows
    cols: 3,
    rows: 4,
    page: "letter",
    unit: "in",
    margin: 0.2,
    gap: 0.1,

    // cell styling
    pad: 0.08,
    dashInset: 0.07,
    cropLen: 0.10, // crop mark length

    // QR
    qrEcl: "M",
    qrPx: 512, // raster size embedded into PDF (sharp printing)

    // Header styling (inches)
    headerTopPad: 0.12,
    headerBlockH: 0.98, 
};

const qrDataUrlCache = new Map(); // key -> dataUrl

async function payloadToPngDataUrlCached(payload, opts) {
    const key = `${opts.qrEcl}|${opts.qrPx}|${payload}`;
    const hit = qrDataUrlCache.get(key);
    if (hit) return hit;

    const dataUrl = await QRCode.toDataURL(payload, {
        errorCorrectionLevel: opts.qrEcl,
        margin: 2,
        width: opts.qrPx,
    });

    qrDataUrlCache.set(key, dataUrl);
    return dataUrl;
}

function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

async function payloadToPngDataUrl(payload, opts) {
    return await QRCode.toDataURL(payload, {
        errorCorrectionLevel: opts.qrEcl,
        margin: 2,
        width: opts.qrPx,
    });
}

function drawCropMarks(doc, x, y, w, h, len) {
    // Top-left
    doc.line(x, y, x + len, y);
    doc.line(x, y, x, y + len);

    // Top-right
    doc.line(x + w - len, y, x + w, y);
    doc.line(x + w, y, x + w, y + len);

    // Bottom-left
    doc.line(x, y + h, x + len, y + h);
    doc.line(x, y + h - len, x, y + h);

    // Bottom-right
    doc.line(x + w - len, y + h, x + w, y + h);
    doc.line(x + w, y + h - len, x + w, y + h);
}

function drawCell(doc, x, y, w, h, opts) {
    doc.setLineDash([]);
    doc.rect(x, y, w, h);

    doc.setLineDash([0.06, 0.06]);
    doc.rect(x + opts.dashInset, y + opts.dashInset, w - 2 * opts.dashInset, h - 2 * opts.dashInset);

    doc.setLineDash([]);
    drawCropMarks(doc, x, y, w, h, opts.cropLen);
}

function underline(doc, x, y, width) {
    // Draw a thin underline slightly below baseline
    doc.setLineWidth(0.01);
    doc.line(x, y + 0.03, x + width, y + 0.03);
}

function drawCenteredMixedLine(doc, centerX, y, leftText, rightText, leftStyle, rightStyle, underlineRight = false) {
    // Measure total width with styles
    doc.setFont("helvetica", leftStyle);
    const wLeft = doc.getTextWidth(leftText);

    doc.setFont("helvetica", rightStyle);
    const wRight = doc.getTextWidth(rightText);

    const total = wLeft + wRight;
    const startX = centerX - total / 2;

    // Draw left
    doc.setFont("helvetica", leftStyle);
    doc.text(leftText, startX, y);

    // Draw right
    const rightX = startX + wLeft;
    doc.setFont("helvetica", rightStyle);
    doc.text(rightText, rightX, y);

    // Underline the value portion if desired
    if (underlineRight && rightText) {
        const valueW = wRight;
        underline(doc, rightX, y, valueW);
    }
}

function drawHeader(doc, x, y, w, opts, groupCode, username, teacher, period) {
  const centerX = x + w / 2;

  // Move down slightly to avoid clipping
  const y0 = y + 0.06;

  // Top line: "Starborn Academy"
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Starborn Academy", centerX, y0, { align: "center" });

  // Big lines
  doc.setFontSize(16);

  // Username first (underlined value)
  drawCenteredMixedLine(
    doc,
    centerX,
    y0 + 0.28,
    "Username: ",
    String(username ?? ""),
    "bold",
    "normal",
    true
  );

  // Group Code second (underlined value)
  drawCenteredMixedLine(
    doc,
    centerX,
    y0 + 0.56,
    "Group Code: ",
    String(groupCode ?? ""),
    "bold",
    "normal",
    true
  );

  // Teacher + Period line (smaller)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const parts = [];
  if (teacher) parts.push(`Teacher: ${teacher}`);
  if (period) parts.push(`Period: ${period}`);
  const line = parts.join("   •   ");

  if (line) {
    doc.text(line, centerX, y0 + 0.74, { align: "center" });
  }
}

export async function buildQrPdf(items, userOpts = {}) {
    function yieldToUI() {
        return new Promise((r) => setTimeout(r, 0));
    }

    const opts = { ...DEFAULTS, ...userOpts };

    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("No items to export.");
    }

    const doc = new jsPDF({
        orientation: "portrait",
        unit: opts.unit,
        format: opts.page,
        compress: true,
    });

    // Letter in inches
    const pageW = 8.5;
    const pageH = 11;

    const usableW = pageW - opts.margin * 2;
    const usableH = pageH - opts.margin * 2;

    const totalGapW = opts.gap * (opts.cols - 1);
    const totalGapH = opts.gap * (opts.rows - 1);

    const cellW = (usableW - totalGapW) / opts.cols;
    const cellH = (usableH - totalGapH) / opts.rows;

    const pages = chunk(items, opts.perPage);

    for (let p = 0; p < pages.length; p++) {
        if (p > 0) doc.addPage();

        // Title (small)
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        doc.text(`${opts.title} (Page ${p + 1} of ${pages.length})`, opts.margin, opts.margin - 0.15);

        const pageItems = pages[p];

        for (let i = 0; i < pageItems.length; i++) {
            const it = pageItems[i];

            const r = Math.floor(i / opts.cols);
            const c = i % opts.cols;

            const x = opts.margin + c * (cellW + opts.gap);
            const y = opts.margin + r * (cellH + opts.gap);

            doc.setDrawColor(0);
            doc.setLineWidth(0.01);
            drawCell(doc, x, y, cellW, cellH, opts);

            // Inner content area
            const innerX = x + opts.pad;
            const innerY = y + opts.pad;
            const innerW = cellW - 2 * opts.pad;
            const innerH = cellH - 2 * opts.pad;

            // Header block (like your screenshot)
            const headerY = innerY + opts.headerTopPad;
            drawHeader(doc, innerX, headerY, innerW, opts, it.groupCode, it.username, it.teacher, it.period);

            // QR area below header
            const qrTop = innerY + opts.headerBlockH;
            const qrAvailH = innerY + innerH - qrTop;

            const qrSize = Math.min(innerW, qrAvailH);
            const qrX = innerX + (innerW - qrSize) / 2;
            const qrY = qrTop;

            const pngDataUrl = await payloadToPngDataUrlCached(it.payload, opts);
            doc.addImage(pngDataUrl, "PNG", qrX, qrY, qrSize, qrSize);

            // yield every 3-4 items (tune)
            if (i % 3 === 0) await yieldToUI();
        }
    }

    return doc;
}

export async function buildQrPdfAndOpen(items, opts = {}) {
    const doc = await buildQrPdf(items, opts);
    const blobUrl = doc.output("bloburl");
    window.open(blobUrl, "_blank", "noopener,noreferrer");
}

export async function buildQrPdfAndDownload(items, filename = "starborn_qr_codes.pdf", opts = {}) {
    const doc = await buildQrPdf(items, opts);
    doc.save(filename);
}

// --- Add near bottom of src/scripts/pdf.js ---

function yieldToUI() {
    return new Promise((r) => setTimeout(r, 0));
}

/**
 * Batched PDF export with progress callbacks + cancel support.
 *
 * @param {Array} items
 * @param {Object} opts
 * @param {(info: {phase:string, part:number, totalParts:number, done:number, total:number, remaining:number, message:string})=>void} opts.onProgress
 * @param {()=>boolean} opts.isCancelled
 * @param {number} opts.perPage
 * @param {number} opts.maxPagesPerPdf
 * @param {string} opts.title
 * @returns {Promise<{cancelled:boolean, totalParts:number}>}
 */
export async function buildQrPdfBatchedAndOpenWithProgress(items, opts = {}) {
    const perPage = opts.perPage ?? 12;
    const maxPagesPerPdf = opts.maxPagesPerPdf ?? 10;
    const title = opts.title ?? "Starborn Academy - QR Codes";
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => { };
    const isCancelled = typeof opts.isCancelled === "function" ? opts.isCancelled : () => false;

    const itemsPerPdf = perPage * maxPagesPerPdf;

    if (!Array.isArray(items) || items.length === 0) {
        throw new Error("No items to export.");
    }

    const totalParts = Math.ceil(items.length / itemsPerPdf);

    if (totalParts > 1) {
        onProgress({
            phase: "batching",
            part: 0,
            totalParts,
            done: 0,
            total: items.length,
            remaining: items.length,
            message: `Large export detected (${items.length} QRs). Creating ${totalParts} PDFs in batches of ${maxPagesPerPdf} pages.`,
        });
        await yieldToUI();
    }

    let done = 0;

    for (let part = 0; part < totalParts; part++) {
        if (isCancelled()) {
            onProgress({
                phase: "cancelled",
                part: part + 1,
                totalParts,
                done,
                total: items.length,
                remaining: items.length - done,
                message: `Cancelled. ${done}/${items.length} completed.`,
            });
            return { cancelled: true, totalParts };
        }

        const start = part * itemsPerPdf;
        const end = Math.min(items.length, start + itemsPerPdf);
        const slice = items.slice(start, end);

        const partTitle = totalParts > 1 ? `${title} (Part ${part + 1} of ${totalParts})` : title;

        onProgress({
            phase: "building",
            part: part + 1,
            totalParts,
            done,
            total: items.length,
            remaining: items.length - done,
            message: `Building PDF ${part + 1}/${totalParts} (${slice.length} QRs)...`,
        });
        await yieldToUI();

        const doc = await buildQrPdf(slice, { ...opts, title: partTitle, perPage });

        if (isCancelled()) {
            onProgress({
                phase: "cancelled",
                part: part + 1,
                totalParts,
                done,
                total: items.length,
                remaining: items.length - done,
                message: `Cancelled after building PDF ${part + 1}.`,
            });
            return { cancelled: true, totalParts };
        }

        // Open the PDF in a new tab
        const blobUrl = doc.output("bloburl");
        const opened = window.open(blobUrl, "_blank", "noopener,noreferrer");

        done += slice.length;

        onProgress({
            phase: "opened",
            part: part + 1,
            totalParts,
            done,
            total: items.length,
            remaining: items.length - done,
            message: `Finished PDF ${part + 1}/${totalParts}. (${done}/${items.length} done, ${items.length - done} remaining)`,
        });

        await yieldToUI();
    }

    onProgress({
        phase: "done",
        part: totalParts,
        totalParts,
        done,
        total: items.length,
        remaining: 0,
        message: `All PDFs generated. (${done}/${items.length})`,
    });

    return { cancelled: false, totalParts };
}
