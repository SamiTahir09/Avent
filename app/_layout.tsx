// Polyfill setImmediate for web compatibility (e.g., for react-native-swiper)
if (typeof setImmediate === "undefined") {
  const setImmediatePolyfill = (fn: (...args: any[]) => void, ...args: any[]) => setTimeout(fn, 0, ...args);
  const clearImmediatePolyfill = (id: any) => clearTimeout(id);
  if (typeof window !== "undefined") {
    (window as any).setImmediate = setImmediatePolyfill;
    (window as any).clearImmediate = clearImmediatePolyfill;
  }
  if (typeof global !== "undefined") {
    (global as any).setImmediate = setImmediatePolyfill;
    (global as any).clearImmediate = clearImmediatePolyfill;
  }
}

import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import "react-native-reanimated";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";
import "react-native-get-random-values";
import { CreateTripContext } from "@/context/CreateTripContext";
// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [tripData, setTripData] = useState<any[]>([]);

  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    outfit: require("@/assets/fonts/Outfit-Regular.ttf"),
    "outfit-medium": require("@/assets/fonts/Outfit-Medium.ttf"),
    "outfit-bold": require("@/assets/fonts/Outfit-Bold.ttf"),
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <SafeAreaProvider>
      <CreateTripContext.Provider value={{ tripData, setTripData }}>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="create-trip" />
          <Stack.Screen name="generate-trip" />
          <Stack.Screen name="weather-details" />
          <Stack.Screen name="weather-outfit" />
          <Stack.Screen name="trip-details" />
        </Stack>
      </CreateTripContext.Provider>
    </SafeAreaProvider>
  );
}
