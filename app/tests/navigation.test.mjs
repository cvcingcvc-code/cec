// Gorgon 2.0 — navigation helper tests (Module D).
// Run: node --test tests/   (from app/)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isValidCoord, geoUri, amapRouteUrl, baiduRouteUrl, googleMapsUrl,
  suggestVisitOrder, haversineKm,
} from "../src/lib/navigation.js";

const PEOPLE_SQ = { lat: 31.2304, lng: 121.4737 };   // 人民广场
const WUJIAOCHANG = { lat: 31.3005, lng: 121.5145 }; // 五角场
const XUHUI = { lat: 31.1885, lng: 121.4365 };       // 徐家汇

test("isValidCoord accepts real Shanghai coords, rejects junk", () => {
  assert.equal(isValidCoord(PEOPLE_SQ), true);
  assert.equal(isValidCoord(null), false);
  assert.equal(isValidCoord({ lat: "31.23", lng: 121.47 }), false, "string lat rejected");
  assert.equal(isValidCoord({ lat: 91, lng: 0 }), false);
  assert.equal(isValidCoord({ lat: 0, lng: 181 }), false);
  assert.equal(isValidCoord({}), false);
});

test("geoUri builds an RFC 5870 URI and refuses fabricated coords", () => {
  const uri = geoUri(WUJIAOCHANG, { label: "五角场(店)" });
  assert.equal(uri, "geo:31.3005,121.5145?q=31.3005,121.5145(五角场店)");
  assert.equal(geoUri(WUJIAOCHANG), "geo:31.3005,121.5145?q=31.3005,121.5145");
  assert.equal(geoUri(null), null);
});

test("map hand-off URLs carry the destination and never invent one", () => {
  // URLSearchParams percent-encodes commas; decode before asserting
  assert.ok(decodeURIComponent(amapRouteUrl(null, WUJIAOCHANG)).includes("121.5145,31.3005"));
  assert.ok(baiduRouteUrl(null, XUHUI).includes("31.1885,121.4365"));
  assert.ok(googleMapsUrl(XUHUI, PEOPLE_SQ).includes("31.2304,121.4737/31.1885,121.4365"));
  assert.equal(amapRouteUrl(null, { lat: NaN, lng: 1 }), null);
  assert.equal(baiduRouteUrl(null, undefined), null);
  assert.equal(googleMapsUrl({}), null);
});

test("haversineKm: People's Square -> Wujiaochang is ~8-9 km", () => {
  const d = haversineKm(PEOPLE_SQ, WUJIAOCHANG);
  assert.ok(d > 7 && d < 10, `got ${d}`);
  assert.equal(haversineKm(PEOPLE_SQ, PEOPLE_SQ), 0);
  assert.equal(haversineKm(null, PEOPLE_SQ), Infinity);
});

test("suggestVisitOrder: nearest-neighbour from origin, explainable", () => {
  const stops = [
    { id: "s1", name: "徐家汇", coord: XUHUI },
    { id: "s2", name: "五角场", coord: WUJIAOCHANG },
  ];
  const { ordered, explainable } = suggestVisitOrder(stops, PEOPLE_SQ);
  assert.equal(explainable, true);
  // from 人民广场: 徐家汇 ~5.9km is nearer than 五角场 ~8.7km => s1 first
  assert.ok(haversineKm(PEOPLE_SQ, XUHUI) < haversineKm(PEOPLE_SQ, WUJIAOCHANG));
  assert.deepEqual(ordered.map((s) => s.id), ["s1", "s2"]);
});

test("suggestVisitOrder: coordless stops keep input order at the end", () => {
  const stops = [
    { id: "n1", name: "无坐标地点" },
    { id: "s1", name: "五角场", coord: WUJIAOCHANG },
  ];
  const { ordered } = suggestVisitOrder(stops, PEOPLE_SQ);
  assert.deepEqual(ordered.map((s) => s.id), ["s1", "n1"]);
});

test("suggestVisitOrder without any coords degrades honestly", () => {
  const stops = [{ id: "n1" }, { id: "n2" }];
  const { ordered, explainable } = suggestVisitOrder(stops, null);
  assert.equal(explainable, false, "no fake routing claim without coords");
  assert.deepEqual(ordered.map((s) => s.id), ["n1", "n2"]);
});
