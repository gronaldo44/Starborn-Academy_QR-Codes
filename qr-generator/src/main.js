import QRCode from "qrcode";

const groupEl = document.getElementById("group");
const periodEl = document.getElementById("period");
const headsetEl = document.getElementById("headset");
const btn = document.getElementById("btn");
const payloadEl = document.getElementById("payload");
const canvas = document.getElementById("qr");

function buildPayload() {
  const group = groupEl.value.trim();
  const period = Number(periodEl.value);
  const headset = Number(headsetEl.value);

  if (!group) throw new Error("Group is required.");
  if (!Number.isFinite(period)) throw new Error("Period must be a number.");
  if (!Number.isFinite(headset)) throw new Error("Headset # must be a number.");

  // compact + versioned JSON
  const obj = { v: 1, g: group, p: period, h: headset };

  // compact JSON (no spaces)
  return JSON.stringify(obj);
}

async function generate() {
  const payload = buildPayload();
  payloadEl.textContent = payload;

  await QRCode.toCanvas(canvas, payload, {
    errorCorrectionLevel: "M",
    width: 256,
    margin: 2,
  });
}

btn.addEventListener("click", () => {
  generate().catch((err) => alert(err.message));
});

// default demo values
groupEl.value = "A";
periodEl.value = "3";
headsetEl.value = "12";
generate();
