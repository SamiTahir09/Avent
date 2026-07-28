import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { useFonts } from "expo-font";
import { Stack, usePathname } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useState } from "react";
import "react-native-reanimated";
import { useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "../global.css";
import "react-native-get-random-values";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CreateTripContext } from "@/context/CreateTripContext";
import { BillingProvider } from "@/hooks/useBilling";
import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { initCrashlytics, setCrashlyticsUser } from "@/services/Crashlytics";
import { initAnalytics, setAnalyticsUser, logScreenView } from "@/services/Analytics";
import { ErrorBoundary } from "@/components/ErrorBoundary";
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
  const pathname = usePathname();
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

  // Crashlytics/Analytics are native RNFirebase modules — independent of the
  // JS-SDK demo-mode stub in config/FirebaseConfig.ts — so they're always
  // initialized, on every build (collection itself is disabled in __DEV__).
  useEffect(() => {
    initCrashlytics();
    initAnalytics();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: any) => {
      setCrashlyticsUser(user?.uid ?? null);
      setAnalyticsUser(user?.uid ?? null);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (pathname) logScreenView(pathname);
  }, [pathname]);

  if (!loaded) {
    return null;
  }

  return (
    <ErrorBoundary>
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
              </Stack>
            </CreateTripContext.Provider>
          </BillingProvider>
        </SafeAreaProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
