// Pull 16-day forecast for Brooklyn from Open-Meteo.
// No API key, free, generous rate limits.

const BROOKLYN = { lat: 40.6782, lon: -73.9442 };

const WEATHER_CODE = {
  0: "Clear",
  1: "Mostly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Foggy",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Heavy showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorms",
  96: "Thunderstorms w/ hail",
  99: "Thunderstorms w/ hail",
};

export async function fetchWeather() {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", BROOKLYN.lat);
  url.searchParams.set("longitude", BROOKLYN.lon);
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code,sunset",
  );
  url.searchParams.set("temperature_unit", "celsius");
  url.searchParams.set("timezone", "America/New_York");
  url.searchParams.set("forecast_days", "16");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json();
  const d = data.daily;

  const days = {};
  for (let i = 0; i < d.time.length; i++) {
    const precip = d.precipitation_probability_max[i] ?? 0;
    const code = d.weather_code[i];
    const high = Math.round(d.temperature_2m_max[i]);
    const low = Math.round(d.temperature_2m_min[i]);
    days[d.time[i]] = {
      high,
      low,
      unit: "C",
      condition: WEATHER_CODE[code] || "—",
      precip_chance: precip,
      sunset: d.sunset[i].slice(11, 16),
      note: buildNote({ high, low, precip, code }),
    };
  }
  return days;
}

function buildNote({ high, low, precip, code }) {
  if (code >= 95) return "thunderstorms — stay in";
  if (code >= 71 && code <= 86) return "snow — bundle up";
  if (precip >= 60) return "indoor-leaning · pack a jacket";
  if (precip >= 30) return "evening could turn";
  if (high >= 29) return "shirtsleeves";
  if (high >= 24 && low >= 16) return "patio weather";
  if (high <= 5) return "cold — cozy room night";
  return "";
}

// CLI: `node scripts/weather.js` prints JSON
if (import.meta.url === `file://${process.argv[1]}`) {
  fetchWeather().then((d) => console.log(JSON.stringify(d, null, 2)));
}
