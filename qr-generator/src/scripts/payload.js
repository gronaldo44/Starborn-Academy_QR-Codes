/**
 * Build the JSON payload that gets encoded into the QR code.
 * Required format:
 * {"version":"1.0","username":"myname.code","groupcode":"mygroup"}
 */
export function buildPayload({ username, groupCode }) {
  // Keep groupcode as a string to preserve leading zeros (e.g. "0004")
  const payloadObj = {
    version: "1.0",
    username: String(username ?? ""),
    groupcode: String(groupCode ?? ""),
  };

  return JSON.stringify(payloadObj);
}
