export type ForecastDay = {
  date: string;
  day: string;
  tempMaxC: number | null;
  tempMinC: number | null;
  tempAvgC: number | null;
  icon: string | null;
  chanceOfRain: number | null;
  windKph: number | null;
  raw: any;
};

export type WeatherInfo = {
  provider: "weatherapi";
  tempC: number;
  tempF: number;
  feelsLikeC: number;
  feelsLikeF: number;
  condition: string;
  icon: string | null;
  humidity: number;
  windKph: number;
  chanceOfRain: number | null;
  forecast?: ForecastDay[];
  forecastDays?: number;
  raw: any;
};

const WEATHERAPI_KEY = process.env.EXPO_PUBLIC_WEATHERAPI_KEY;

const fetchFromWeatherAPI = async (
  lat: number,
  lon: number,
  days = 7
): Promise<WeatherInfo> => {
  if (!WEATHERAPI_KEY) {
    throw new Error("Missing EXPO_PUBLIC_WEATHERAPI_KEY");
  }

  const d = Math.max(1, Math.min(days, 10));

  const url = `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${lat},${lon}&days=${d}&aqi=no&alerts=no`;

  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WeatherAPI error: ${res.status} ${text}`);
  }

  const json = await res.json();

  const current = json.current || {};
  const forecastDays = json.forecast?.forecastday || [];

  const tempC = current.temp_c;
  const tempF = current.temp_f;
  const feelsLikeC = current.feelslike_c;
  const feelsLikeF = current.feelslike_f;

  const forecast: ForecastDay[] = forecastDays.map((fd: any) => ({
    date: fd.date,
    day: fd.date,
    tempMaxC: fd.day?.maxtemp_c ?? null,
    tempMinC: fd.day?.mintemp_c ?? null,
    tempAvgC: fd.day?.avgtemp_c ?? null,
    icon: fd.day?.condition?.icon
      ? `https:${fd.day.condition.icon}`
      : null,
    chanceOfRain:
      fd.day?.daily_chance_of_rain != null
        ? Number(fd.day.daily_chance_of_rain)
        : null,
    windKph: fd.day?.maxwind_kph ?? null,
    raw: fd,
  }));

  return {
    provider: "weatherapi",
    tempC,
    tempF,
    feelsLikeC,
    feelsLikeF,
    condition: current.condition?.text || "",
    icon: current.condition?.icon
      ? `https:${current.condition.icon}`
      : null,
    humidity: current.humidity,
    windKph: current.wind_kph,
    chanceOfRain:
      forecastDays[0]?.day?.daily_chance_of_rain != null
        ? Number(forecastDays[0].day.daily_chance_of_rain)
        : null,
    forecast,
    forecastDays: forecast.length,
    raw: json,
  };
};

const getWeatherByCoords = async (
  lat: number,
  lon: number,
  days = 7
): Promise<WeatherInfo> => {
  return fetchFromWeatherAPI(lat, lon, days);
};

export default {
  getWeatherByCoords,
};