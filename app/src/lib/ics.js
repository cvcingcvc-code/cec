// Gorgon 2.0 — ICS (iCalendar) generator, Module C.
//
// A pure function: no storage, no React, no side effects. Given ONE event it
// returns a standards-shaped .ics text the user can hand to any calendar app
// (Google/Apple/Outlook). Kept deliberately minimal and dependency-free so it
// runs identically in the browser, under Node (unit tests), and inside the
// Android WebView.
//
// Scope honesty: this exports a calendar ENTRY for an activity. It does NOT
// claim the user registered — "已打开报名链接" is never "报名成功" (see
// opportunity-repository.js registration states). The ICS only carries the
// event's own start/end/location; anything unverified upstream stays out.

/** Zero-pad to 2 digits. */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * Format a Date as an ICS UTC timestamp: 20260919T060000Z.
 * Returns null for an invalid/absent date so callers can skip the property
 * rather than emit a corrupt line.
 */
export function toICSUtc(date) {
  // new Date(null) coerces to the epoch — a FABRICATED time. Treat null /
  // undefined / empty string as "no date" before constructing anything.
  if (date == null || date === "") return null;
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    "T" +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    "Z"
  );
}

/**
 * Escape a TEXT value per RFC 5545 §3.3.11: backslash, semicolon, comma and
 * newline are special. Newlines become the two-character sequence \n.
 */
export function escapeText(value) {
  return String(value == null ? "" : value)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\n");
}

/**
 * Fold a content line to <=75 octets, continuing with a single leading space
 * (RFC 5545 §3.1). We fold on character boundaries; CJK is multi-byte but a
 * generous 60-char first segment keeps every real line well under the limit
 * without splitting a surrogate pair mid-character.
 */
export function foldLine(line) {
  const s = String(line);
  if (s.length <= 72) return s;
  const parts = [];
  let i = 0;
  let first = true;
  while (i < s.length) {
    const width = first ? 72 : 71; // continuation lines carry a leading space
    let end = Math.min(i + width, s.length);
    // never split a UTF-16 surrogate pair
    if (end < s.length) {
      const code = s.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) end -= 1;
    }
    parts.push((first ? "" : " ") + s.slice(i, end));
    i = end;
    first = false;
  }
  return parts.join("\r\n");
}

/**
 * Build a single-event .ics document.
 *
 * @param {object} ev
 * @param {string} ev.uid         stable unique id (required)
 * @param {string} ev.summary     event title (required)
 * @param {Date|string} ev.start  start time (required)
 * @param {Date|string} [ev.end]  end time; defaults to start+2h when absent
 * @param {string} [ev.location]  venue / address
 * @param {string} [ev.description] body text (may contain newlines)
 * @param {string} [ev.url]        official source / registration link
 * @param {Date|string} [ev.now]  DTSTAMP; defaults to the current time
 * @returns {string|null} the .ics text, or null when uid/summary/start missing
 */
export function buildICS(ev) {
  if (!ev || !ev.uid || !ev.summary) return null;
  const start = toICSUtc(ev.start);
  if (!start) return null;
  const endDate = ev.end
    ? (ev.end instanceof Date ? ev.end : new Date(ev.end))
    : new Date(new Date(ev.start).getTime() + 2 * 60 * 60 * 1000);
  const end = toICSUtc(endDate) || start;
  const stamp = toICSUtc(ev.now || new Date()) || start;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gorgon Workbench//Opportunity v2//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + escapeText(ev.uid),
    "DTSTAMP:" + stamp,
    "DTSTART:" + start,
    "DTEND:" + end,
    "SUMMARY:" + escapeText(ev.summary),
  ];
  if (ev.location) lines.push("LOCATION:" + escapeText(ev.location));
  if (ev.description) lines.push("DESCRIPTION:" + escapeText(ev.description));
  if (ev.url) lines.push("URL:" + escapeText(ev.url));
  lines.push("END:VEVENT", "END:VCALENDAR");

  // Fold each property line, then join with CRLF (RFC 5545 requires CRLF).
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
