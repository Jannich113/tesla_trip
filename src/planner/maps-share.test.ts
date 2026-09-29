import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAP_SHARE_NAMES_ERROR,
  MAP_SHARE_PARSE_ERROR,
  MAP_SHARE_SHORT_ERROR,
  appleDirectionsUrl,
  googleDirectionsUrl,
  parseMapShareUrl,
} from "./maps-share.ts";

const cph = { name: "Copenhagen", lat: 55.6761, lng: 12.5683 };
const ode = { name: "Odense", lat: 55.4038, lng: 10.4024 };
const aar = { name: "Aarhus", lat: 56.1629, lng: 10.2039 };

function coords(stops: { lat: number; lng: number }[]) {
  return stops.map((s) => [Number(s.lat.toFixed(6)), Number(s.lng.toFixed(6))]);
}

describe("maps share urls", () => {
  it("parses a Google directions URL with origin, waypoint, and destination", () => {
    const trip = parseMapShareUrl(
      "https://www.google.com/maps/dir/?api=1&origin=55.6761,12.5683&waypoints=55.4038,10.4024&destination=56.1629,10.2039&travelmode=driving",
    );
    assert.equal(trip.source, "google");
    assert.deepEqual(
      trip.stops.map((s) => [s.lat, s.lng]),
      [
        [55.6761, 12.5683],
        [55.4038, 10.4024],
        [56.1629, 10.2039],
      ],
    );
  });

  it("parses a Google /maps/dir path of coordinates", () => {
    const trip = parseMapShareUrl("https://www.google.com/maps/dir/55.6761,12.5683/55.4038,10.4024/56.1629,10.2039");
    assert.equal(trip.stops.length, 3);
    assert.equal(trip.stops[0].lat, 55.6761);
    assert.equal(trip.stops[2].lng, 10.2039);
  });

  it("zips place names with coordinates embedded in a Google dir link", () => {
    const trip = parseMapShareUrl(
      "https://www.google.com/maps/dir/Aarhus,+Denmark/Odense,+Denmark/Copenhagen,+Denmark/@56.1,10.5,8z/data=!4m2!1d10.2039!2d56.1629!1d10.4024!2d55.4038!1d12.5683!2d55.6761",
    );
    assert.deepEqual(
      trip.stops.map((s) => s.name),
      ["Aarhus", "Odense", "Copenhagen"],
    );
    assert.deepEqual(
      trip.stops.map((s) => [s.lat, s.lng]),
      [
        [56.1629, 10.2039],
        [55.4038, 10.4024],
        [55.6761, 12.5683],
      ],
    );
  });

  it("parses an Apple maps.apple.com directions URL with repeated stops", () => {
    const trip = parseMapShareUrl(
      "https://maps.apple.com/?saddr=55.6761,12.5683&daddr=55.4038,10.4024&daddr=56.1629,10.2039&dirflg=d",
    );
    assert.equal(trip.source, "apple");
    assert.equal(trip.stops.length, 3);
    assert.equal(trip.stops[1].lat, 55.4038);
    assert.equal(trip.stops[1].lng, 10.4024);
  });

  it("parses an Apple daddr chain joined with to:", () => {
    const trip = parseMapShareUrl(
      "https://maps.apple.com/?saddr=55.6761,12.5683&daddr=55.4038,10.4024+to:56.1629,10.2039&dirflg=d",
    );
    assert.deepEqual(
      trip.stops.map((s) => [s.lat, s.lng]),
      [
        [55.6761, 12.5683],
        [55.4038, 10.4024],
        [56.1629, 10.2039],
      ],
    );
  });

  it("round-trips a Google directions URL", () => {
    const url = googleDirectionsUrl([cph, ode, aar]);
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, "https://www.google.com/maps/dir/");
    assert.equal(parsed.searchParams.get("origin"), "55.6761,12.5683");
    assert.equal(parsed.searchParams.get("destination"), "56.1629,10.2039");
    assert.equal(parsed.searchParams.get("waypoints"), "55.4038,10.4024");
    assert.equal(parsed.searchParams.get("travelmode"), "driving");
    const back = parseMapShareUrl(url);
    assert.equal(back.source, "google");
    assert.deepEqual(coords(back.stops), coords([cph, ode, aar]));
  });

  it("round-trips an Apple maps.apple.com directions URL", () => {
    const url = appleDirectionsUrl([cph, ode, aar]);
    const parsed = new URL(url);
    assert.equal(parsed.hostname, "maps.apple.com");
    assert.equal(parsed.searchParams.get("saddr"), "55.6761,12.5683");
    assert.equal(parsed.searchParams.get("daddr"), "55.4038,10.4024 to:56.1629,10.2039");
    assert.equal(parsed.searchParams.get("dirflg"), "d");
    const back = parseMapShareUrl(url);
    assert.equal(back.source, "apple");
    assert.deepEqual(coords(back.stops), coords([cph, ode, aar]));
  });

  it("rejects a Google short link instead of fetching it", () => {
    assert.throws(() => parseMapShareUrl("https://maps.app.goo.gl/AbCdEfGh"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, MAP_SHARE_SHORT_ERROR);
      return true;
    });
  });

  it("rejects an Apple short link", () => {
    assert.throws(() => parseMapShareUrl("See https://maps.apple.com/p/abc123XYZ"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, MAP_SHARE_SHORT_ERROR);
      return true;
    });
  });

  it("rejects place names with no coordinates", () => {
    assert.throws(
      () =>
        parseMapShareUrl(
          "https://www.google.com/maps/dir/?api=1&origin=Aarhus&destination=Copenhagen&waypoints=Odense&travelmode=driving",
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, MAP_SHARE_NAMES_ERROR);
        return true;
      },
    );
  });

  it("rejects a link that is not a maps directions URL", () => {
    assert.throws(() => parseMapShareUrl("https://example.com/trip"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, MAP_SHARE_PARSE_ERROR);
      return true;
    });
    assert.throws(() => parseMapShareUrl("   "), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, MAP_SHARE_PARSE_ERROR);
      return true;
    });
  });

  it("refuses to build an export without an origin and destination", () => {
    assert.throws(() => googleDirectionsUrl([cph]), /origin and a destination/);
    assert.throws(() => appleDirectionsUrl([cph]), /origin and a destination/);
  });
});
