export function onlyDigits(str) {
  return (str ?? "").toString().replace(/\D+/g, "");
}

export function padLeft(value, length, char = "0") {
  const s = (value ?? "").toString();
  if (s.length >= length) return s;
  return char.repeat(length - s.length) + s;
}
