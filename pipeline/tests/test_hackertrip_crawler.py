# V2.5 — HackerTrip crawler tests (offline, real-site fixtures).
#
# Fixtures were fetched from the LIVE site (2026-10-23):
#   * fixtures/hackertrip-explore.html — https://hackertrip.space/explore
#   * fixtures/hackertrip-detail-payathon.html — PAYATHON detail page
#
# Pins: JSON-LD ItemList discovery, Event JSON-LD + dt/dd parsing,
# deadline ISO derivation (+08:00), honesty (missing stays None),
# base-crawler contract (crawl() end-to-end with a stub fetcher).

import unittest
from pathlib import Path

from pipeline.crawlers.hackertrip import (
    HackerTripCrawler,
    _deadline_iso_or_none,
    _dt_dd_map,
    _event_node,
    _item_list,
)

FIXTURES = Path(__file__).parent / "fixtures"
EXPLORE = (FIXTURES / "hackertrip-explore.html").read_text(encoding="utf-8", errors="replace")
DETAIL = (FIXTURES / "hackertrip-detail-payathon.html").read_text(encoding="utf-8", errors="replace")


def make_crawler():
    """Crawler with a stub fetcher serving every discovered URL.

    The real fixtures serve /explore and the PAYATHON detail. Every other
    hackathon detail URL gets a minimal valid page WITHOUT Event JSON-LD
    (-> parse_detail returns None -> listing-hint fallback events, never
    dropped, never STOP_REPEATED_FAILURES).
    """
    FALLBACK_DETAIL = "<html><body><p>no event json-ld</p></body></html>"
    pages = {
        "https://hackertrip.space/explore": EXPLORE,
        "https://hackertrip.space/hackathon/ht-payathon-2026": DETAIL,
    }

    class StubResult:
        def __init__(self, html, url):
            self.ok = html is not None
            self.html = html
            self.finalUrl = url
            self.reason = None if html is not None else "http_error"
            self.detail = None
            self.status = 200 if html is not None else 404

    class StubFetcher:
        def __init__(self, settings=None, politeness_delay=None):
            pass

        def fetch(self, url):
            if url not in pages:
                # Derive a per-URL fallback so every discovered URL succeeds.
                pages[url] = FALLBACK_DETAIL
            return StubResult(pages.get(url), url)

    return HackerTripCrawler(settings=None, fetcher=StubFetcher())


class TestListing(unittest.TestCase):
    def test_item_list_found(self):
        lst = _item_list(EXPLORE)
        self.assertIsNotNone(lst)
        self.assertEqual(lst.get("@type"), "ItemList")

    def test_listing_parses_41_items(self):
        crawler = make_crawler()
        page = crawler.parse_listing(EXPLORE, "https://hackertrip.space/explore")
        self.assertGreaterEqual(len(page.entries), 41)
        self.assertFalse(page.hasNext)

    def test_listing_entries_carry_url_and_title(self):
        crawler = make_crawler()
        page = crawler.parse_listing(EXPLORE, "https://hackertrip.space/explore")
        pay = [e for e in page.entries if e.url.endswith("ht-payathon-2026")]
        self.assertEqual(len(pay), 1)
        self.assertIn("PAYATHON", pay[0].title)
        self.assertEqual(pay[0].sourceEventId, "ht-payathon-2026")

    def test_listing_has_no_dates(self):
        crawler = make_crawler()
        page = crawler.parse_listing(EXPLORE, "https://hackertrip.space/explore")
        for e in page.entries:
            self.assertIsNone(e.startTime)
            self.assertIsNone(e.city)


