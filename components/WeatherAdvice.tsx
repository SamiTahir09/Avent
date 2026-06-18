import React, { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, ScrollView } from "react-native";
import WeatherService from "@/services/WeatherService";
import type { WeatherInfo } from "@/services/WeatherService";
import { analyzeWeatherForAdvice, type SevereAlert } from "@/services/TravelAdvice";

type Coords = {
    latitude?: number;
    longitude?: number;
    lat?: number;
    lng?: number;
} | null;

const WeatherAdvice = ({ coords, placeName, days = 3, weather: providedWeather }: { coords?: Coords; placeName?: string; days?: number; weather?: WeatherInfo | null }) => {
    const [loading, setLoading] = useState(false);
    const [weather, setWeather] = useState<WeatherInfo | null>(providedWeather || null);
    const [advice, setAdvice] = useState<string[] | null>(null);
    const [severe, setSevere] = useState<SevereAlert | undefined>(undefined);

    useEffect(() => {
        if (providedWeather) {
            setWeather(providedWeather);
            const res = analyzeWeatherForAdvice(providedWeather);
            setAdvice(res.advice);
            setSevere(res.severeAlert);
            return;
        }

        if (!coords) return;
        const lat = coords.latitude ?? (coords as any).lat;
        const lon = coords.longitude ?? (coords as any).lng;
        if (typeof lat !== "number" || typeof lon !== "number") return;

        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const w = await WeatherService.getWeatherByCoords(Number(lat), Number(lon), days);
                if (cancelled) return;
                setWeather(w);
                const res = analyzeWeatherForAdvice(w);
                setAdvice(res.advice);
                setSevere(res.severeAlert);
            } catch (e) {
                console.error("WeatherAdvice fetch error", e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [coords, days, providedWeather]);

    if (!coords && !weather) return null;

    return (
        <View className="mb-4">
            {loading ? (
                <View className="bg-white p-3 rounded-xl mb-3 border border-gray-100 items-center">
                    <ActivityIndicator />
                    <Text className="text-gray-500 mt-2">Checking weather for recommendations...</Text>
                </View>
            ) : null}

            {severe ? (
                <View className={`p-3 rounded-xl mb-3 ${severe.severity === "danger" ? "bg-red-50 border border-red-200" : "bg-yellow-50 border border-yellow-200"}`}>
                    <Text className={`font-outfit-bold ${severe.severity === "danger" ? "text-red-800" : "text-yellow-800"}`}>{severe.title}</Text>
                    <Text className="text-sm text-gray-700 mt-1">{severe.message}</Text>
                </View>
            ) : null}

            {advice && advice.length ? (
                <View className="bg-white p-4 rounded-xl border border-gray-100">
                    <Text className="text-lg font-outfit-bold mb-2">Travel Advice</Text>
                    <View>
                        {advice.map((a, i) => (
                            <View key={i} className="flex-row items-start mb-2">
                                <Text className="text-xl mr-3">•</Text>
                                <Text className="flex-1 text-gray-700">{a}</Text>
                            </View>
                        ))}
                        {placeName ? (
                            <Text className="text-xs text-gray-400 mt-2">Tips tailored for {placeName}.</Text>
                        ) : null}
                    </View>
                </View>
            ) : null}
        </View>
    );
};

export default WeatherAdvice;
