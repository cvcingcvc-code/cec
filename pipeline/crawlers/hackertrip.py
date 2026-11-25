# HackerTrip crawler (V2.5 — AUTO CRAWL V1).
#
# Entry points (read off the LIVE site 2026-10-23, not from memory):
#   * discovery listing: https://hackertrip.space/explore
#     -> JSON-LD ItemList (numberOfItems=41 at crawl time), one ListItem per
#        hackathon: { url, name }. No pagination: the list is complete on
#        one page (no ?page= params observed in its nav).
#   * detail pages: /hackathon/ht-*
#     -> schema.org Event JSON-LD: name / description / startDate / endDate /
#        eventStatus / eventAttendanceMode / location(Place) / organizer /
#        url / image. The visible dt/dd rows (报名截止/比赛时间/参赛形式/
#        奖金池/赛题主题/团队规模/地点说明) carry the hackathon-specific
#        facts the Event JSON-LD does not publish.
#
# Honesty rules (pipeline charter): every value below comes off the source's
# own JSON-LD or dt/dd rows. Where the source does not publish a fact the
# field stays null — the deadline is kept as the SOURCE'S OWN TEXT when no
# ISO date can be parsed from it (never reconstructed), and prize/
# eligibility/teamSize stay raw text for the review layer to normalize.

import json
import re
import urllib.parse

from pipeline.crawlers.base import BaseCrawler, canonical_url
from pipeline.crawlers.models import ListingEntry, ListingPage, RawEvent

_LIST_URL = "https://hackertrip.space/explore"

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")

# --- listing page -----------------------------------------------------------

_LD_SCRIPT_RE = re.compile(
    r'<script type="application/ld\+json">(.*?)</script>', re.S)

# --- detail page ------------------------------------------------------------

_DT_DD_RE = re.compile(r"<dt[^>]*>(.*?)</dt>\s*<dd[^>]*>(.*?)</dd>", re.S)

# Year-prefixing for the site's short deadline text ("12月1日 23:59"): the
# event endDate's year is the best available anchor. Never guessed beyond
# that — if the deadline is ambiguous the raw text is kept instead.
_MD_RE = re.compile(r"^(\d{1,2})月(\d{1,2})日\s+(\d{1,2}):(\d{2})$")

# Registration-closing verbs used to pick the deadline-ish dt rows.
_DEADLINE_LABELS = ("报名截止", "报名截止时间", "报名关闭")


def _text(fragment):
    """HTML fragment -> single-line text. Blank stays None."""
    if fragment is None:
        return None
    t = _TAG_RE.sub(" ", fragment)
    t = t.replace("&nbsp;", " ").replace("&amp;", "&")
    t = _WS_RE.sub(" ", t).strip()
    return t or None


def _json_ld_blocks(html):
    blocks = []
    for m in _LD_SCRIPT_RE.finditer(html or ""):
        try:
            blocks.append(json.loads(m.group(1)))
        except (ValueError, TypeError):
            continue  # malformed block: skip, never guess
    return blocks


def _graph_nodes(data):
    """Yield every dict node from a JSON-LD block (@graph-aware)."""
    if not isinstance(data, dict):
        return
    graph = data.get("@graph")
    if isinstance(graph, list):
        for node in graph:
            if isinstance(node, dict):
                yield node
    else:
        yield data


def _event_node(html):
    """-> the schema.org Event node of a detail page (or None)."""
    for data in _json_ld_blocks(html):
        for node in _graph_nodes(data):
            if node.get("@type") == "Event":
                return node
    return None


def _item_list(html):
    """-> the ItemList node of the explore page (or None)."""
    for data in _json_ld_blocks(html):
        for node in _graph_nodes(data):
            if node.get("@type") == "ItemList":
                return node
    return None


def _dt_dd_map(html):
    """-> {label: value_text} from the visible dt/dd rows."""
    out = {}
    for label_frag, val_frag in _DT_DD_RE.findall(html or ""):
        label = _text(label_frag)
        value = _text(val_frag)
        if label and value and label not in out:
            out[label] = value
    return out


def _deadline_iso_or_none(deadline_text, end_iso):
    """Best-effort ISO from the site's short deadline text.

    "12月1日 23:59" + the event endDate's year -> "YYYY-12-01T23:59:00+08:00"
    (the site is a China-facing product; +08:00 is its display timezone).
    Anything else (ranges, vague text) stays None — the raw text is already
    preserved in rawData.
    """
    if not deadline_text:
        return None
    m = _MD_RE.match(deadline_text.strip())
    if not m:
        return None
    month, day, hh, mm = (int(g) for g in m.groups())
    year = None
    if end_iso:
        try:
            year = int(str(end_iso)[:4])
        except (ValueError, TypeError):
            year = None
    if not year:
        return None
    try:
        return "%04d-%02d-%02dT%02d:%02d:00+08:00" % (year, month, day, hh, mm)
    except (ValueError, TypeError):
        return None


