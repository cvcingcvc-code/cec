# Crawl-to-pipeline bridge (V3F 任务 C/数据线): douban RawEvents JSON ->
# pipeline/data/raw/ JSON, so the REAL crawled activities flow through the
# canonical ingest->normalize->...->review->export pipeline instead of the
# frontend silently serving months-old DEMO rows.
#
#   python -m pipeline.bridge.crawl_to_raw \
#       --events pipeline/data/crawl/douban_events.json \
#       --out pipeline/data/raw/douban_2026-10-14.json
#
# DETERMINISTIC FORMAT CONVERSION — no invented facts:
#   * startTime "2026-10-01T08:00:00" is SPLIT (not re-interpreted) into
#     canonical startDate "2026-10-01" + startTime "08:00"; same for endTime.
#     The source published these values verbatim (RawEvent contract: the
#     datetime attribute as-is); splitting an ISO timestamp is lossless.
#   * venueName -> venue (the schema's field name for the same fact).
#   * sourceName / sourceUrl / sourceEventId / organizer / address /
#     district / city / price pass through verbatim.
#   * V3J (P1 搜索图片): the listing row's poster URL
#     (rawData["listing"]["imageUrl"]) is a REAL image the source published
#     — it is promoted verbatim to the top-level imageUrl with
#     imageSource "listing-thumbnail" (provenance: the listing-row artwork,
#     not verified detail art). Records without one keep imageUrl None —
#     the UI then shows its own clearly-labelled placeholder. No URL is
#     ever invented.
#   * Every record keeps the crawl's sourceUrl — traceable provenance.
#
# Records already in canonical shape (no "T" in startTime) pass through
# unchanged. Idempotent: same input -> same output.

import argparse
import json
import os
import sys

DEFAULT_EVENTS = os.path.join("pipeline", "data", "crawl", "douban_events.json")


def _repo_root():
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _split_iso(value):
    """'2026-10-01T08:00:00' -> ('2026-10-01', '08:00').

    Pure split of a verbatim source timestamp — no timezone math, no
    re-interpretation. Non-ISO input passes through as (value, None) so
    the normalizer's own parser takes it downstream.
    """
    if not value or not isinstance(value, str):
        return None, None
    text = value.strip()
    if "T" not in text:
        return text or None, None  # already date-only, if valid
    date_part, time_part = text.split("T", 1)
    if len(date_part) != 10:
        return value, None  # not a plain ISO date — hand to the normalizer
    hh = time_part[:5] if len(time_part) >= 5 else None
    return date_part, hh or None


def _listing_image_url(ev):
    """The listing row's own poster URL, verbatim — or None.

    V3J: the douban crawler records the listing-row image under
    rawData["listing"]["imageUrl"] (it is real artwork the source
    published), but the flat RawEvent contract has no top-level image
    field, so the URL never reached the normalized/approved/export chain
    and every search card fell back to the category placeholder. Promote
    it verbatim: no rewriting, no invented URL, None stays None.
    """
    raw = ev.get("rawData") or {}
    listing = raw.get("listing") or {}
    url = listing.get("imageUrl")
    if isinstance(url, str) and url.strip():
        return url.strip()
    return None


def convert_event(ev, collected_at=None):
    """One RawEvent dict -> one canonical raw activity dict."""
    start_date, start_time = _split_iso(ev.get("startTime"))
    end_date, end_time = _split_iso(ev.get("endTime"))
    image_url = _listing_image_url(ev)
    act = {
        "title": ev.get("title"),
        "startDate": start_date,
        "startTime": start_time,
        "endDate": end_date,
        "endTime": end_time,
        "venue": ev.get("venueName"),
        "address": ev.get("address"),
        "district": ev.get("district"),
        "city": ev.get("city"),
        "price": ev.get("price"),
        "organizer": ev.get("organizer"),
        "sourceName": ev.get("sourceName"),
        "sourceUrl": ev.get("sourceUrl"),
        # V3J (P1 搜索图片): real listing artwork, provenance-labelled.
        # schema.py already knows imageUrl/imageSource/imageType; emitting
        # None keeps records without one honest (UI shows its labelled
        # placeholder). No URL is ever invented.
        "imageUrl": image_url,
        "imageSource": "listing-thumbnail" if image_url else None,
        "imageType": "remote" if image_url else None,
    }
    if collected_at:
        act["collectedAt"] = collected_at
    # Stable id: derived from the source event id when present (idempotent
    # across re-runs), else a hash of the whole record.
    if ev.get("sourceEventId"):
        act["id"] = "douban_%s" % ev["sourceEventId"]
    else:
        import hashlib

        digest = hashlib.sha1(
            json.dumps(act, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()[:10]
        act["id"] = "douban_raw_%s" % digest
    return act


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="pipeline.bridge.crawl_to_raw",
        description="Convert crawled RawEvents JSON into pipeline raw-source "
                    "JSON (deterministic split, no invented facts).")
    parser.add_argument("--events", default=None,
                        help="crawled RawEvents JSON (default: "
                             "pipeline/data/crawl/douban_events.json)")
    parser.add_argument("--out", default=None,
                        help="output raw JSON path (default: "
                             "pipeline/data/raw/douban_<date>.json)")
    parser.add_argument("--collected-at", default=None,
                        help="collectedAt stamp (default: events file mtime)")
    args = parser.parse_args(argv)

    events_path = args.events or os.path.join(_repo_root(), DEFAULT_EVENTS)
    with open(events_path, encoding="utf-8") as fh:
        payload = json.load(fh)
    events = payload.get("events", [])
    if not events:
        print("no events in %s" % events_path, file=sys.stderr)
        return 1

    collected_at = args.collected_at
    if not collected_at:
        collected_at = payload.get("generatedAt") or None

    acts = [convert_event(ev, collected_at) for ev in events]

    out_path = args.out or os.path.join(
        _repo_root(), "pipeline", "data", "raw",
        "douban_%s.json" % (payload.get("city") or "crawl"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    body = {
        "_notice": "REAL CRAWLED DATA — converted from %s by "
                   "pipeline.bridge.crawl_to_raw (deterministic split; "
                   "no invented facts). Re-crawl overwrites by re-running "
                   "the bridge." % os.path.basename(events_path),
        "DEMO_DATA": False,  # REAL crawled records, not demo fixtures
        "count": len(acts),
        "activities": acts,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(body, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    print("converted %d events -> %s" % (len(acts), out_path))
    return 0


if __name__ == "__main__":
    sys.exit(main())
