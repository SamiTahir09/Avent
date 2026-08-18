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
import { AppState, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";
import "react-native-get-random-values";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateTripContext } from "@/context/CreateTripContext";
import { startOfflineSyncListener } from "@/services/OfflineSync";
import { initTelemetry } from "@/services/telemetry";
import { assertBypassSafety } from "@/services/billing/localEntitlement";
import { maybeAutoBackup } from "@/services/backup/autoBackup";
import { BillingProvider } from "@/hooks/useBilling";
// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

// One shared client for the app's one-shot server calls (currently just the
// consumeFreeTrip/verifyPurchase Cloud Functions) — entitlement state itself
// stays on Zustand + a Firestore onSnapshot listener (see hooks/useBilling.ts),
// since that's push-based and doesn't need React Query's fetch/cache model.
const queryClient = new QueryClient();

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

  // Runs before anything else so the global error handlers are installed while
  // the rest of startup is still happening — an exception thrown during font
  // loading or the first SQLite open would otherwise go unreported.
  useEffect(() => {
    // Warns on every launch while the billing bypass is on. Here as well as in
    // useBilling so it fires even if you never sign in.
    assertBypassSafety();
    void initTelemetry();
  }, []);

  // Drains the queued analytics events whenever connectivity returns. This runs
  // in demo mode too: demo builds are exactly where you want crash and funnel
  // data from testers.
  useEffect(() => {
    const unsubscribe = startOfflineSyncListener();
    return unsubscribe;
  }, []);

  // Daily Drive backup. maybeAutoBackup() decides whether to do anything
  // (connected, >24h since the last one, unmetered network) and never throws,
  // so it is safe to fire from a lifecycle callback.
  //
  // Backgrounding is the best moment to trigger it: the user has stopped editing,
  // so the snapshot is complete, and the upload doesn't compete with the UI. The
  // launch call is the fallback for a device that is only ever force-quit.
  useEffect(() => {
    void maybeAutoBackup("app_launch");

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        void maybeAutoBackup("app_background");
      }
    });

    return () => subscription.remove();
  }, []);

  if (!loaded) {
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <BillingProvider>
          <CreateTripContext.Provider value={{ tripData, setTripData }}>
            <StatusBar style="dark" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="create-trip" />
              <Stack.Screen name="generate-trip" />
              <Stack.Screen name="weather-details" />
              <Stack.Screen name="weather-week" />
              <Stack.Screen name="weather-outfit" />
              <Stack.Screen name="location-details" />
              <Stack.Screen name="trip-details" />
              <Stack.Screen name="premium" options={{ presentation: "modal" }} />
              <Stack.Screen name="backup" />
              <Stack.Screen name="change-password" />
              <Stack.Screen name="diagnostics" />
            </Stack>
          </CreateTripContext.Provider>
        </BillingProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
