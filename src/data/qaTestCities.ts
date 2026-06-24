// Preset city centres for the QA-only "browse area" override on the job board
// (BrowseJobsView). Lets a QA tester re-centre the feed on a known city without
// editing their saved service area. QA-only — never shown to real tradespeople.
// Coordinates are city-hall-ish centroids; precision beyond ~city level doesn't
// matter since the feed is geohash-radius based.

export interface QaTestCity {
  key: string;
  label: string;
  lat: number;
  lng: number;
}

export const QA_TEST_CITIES: QaTestCity[] = [
  { key: "toronto", label: "Toronto, ON", lat: 43.6532, lng: -79.3832 },
  { key: "ottawa", label: "Ottawa, ON", lat: 45.4215, lng: -75.6972 },
  { key: "montreal", label: "Montreal, QC", lat: 45.5019, lng: -73.5674 },
  { key: "quebec-city", label: "Quebec City, QC", lat: 46.8139, lng: -71.208 },
  { key: "vancouver", label: "Vancouver, BC", lat: 49.2827, lng: -123.1207 },
  { key: "victoria", label: "Victoria, BC", lat: 48.4284, lng: -123.3656 },
  { key: "calgary", label: "Calgary, AB", lat: 51.0447, lng: -114.0719 },
  { key: "edmonton", label: "Edmonton, AB", lat: 53.5461, lng: -113.4938 },
  { key: "winnipeg", label: "Winnipeg, MB", lat: 49.8951, lng: -97.1384 },
  { key: "saskatoon", label: "Saskatoon, SK", lat: 52.1332, lng: -106.67 },
  { key: "regina", label: "Regina, SK", lat: 50.4452, lng: -104.6189 },
  { key: "halifax", label: "Halifax, NS", lat: 44.6488, lng: -63.5752 },
  { key: "moncton", label: "Moncton, NB", lat: 46.0878, lng: -64.7782 },
  { key: "st-johns", label: "St. John's, NL", lat: 47.5615, lng: -52.7126 },
];
