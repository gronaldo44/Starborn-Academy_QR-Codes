import { onlyDigits, padLeft } from "./format.js";

/**
 * Username rule (matches your example):
 *   username = {prefix}.{headset-number-padded}
 * Example:
 *   prefix=a, headset=48, pad=3 => a.048
 *
 * Period is still included in the QR payload separately.
 */
export function buildUsername({ prefix, headsetNumber, headsetPad }) {
  const cleanPrefix = (prefix ?? "").trim();
  const paddedHeadset = padLeft(onlyDigits(headsetNumber), headsetPad, "0");
  return `${cleanPrefix}.${paddedHeadset}`;
}

export function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}