class TestDetail(unittest.TestCase):
    def test_event_node_found(self):
        node = _event_node(DETAIL)
        self.assertIsNotNone(node)
        self.assertEqual(node.get("@type"), "Event")
        self.assertIn("PAYATHON", node.get("name") or "")

    def test_dt_dd_map_extracts_facts(self):
        facts = _dt_dd_map(DETAIL)
        self.assertIn("报名截止", facts)
        self.assertIn("12月1日", facts["报名截止"])
        self.assertIn("奖金池", facts)
        self.assertIn("¥200,000", facts["奖金池"])
        self.assertIn("参赛形式", facts)

    def test_deadline_iso_derived_from_short_text(self):
        # "12月1日 23:59" + endDate year 2026 -> +08:00 ISO
        iso = _deadline_iso_or_none("12月1日 23:59", "2026-12-26T00:00:00.000Z")
        self.assertEqual(iso, "2026-12-01T23:59:00+08:00")

    def test_deadline_iso_none_for_vague_text(self):
        self.assertIsNone(_deadline_iso_or_none("待主办方公布", "2026-12-26T00:00:00.000Z"))
        self.assertIsNone(_deadline_iso_or_none("9月21日至12月1日", "2026-12-26T00:00:00.000Z"))
        self.assertIsNone(_deadline_iso_or_none(None, None))

    def test_parse_detail_full(self):
        crawler = make_crawler()
        page = crawler.parse_listing(EXPLORE, "https://hackertrip.space/explore")
        entry = [e for e in page.entries if e.url.endswith("ht-payathon-2026")][0]
        event = crawler.parse_detail(DETAIL, entry.url, entry)
        self.assertIsNotNone(event)
        self.assertIn("PAYATHON", event.title)
        self.assertEqual(event.startTime, "2026-09-21T00:00:00.000Z")
        self.assertEqual(event.endTime, "2026-12-26T00:00:00.000Z")
        self.assertEqual(event.organizer, "支付宝AI付")
        self.assertEqual(event.sourceName, "HackerTrip")
        self.assertTrue(event.sourceUrl.startswith("https://hackertrip.space/hackathon/"))
        # prize comes from the 奖金池 dt/dd row (raw text, review normalizes)
        self.assertIn("200,000", event.price)
        # honesty: participation mode derived from the REAL attendanceMode
        self.assertEqual(event.rawData["participationMode"], "线上 + 线下")
        self.assertEqual(event.rawData["deadlineText"], "12月1日 23:59")
        self.assertEqual(event.rawData["registrationDeadline"], "2026-12-01T23:59:00+08:00")

    def test_parse_detail_no_event_jsonld_returns_none(self):
        crawler = make_crawler()
        page = crawler.parse_listing(EXPLORE, "https://hackertrip.space/explore")
        entry = page.entries[0]
        self.assertIsNone(crawler.parse_detail("<html><body>empty</body></html>", entry.url, entry))


class TestCrawlContract(unittest.TestCase):
    def test_full_crawl_end_to_end(self):
        crawler = make_crawler()
        events, report = crawler.crawl()
        # discovery found the items; detail pass served the PAYATHON fixture
        # (other URLs miss the stub -> listing-hint fallback events, never dropped)
        self.assertGreaterEqual(len(events), 41)
        self.assertIsNotNone(report)
        real = [e for e in events if e.sourceEventId == "ht-payathon-2026" and e.rawData.get("detailFetched")]
        self.assertEqual(len(real), 1)
        # stop reason: the single-URL listing repeats on page 2
        self.assertIn(report.stopReason, ("no_next_page", "repeated_listing_url"))

    def test_source_blocked_stops_with_report(self):
        # A wall (403/captcha) is a STOP, not a raise: BaseCrawler.discover
        # catches SourceUnavailable and records report.stopReason="blocked".
        from pipeline.search.fetcher import REASON_BLOCKED

        class BlockedFetcher:
            def __init__(self, *a, **k):
                pass

            def fetch(self, url):
                r = type("R", (), {})()
                r.ok = False
                r.reason = REASON_BLOCKED
                r.detail = "anti-bot"
                r.status = 403
                r.finalUrl = url
                r.html = None
                return r

        crawler = HackerTripCrawler(settings=None, fetcher=BlockedFetcher())
        events, report = crawler.crawl()
        self.assertEqual(report.stopReason, "blocked")
        self.assertEqual(events, [])
        self.assertTrue(any(f.get("reason") == "blocked" for f in report.failures))


if __name__ == "__main__":
    unittest.main()
