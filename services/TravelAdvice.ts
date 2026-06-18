import type { WeatherInfo } from "@/services/WeatherService";

export type SevereAlert = {
  severity: "warning" | "danger";
  type: string;
  title: string;
  message: string;
};

export const analyzeWeatherForAdvice = (w: WeatherInfo): { advice: string[]; severeAlert?: SevereAlert } => {
  const advice: string[] = [];
  if (!w) return { advice };

  const cond = (w.condition || "").toLowerCase();
  const rain = typeof w.chanceOfRain === "number" ? w.chanceOfRain : (w.forecast && w.forecast[0]?.chanceOfRain) ?? 0;
  const temp = typeof w.tempC === "number" && !Number.isNaN(w.tempC) ? w.tempC : undefined;
  const feels = typeof w.feelsLikeC === "number" && !Number.isNaN(w.feelsLikeC) ? w.feelsLikeC : temp;
  const wind = typeof w.windKph === "number" ? w.windKph : 0;

  // try to get UV index if provider provided it inside raw
  const uv = w.raw?.current?.uv ?? w.raw?.current?.uvi ?? null;

  // Severe detection
  let severe: SevereAlert | undefined;

  const isStorm = cond.includes("storm") || cond.includes("thunder") || cond.includes("hurricane") || cond.includes("tornado");
  const isSnow = cond.includes("snow") || (w.forecast || []).some(fd => (fd.raw && (String(fd.raw?.condition || "").toLowerCase().includes("snow"))) );
  const heavyRainForecast = (w.forecast || []).some(fd => (fd.chanceOfRain ?? 0) >= 90) || rain >= 90;
  const heatwaveForecast = (w.forecast || []).some(fd => (fd.tempMaxC ?? -273) >= 40) || (temp !== undefined && temp >= 40);
  const highWinds = wind >= 80 || (w.forecast || []).some(fd => (fd.windKph ?? 0) >= 80);

  if (isStorm) {
    severe = { severity: "danger", type: "storm", title: "Severe storm expected", message: "Thunderstorms or severe storms are forecast — consider changing plans or taking precautions." };
  } else if (isSnow) {
    severe = { severity: "danger", type: "snow", title: "Snow expected", message: "Snow or icy conditions may affect travel — check local advisories." };
  } else if (heavyRainForecast) {
    severe = { severity: "danger", type: "heavy-rain", title: "Heavy rain expected", message: "Periods of heavy rain are forecast — expect flooding or travel disruption." };
  } else if (heatwaveForecast) {
    severe = { severity: "danger", type: "heatwave", title: "Heatwave warning", message: "Extreme heat is forecast — stay hydrated and avoid prolonged sun exposure." };
  } else if (highWinds) {
    severe = { severity: "warning", type: "wind", title: "Strong winds expected", message: "Windy conditions may affect outdoor plans — secure loose items." };
  }

  // Advice rules (examples requested)
  if (rain >= 50 || cond.includes("rain") || cond.includes("drizzle") || cond.includes("shower")) {
    advice.push("Carry an umbrella because rain is expected.");
  }

  // Sunscreen: prefer UV when available, otherwise infer from sunny & warm
  if ((typeof uv === "number" && uv >= 6) || (temp !== undefined && temp >= 25 && (cond.includes("sun") || cond.includes("clear") || cond.includes("hot")))) {
    advice.push("Wear sunscreen due to sunny conditions or high UV index.");
  }

  // Light jacket for cool evenings
  const minForecast = (w.forecast || []).reduce<number | undefined>((acc, fd) => {
    if (fd.tempMinC === null || typeof fd.tempMinC !== "number") return acc;
    if (acc === undefined) return fd.tempMinC;
    return Math.min(acc, fd.tempMinC);
  }, undefined);
  const nightCold = (feels !== undefined && feels <= 15) || (minForecast !== undefined && minForecast <= 15);
  if (nightCold) {
    advice.push("Pack a light jacket because evenings will be cold.");
  }

  // Comfortable shoes
  advice.push("Comfortable walking shoes are recommended.");

  // Windy
  if ((wind ?? 0) > 40 || (w.forecast || []).some(fd => (fd.windKph ?? 0) > 40)) {
    advice.push("Expect windy conditions — bring a windbreaker or secure hats.");
  }

  // Heat guidance
  if ((temp ?? -273) >= 35) {
    advice.push("Stay hydrated and avoid prolonged midday sun exposure.");
  }

  // Deduplicate and keep sensible order (preserve first occurrences)
  const unique = Array.from(new Set(advice));

  return { advice: unique.slice(0, 6), severeAlert: severe };
};

export default {
  analyzeWeatherForAdvice,
};