class HackerTripCrawler(BaseCrawler):
    """hackertrip.space/explore -> hackathon detail pages -> RawEvent."""

    name = "hackertrip"
    sourceName = "HackerTrip"

    def __init__(self, city=None, **kwargs):
        # city=None: the site is multi-city (上海/北京/线上/新加坡...) and each
        # detail page states its own 地点说明 — a hardcoded city would be a lie.
        kwargs["city"] = city
        super().__init__(**kwargs)

    # -- discovery ---------------------------------------------------------

    def listing_url(self, page):
        # One complete listing (JSON-LD ItemList), no pagination on the live
        # site: page > 1 would repeat the same URL, which the base loop turns
        # into STOP_REPEATED_LISTING after page 2 — so cap at page 1.
        return _LIST_URL

    def parse_listing(self, html, url):
        items = []
        lst = _item_list(html)
        if lst:
            for el in lst.get("itemListElement") or []:
                if not isinstance(el, dict):
                    continue
                link = el.get("url")
                name = _text(el.get("name"))
                if not link or not name:
                    continue
                items.append(ListingEntry(
                    title=name,
                    url=link,
                    startTime=None,   # the ItemList publishes no dates
                    endTime=None,
                    city=None,        # per-detail-page fact
                    district=None,
                    address=None,
                    price=None,
                    organizer=None,
                    sourceEventId=self._event_id(link),
                ))
        return ListingPage(entries=items, hasNext=False)

    # -- detail ------------------------------------------------------------

    def parse_detail(self, html, url, entry):
        event = _event_node(html)
        if event is None:
            return None  # no Event JSON-LD -> base falls back to listing hints
        facts = _dt_dd_map(html)

        deadline_text = next(
            (v for k, v in facts.items()
             if any(d in k for d in _DEADLINE_LABELS)),
            None,
        )
        deadline_iso = _deadline_iso_or_none(deadline_text,
                                             event.get("endDate"))

        location_name = None
        city = None
        loc = event.get("location")
        if isinstance(loc, dict):
            location_name = _text(loc.get("name"))
            addr = loc.get("address")
            if isinstance(addr, dict):
                city = _text(addr.get("addressLocality"))
        organizer = None
        org = event.get("organizer")
        if isinstance(org, dict):
            organizer = _text(org.get("name"))

        attendance = event.get("eventAttendanceMode") or None
        mode = None
        if attendance:
            if "Mixed" in str(attendance):
                mode = "线上 + 线下"
            elif "Online" in str(attendance):
                mode = "线上"
            elif "Offline" in str(attendance):
                mode = "线下"

        return RawEvent(
            title=_text(event.get("name")) or entry.title,
            startTime=event.get("startDate") or None,
            endTime=event.get("endDate") or None,
            city=city,
            district=None,
            venueName=None,
            address=location_name,
            price=next((v for k, v in facts.items() if "奖金" in k), None),
            organizer=organizer,
            sourceName=self.sourceName,
            sourceUrl=event.get("url") or entry.url,
            sourceEventId=entry.sourceEventId or self._event_id(entry.url),
            rawData={
                "listing": entry.to_dict(),
                "detailFetched": True,
                "deadlineText": deadline_text,   # source's own text, verbatim
                "registrationDeadline": deadline_iso,  # None when unparsable
                "registrationUrl": url,          # the detail page IS the entry
                "participationMode": mode,
                "eligibility": next((v for k, v in facts.items() if "人群" in k or "资格" in k), None),
                "teamSize": next((v for k, v in facts.items() if "团队" in k), None),
                "theme": next((v for k, v in facts.items() if "主题" in k), None),
                "fieldSources": {
                    "title": "json-ld",
                    "startTime": "json-ld",
                    "endTime": "json-ld",
                    "city": "json-ld",
                    "address": "json-ld",
                    "price": "dt-dd",
                    "deadline": "dt-dd" if deadline_text else None,
                },
            },
        )

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _event_id(url):
        """ht-... slug from a /hackathon/ht-xxx URL (stable dedupe id)."""
        if not url or not isinstance(url, str):
            return None
        try:
            path = urllib.parse.urlsplit(url.strip()).path
        except ValueError:
            return None
        seg = path.rstrip("/").rsplit("/", 1)[-1]
        return seg or None
