# V3J (P1 搜索图片) — contract tests for the crawl→pipeline image bridge.
#
# WHY: the douban crawler records the listing poster under
# rawData["listing"]["imageUrl"], but the flat RawEvent contract had no
# image field, so the bridge dropped it and every downstream stage
# (normalized -> approved -> generated-data.js) shipped imageUrl null —
# every search card fell back to the category placeholder.
#
# The fix (pipeline/bridge/crawl_to_raw.py::convert_event) promotes the
# listing URL VERBATIM with imageSource "listing-thumbnail" and imageType
# "remote". Pinned here:
#   * records WITH a listing URL get it verbatim (no rewriting)
#   * records WITHOUT one keep imageUrl/imageSource/imageType None
#     (no invented URL, no fake placeholder in the data layer)
# Both behaviours were verified to FAIL against the pre-fix module
# (probe on the stashed pre-fix code: 0/40 raw records carried imageUrl).

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from pipeline.bridge.crawl_to_raw import _listing_image_url, convert_event


class ListingImageUrlTests(unittest.TestCase):
    def test_listing_url_extracted_verbatim(self):
        ev = {"rawData": {"listing": {"imageUrl": "  https://img9.doubanio.com/p.jpg  "}}}
        self.assertEqual(_listing_image_url(ev), "https://img9.doubanio.com/p.jpg")

    def test_missing_listing_keeps_none(self):
        self.assertIsNone(_listing_image_url({}))
        self.assertIsNone(_listing_image_url({"rawData": {}}))
        self.assertIsNone(_listing_image_url({"rawData": {"listing": {}}}))

    def test_blank_url_keeps_none(self):
        ev = {"rawData": {"listing": {"imageUrl": "   "}}}
        self.assertIsNone(_listing_image_url(ev))

    def test_non_string_url_keeps_none(self):
        ev = {"rawData": {"listing": {"imageUrl": 123}}}
        self.assertIsNone(_listing_image_url(ev))


class ConvertEventImageTests(unittest.TestCase):
    EV = {
        "title": "悠游海盐",
        "startTime": "2026-10-18T14:00:00",
        "endTime": "2026-10-18T17:00:00",
        "venueName": "沈荡老街",
        "sourceName": "douban",
        "sourceUrl": "https://www.douban.com/event/36988401/",
        "sourceEventId": "36988401",
    }

    def test_listing_poster_promoted_verbatim(self):
        ev = dict(self.EV, rawData={
            "listing": {"imageUrl": "https://img9.doubanio.com/pview/event_poster/median/public/1669da789e53564.jpg"},
        })
        act = convert_event(ev, "2026-10-14T12:00:00+08:00")
        self.assertEqual(
            act["imageUrl"],
            "https://img9.doubanio.com/pview/event_poster/median/public/1669da789e53564.jpg",
        )
        self.assertEqual(act["imageSource"], "listing-thumbnail")
        self.assertEqual(act["imageType"], "remote")

    def test_no_listing_poster_keeps_all_none(self):
        ev = dict(self.EV, sourceEventId="1", rawData={"listing": {}})
        act = convert_event(ev)
        self.assertIsNone(act["imageUrl"])
        self.assertIsNone(act["imageSource"])
        self.assertIsNone(act["imageType"])

    def test_no_rawdata_keeps_all_none(self):
        ev = dict(self.EV, sourceEventId="2")
        act = convert_event(ev)
        self.assertIsNone(act["imageUrl"])
        self.assertIsNone(act["imageSource"])
        self.assertIsNone(act["imageType"])

    def test_split_still_lossless_alongside_image(self):
        ev = dict(self.EV, rawData={
            "listing": {"imageUrl": "https://img1.doubanio.com/x.jpg"},
        })
        act = convert_event(ev)
        self.assertEqual(act["startDate"], "2026-10-18")
        self.assertEqual(act["startTime"], "14:00")
        self.assertEqual(act["venue"], "沈荡老街")
        self.assertEqual(act["id"], "douban_36988401")


if __name__ == "__main__":
    unittest.main()
