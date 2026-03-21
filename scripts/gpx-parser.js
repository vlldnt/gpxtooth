/* ════════════════════════════════════════════════
   GPXtooth — gpx-parser.js
   GPX parsing · Stats calculation · Utilities
   ════════════════════════════════════════════════ */

'use strict';

// ── GPX Parser ───────────────────────────────────
function parseGPX(xmlString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'application/xml');

  const ns = 'http://www.topografix.com/GPX/1/1';
  const nsHR = 'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';

  const name = doc.getElementsByTagName('name')[0]?.textContent ?? 'Trace GPS';
  const timeEl = doc.querySelector('metadata time');
  const date = timeEl ? new Date(timeEl.textContent) : null;

  const trkpts = doc.getElementsByTagName('trkpt');
  const points = [];

  for (const pt of trkpts) {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const ele = parseFloat(pt.getElementsByTagName('ele')[0]?.textContent ?? 0);
    const timeStr = pt.getElementsByTagName('time')[0]?.textContent ?? null;
    const t = timeStr ? new Date(timeStr) : null;

    // Heart rate from ns3:hr
    let hr = null;
    const hrEl =
      pt.getElementsByTagNameNS(nsHR, 'hr')[0] ??
      pt.getElementsByTagName('ns3:hr')[0] ??
      pt.querySelector('hr');
    if (hrEl) hr = parseInt(hrEl.textContent);

    if (!isNaN(lat) && !isNaN(lon)) {
      points.push({ lat, lon, ele, t, hr });
    }
  }

  return { name, date, points };
}

function parseActivityType(doc) {
  try {
    const typeEls = doc.getElementsByTagName('type');
    if (!typeEls || typeEls.length === 0) return 'other';

    const type = typeEls[0].textContent.toLowerCase().trim();
    if (
      type.includes('vtt') ||
      type.includes('mtb') ||
      type.includes('mountain')
    )
      return 'vtt';
    if (
      type.includes('running') ||
      type.includes('run') ||
      type.includes('course')
    )
      return 'running';
    if (
      type.includes('hiking') ||
      type.includes('hike') ||
      type.includes('rando')
    )
      return 'hiking';
    if (
      type.includes('cycling') ||
      type.includes('bike') ||
      type.includes('cycling')
    )
      return 'cycling';

    return 'other';
  } catch (e) {
    return 'other';
  }
}

// ── Stats calculator ─────────────────────────────
function calcStats(points) {
  if (points.length < 2) return null;

  let totalDist = 0;
  let elevUp = 0;
  let elevDown = 0;
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  const speeds = [];
  points[0]._cumDist = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];

    // Haversine distance (km)
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    totalDist += d;
    b._cumDist = totalDist;

    // Elevation
    const dElev = b.ele - a.ele;
    if (dElev > 0) elevUp += dElev;
    else elevDown += Math.abs(dElev);

    // Speed (km/h) if timestamps available
    if (a.t && b.t) {
      const dt = (b.t - a.t) / 3600000; // hours
      const spd = dt > 0 ? d / dt : 0;
      speeds.push(Math.min(spd, 60)); // cap outliers
      b._speed = Math.min(spd, 60);
    } else {
      speeds.push(0);
      b._speed = 0;
    }

    // HR
    if (b.hr) {
      hrSum += b.hr;
      hrCount++;
      if (b.hr > hrMax) hrMax = b.hr;
    }
  }
  points[0]._speed = speeds[0] ?? 0;

  // Duration
  const start = points.find((p) => p.t)?.t;
  const end = [...points].reverse().find((p) => p.t)?.t;
  const durationMs = start && end ? end - start : 0;

  const avgSpeed = durationMs > 0 ? totalDist / (durationMs / 3600000) : 0;

  return {
    dist: totalDist,
    elevUp,
    elevDown,
    durationMs,
    avgSpeed,
    hrAvg: hrCount > 0 ? Math.round(hrSum / hrCount) : null,
    hrMax: hrMax || null,
    hasHR: hrCount > 0,
  };
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Subsample array for chart performance ─────────
function subsample(arr, maxPoints = 400) {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0);
}
