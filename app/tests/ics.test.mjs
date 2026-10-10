// Gorgon 2.0 — ICS generator tests (Module C).
// Run: node --test tests/   (from app/)

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildICS, escapeText, foldLine, toICSUtc } from "../src/lib/ics.js";

test("toICSUtc formats UTC and rejects garbage", () => {
  assert.equal(toICSUtc(new Date("2026-09-19T14:00:00+08:00")), "20260919T060000Z");
  assert.equal(toICSUtc("2026-09-19T06:00:00Z"), "20260919T060000Z");
  assert.equal(toICSUtc("not a date"), null);
  assert.equal(toICSUtc(null), null);
});

test("escapeText handles RFC 5545 specials", () => {
  assert.equal(escapeText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  assert.equal(escapeText(null), "");
  assert.equal(escapeText("上海 AI 沙龙：第 3 期"), "上海 AI 沙龙：第 3 期");
});

test("foldLine keeps short lines intact and folds long ones under 75 chars", () => {
  assert.equal(foldLine("SUMMARY:短标题"), "SUMMARY:短标题");
  const long = "DESCRIPTION:" + "很长的描述".repeat(30);
  const folded = foldLine(long);
  for (const line of folded.split("\r\n")) {
    assert.ok(line.length <= 75, `line under 75: ${line.length}`);
  }
  // continuation lines start with exactly one space
  const parts = folded.split("\r\n");
  for (const p of parts.slice(1)) assert.ok(p.startsWith(" "));
  // content preserved after unfolding
  const unfolded = parts.map((p, i) => (i === 0 ? p : p.slice(1))).join("");
  assert.equal(unfolded, long);
});

test("buildICS produces a valid single-event document", () => {
  const ics = buildICS({
    uid: "gorgon-a1@workbench",
    summary: "上海 AI Meetup; 第 3 期",
    start: "2026-09-19T14:00:00+08:00",
    end: "2026-09-19T17:00:00+08:00",
    location: "徐汇区某空间",
    description: "带换行\n的描述",
    url: "https://example.com/signup",
    now: "2026-09-15T00:00:00Z",
  });
  assert.ok(ics.includes("BEGIN:VCALENDAR"));
  assert.ok(ics.includes("BEGIN:VEVENT"));
  assert.ok(ics.includes("UID:gorgon-a1@workbench"));
  assert.ok(ics.includes("DTSTART:20260919T060000Z"));
  assert.ok(ics.includes("DTEND:20260919T090000Z"));
  assert.ok(ics.includes("DTSTAMP:20260915T000000Z"));
  assert.ok(ics.includes("SUMMARY:上海 AI Meetup\\; 第 3 期"));
  assert.ok(ics.includes("LOCATION:徐汇区某空间"));
  assert.ok(ics.includes("DESCRIPTION:带换行\\n的描述"));
  assert.ok(ics.includes("URL:https://example.com/signup"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  // CRLF line endings
  const lfOnly = ics.replace(/\r\n/g, "").includes("\n");
  assert.equal(lfOnly, false, "bare LF must not appear outside folds");
});

test("buildICS defaults DTEND to start+2h", () => {
  const ics = buildICS({
    uid: "u2", summary: "x", start: "2026-09-19T06:00:00Z",
    now: "2026-09-15T00:00:00Z",
  });
  assert.ok(ics.includes("DTSTART:20260919T060000Z"));
  assert.ok(ics.includes("DTEND:20260919T080000Z"));
});

test("buildICS returns null without required fields — never fabricates", () => {
  assert.equal(buildICS(null), null);
  assert.equal(buildICS({ summary: "x", start: new Date() }), null, "no uid");
  assert.equal(buildICS({ uid: "u", start: new Date() }), null, "no summary");
  assert.equal(buildICS({ uid: "u", summary: "x" }), null, "no start");
  assert.equal(buildICS({ uid: "u", summary: "x", start: "garbage" }), null, "bad start");
});
