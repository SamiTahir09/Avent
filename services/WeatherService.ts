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
  provider: "weatherapi" | "openweather";
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
const OPENWEATHER_KEY = process.env.EXPO_PUBLIC_OPENWEATHER_KEY;

const fetchFromWeatherAPI = async (lat: number, lon: number, days = 7): Promise<WeatherInfo> => {
  if (!WEATHERAPI_KEY) throw new Error("Missing EXPO_PUBLIC_WEATHERAPI_KEY");
  const d = Math.max(1, Math.min(days, 10));
  const url = `https://api.weatherapi.com/v1/forecast.json?key=${WEATHERAPI_KEY}&q=${lat},${lon}&days=${d}&aqi=no&alerts=no`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WeatherAPI.com error: ${res.status} ${text}`);
  }
  const json = await res.json();
  const current = json.current || {};
  const forecastDays = Array.isArray(json.forecast?.forecastday) ? json.forecast.forecastday : [];

  const tempC = typeof current.temp_c === "number" ? current.temp_c : Number(current.temp);
  const tempF = typeof current.temp_f === "number" ? current.temp_f : Number((tempC * 9) / 5 + 32);
  const feelsLikeC = typeof current.feelslike_c === "number" ? current.feelslike_c : Number(current.feelslike_c || current.feels_like || tempC);
  const feelsLikeF = Number((feelsLikeC * 9) / 5 + 32);

  const forecast: ForecastDay[] = forecastDays.map((fd: any) => ({
    date: fd.date,
    day: fd.date,
    tempMaxC: typeof fd.day?.maxtemp_c === 'number' ? fd.day.maxtemp_c : null,
    tempMinC: typeof fd.day?.mintemp_c === 'number' ? fd.day.mintemp_c : null,
    tempAvgC: typeof fd.day?.avgtemp_c === 'number' ? fd.day.avgtemp_c : null,
    icon: fd.day?.condition?.icon ? `https:${fd.day.condition.icon}` : null,
    chanceOfRain: typeof fd.day?.daily_chance_of_rain === 'number' ? Number(fd.day.daily_chance_of_rain) : null,
    windKph: typeof fd.day?.maxwind_kph === 'number' ? fd.day.maxwind_kph : null,
    raw: fd,
  }));

  return {
    provider: "weatherapi",
    tempC: Number.isFinite(tempC) ? tempC : NaN,
    tempF: Number.isFinite(tempF) ? tempF : NaN,
    feelsLikeC: Number.isFinite(feelsLikeC) ? feelsLikeC : NaN,
    feelsLikeF: Number.isFinite(feelsLikeF) ? feelsLikeF : NaN,
    condition: (current.condition && current.condition.text) || "",
    icon: current.condition?.icon ? `https:${current.condition.icon}` : null,
    humidity: typeof current.humidity === "number" ? current.humidity : Number(current.humidity || 0),
    windKph: typeof current.wind_kph === "number" ? current.wind_kph : Number(current.wind_kph || 0),
    chanceOfRain: typeof forecastDays[0]?.day?.daily_chance_of_rain === "number" ? Number(forecastDays[0].day.daily_chance_of_rain) : null,
    forecast,
    forecastDays: forecast.length,
    raw: json,
  };
};

const fetchFromOpenWeather = async (lat: number, lon: number, days = 7): Promise<WeatherInfo> => {
  if (!OPENWEATHER_KEY) throw new Error("Missing EXPO_PUBLIC_OPENWEATHER_KEY");
  const url = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&exclude=minutely,alerts&units=metric&appid=${OPENWEATHER_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenWeather error: ${res.status} ${text}`);
  }
  const json = await res.json();
  const current = json.current || {};
  const daily0 = json.daily?.[0] || null;
  const weather0 = Array.isArray(current.weather) && current.weather[0] ? current.weather[0] : null;

  const tempC = typeof current.temp === "number" ? current.temp : NaN;
  const tempF = Number.isFinite(tempC) ? tempC * 9 / 5 + 32 : NaN;
  const feelsLikeC = typeof current.feels_like === "number" ? current.feels_like : NaN;
  const feelsLikeF = Number.isFinite(feelsLikeC) ? feelsLikeC * 9 / 5 + 32 : NaN;

  const daysToTake = Math.max(1, Math.min(days, Array.isArray(json.daily) ? json.daily.length : 7));
  const forecast: ForecastDay[] = (json.daily || []).slice(0, daysToTake).map((d: any) => ({
    date: new Date((d.dt || 0) * 1000).toISOString(),
    day: new Date((d.dt || 0) * 1000).toISOString(),
    tempMaxC: typeof d.temp?.max === 'number' ? d.temp.max : null,
    tempMinC: typeof d.temp?.min === 'number' ? d.temp.min : null,
    tempAvgC: typeof d.temp?.day === 'number' ? d.temp.day : null,
    icon: Array.isArray(d.weather) && d.weather[0] ? `https://openweathermap.org/img/wn/${d.weather[0].icon}@2x.png` : null,
    chanceOfRain: typeof d.pop === 'number' ? Math.round(d.pop * 100) : null,
    windKph: typeof d.wind_speed === 'number' ? d.wind_speed * 3.6 : null,
    raw: d,
  }));

  const chance = daily0 && typeof daily0.pop === "number" ? Math.round(daily0.pop * 100) : (json.hourly && json.hourly[0] && typeof json.hourly[0].pop === "number" ? Math.round(json.hourly[0].pop * 100) : null);

  return {
    provider: "openweather",
    tempC: Number.isFinite(tempC) ? tempC : NaN,
    tempF: Number.isFinite(tempF) ? tempF : NaN,
    feelsLikeC: Number.isFinite(feelsLikeC) ? feelsLikeC : NaN,
    feelsLikeF: Number.isFinite(feelsLikeF) ? feelsLikeF : NaN,
    condition: weather0?.description || "",
    icon: weather0?.icon ? `https://openweathermap.org/img/wn/${weather0.icon}@2x.png` : null,
    humidity: typeof current.humidity === "number" ? current.humidity : 0,
    windKph: typeof current.wind_speed === "number" ? current.wind_speed * 3.6 : 0,
    chanceOfRain: chance,
    forecast,
    forecastDays: forecast.length,
    raw: json,
  };
};

const getWeatherByCoords = async (lat: number, lon: number, days = 7): Promise<WeatherInfo> => {
  // Prefer WeatherAPI if key is present, otherwise fallback to OpenWeather
  if (WEATHERAPI_KEY) {
    try {
      return await fetchFromWeatherAPI(lat, lon, days);
    } catch (err) {
      // fallthrough to openweather if available
      if (!OPENWEATHER_KEY) throw err as Error;
    }
  }

  if (OPENWEATHER_KEY) {
    return await fetchFromOpenWeather(lat, lon, days);
  }

  throw new Error("No weather provider configured. Set EXPO_PUBLIC_WEATHERAPI_KEY or EXPO_PUBLIC_OPENWEATHER_KEY.");
};

export default {
  getWeatherByCoords,
};
