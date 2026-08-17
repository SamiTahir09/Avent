import { View, Text, Image, TouchableOpacity } from "react-native";
import React, { useContext, useEffect, useRef, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";
import { CreateTripContext } from "@/context/CreateTripContext";
import { AI_PROMPT } from "@/constants/Options";
import { chatSession } from "@/config/GeminiConfig";
import { useRouter } from "expo-router";
import { auth } from "@/config/FirebaseConfig";
import { generateTripId, saveTrip } from "@/services/db/trips";
import { AnalyticsEvent, analytics, crash } from "@/services/telemetry";
import { consumeFreeTrip, refundFreeTrip } from "@/utils/purchaseVerification";
import { usePremiumStore } from "@/store/premiumStore";

type GenerationStep = "prompting" | "enriching" | "saving";

const STEP_LABELS: Record<GenerationStep, string> = {
  prompting: "Asking AI to build your itinerary...",
  enriching: "Fetching photos and locations...",
  saving: "Saving your trip...",
};

const firstWord = (name: unknown): string =>
  typeof name === "string" && name.trim() ? name.split(",")[0].trim() : "";

const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";

// Fetch a single photo from Unsplash for a given search query
const fetchUnsplashImage = async (query: string): Promise<string> => {
  if (!UNSPLASH_KEY) return "";
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
    );
    if (!res.ok) return "";
    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) return "";
    const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
    return pick?.urls?.regular || pick?.urls?.small || "";
  } catch {
    return "";
  }
};

const GenerateTrip = () => {
  const { tripData } = useContext(CreateTripContext);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<GenerationStep>("prompting");
  const [error, setError] = useState<string | null>(null);
  const [paywallBlocked, setPaywallBlocked] = useState(false);
  const user = auth.currentUser;

  const router = useRouter();
  const consumeFreeTripMutation = useMutation({ mutationFn: consumeFreeTrip });
  const entitlementLoaded = usePremiumStore((s) => s.entitlementLoaded);
  const startedRef = useRef(false);
  const [waitingForEntitlement, setWaitingForEntitlement] = useState(
    !usePremiumStore.getState().entitlementLoaded
  );

  // Waits for the entitlement to resolve before consuming anything. On a cold
  // start (or a deep link straight into this screen) `premium` is still false
  // for a moment, so firing immediately would charge a paying user a free-trip
  // credit — and, at the limit, show them the paywall.
  //
  // The ref makes this run exactly once: entitlementLoaded can flip more than
  // once (sign-out/sign-in, a second snapshot), and each flip would otherwise
  // kick off another Gemini call.
  useEffect(() => {
    if (startedRef.current) return;

    if (entitlementLoaded) {
      startedRef.current = true;
      setWaitingForEntitlement(false);
      generateTrip();
      return;
    }

    // Fallback so the screen can't spin forever if the entitlement never
    // resolves (no network and no cached value, or a signed-out deep link).
    // consumeFreeTrip is authoritative anyway and will reject if there's no user.
    const timeout = setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      setWaitingForEntitlement(false);
      generateTrip();
    }, 6000);
    return () => clearTimeout(timeout);
  }, [entitlementLoaded]);

  const generateTrip = async () => {
    setLoading(true);
    setError(null);
    setPaywallBlocked(false);
    setStep("prompting");

    // Server-authoritative entitlement check — must run before the Gemini
    // call (which costs money) rather than trusting a client-side store
    // read, since a deep-link straight into this screen would otherwise
    // bypass the gates in StartNewTripCard / mytrip.tsx's "+" button.
    try {
      const { allowed } = await consumeFreeTripMutation.mutateAsync();
      if (!allowed) {
        setLoading(false);
        setPaywallBlocked(true);
        return;
      }
    } catch (err) {
      console.error("Free trip check failed:", err);
      await crash.recordError(err, {
        screen: "generate-trip",
        action: "consumeFreeTrip",
      });
      void analytics.logEvent(AnalyticsEvent.TRIP_GENERATE_FAILED, {
        reason: "entitlement_check_failed",
      });
      setLoading(false);
      setError("Couldn't verify your account. Please check your connection and try again.");
      return;
    }

    const locationInfo = tripData.find(
      (item): item is { locationInfo: TripLocationInfo } => "locationInfo" in item
    )?.locationInfo;
    const travelers = tripData.find(
      (item): item is { travelers: TripTravelers } => "travelers" in item
    )?.travelers;
    const dates = tripData.find(
      (item): item is { dates: TripDates } => "dates" in item
    )?.dates;
    const budget = tripData.find(
      (item): item is { budget: TripBudget } => "budget" in item
    )?.budget;

    const totalDays = dates?.totalNumberOfDays || 0;
    const totalNights = totalDays > 0 ? totalDays - 1 : 0;

    const FINAL_PROMPT = AI_PROMPT.replace(
      "{location}",
      locationInfo?.name || ""
    )
      .replace("{totalDays}", totalDays.toString())
      .replace("{totalNights}", totalNights.toString())
      .replace(
        "{travelers}",
        `${travelers?.type || ""} (${travelers?.count || 0})`
      )
      .replace("{budget}", budget?.type || "");

    void analytics.logEvent(AnalyticsEvent.TRIP_GENERATE_START, {
      total_days: totalDays,
      budget: budget?.type ?? null,
      traveler_type: travelers?.type ?? null,
    });

    let tripResponse: any;
    const generateStartedAt = Date.now();
    try {
      const result = await chatSession.sendMessage(FINAL_PROMPT);
      tripResponse = JSON.parse(result.response.text());
      void analytics.logEvent(AnalyticsEvent.TRIP_GENERATE_SUCCESS, {
        duration_ms: Date.now() - generateStartedAt,
        total_days: totalDays,
      });
    } catch (err: any) {
      console.error("AI trip generation failed:", err);
      await crash.recordError(err, {
        screen: "generate-trip",
        action: "gemini_sendMessage",
      });
      void analytics.logEvent(AnalyticsEvent.TRIP_GENERATE_FAILED, {
        reason: "gemini_error",
        duration_ms: Date.now() - generateStartedAt,
      });
      // The free-trip credit was taken before this call, so give it back — two
      // transient Gemini errors would otherwise consume a user's whole free tier.
      await refundFreeTrip();
      setLoading(false);
      setError(
        err?.message?.includes("404") || err?.message?.includes("not found")
          ? "The AI model is unavailable right now. Please try again later."
          : "Couldn't generate your itinerary. Please check your connection and try again."
      );
      return;
    }

    setStep("enriching");

    // Enrich coordinates and images for the trip plan
    const finalTripData: any[] = [...tripData];
    try {
      const location = locationInfo?.name || tripResponse?.trip_plan?.location || "";
      const cityName = firstWord(location) || "the destination";
      
      let destLat = locationInfo?.coordinates?.lat || 28.6139;
      let destLng = locationInfo?.coordinates?.lng || 77.209;

      // Fetch main destination image from Unsplash
      const mainImageUrl = await fetchUnsplashImage(`${cityName} city travel destination`);
      if (mainImageUrl) {
        const locIdx = finalTripData.findIndex((item: any) => item.locationInfo);
        if (locIdx !== -1) {
          finalTripData[locIdx] = {
            ...finalTripData[locIdx],
            locationInfo: {
              ...finalTripData[locIdx].locationInfo,
              imageUrl: mainImageUrl
            }
          };
        }
      }

      if (tripResponse?.trip_plan?.hotel?.options) {
        const hotelOptions = tripResponse.trip_plan.hotel.options;
        // Fetch all hotel images in parallel
        const hotelImgPromises = hotelOptions.map((hotel: any) =>
          fetchUnsplashImage(`${firstWord(hotel.name) || cityName} hotel ${cityName}`)
        );
        const hotelImgs = await Promise.all(hotelImgPromises);
        for (let i = 0; i < hotelOptions.length; i++) {
          const hotel = hotelOptions[i];
          if (!hotel.name) hotel.name = `${cityName} Hotel ${i + 1}`;
          hotel.geo_coordinates = {
            latitude: destLat + (i === 0 ? 0.005 : i === 1 ? -0.005 : 0.008),
            longitude: destLng + (i === 0 ? 0.005 : i === 1 ? -0.005 : -0.008),
          };
          hotel.image_url = hotelImgs[i] ||
            (i === 0
              ? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800"
              : "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800");
        }
      }

      if (tripResponse?.trip_plan?.places_to_visit) {
        const places = tripResponse.trip_plan.places_to_visit;
        // Fetch all place images in parallel
        const placeImgPromises = places.map((place: any) =>
          fetchUnsplashImage(`${firstWord(place.name) || cityName} ${cityName} travel attraction`)
        );
        const placeImgs = await Promise.all(placeImgPromises);
        const fallbacks = [
          "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800",
          "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800",
          "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800",
        ];
        for (let i = 0; i < places.length; i++) {
          const place = places[i];
          if (!place.name) place.name = `${cityName} Attraction ${i + 1}`;
          place.geo_coordinates = {
            latitude: destLat + (i === 0 ? 0.002 : i === 1 ? -0.002 : i === 2 ? 0.004 : -0.004),
            longitude: destLng + (i === 0 ? -0.002 : i === 1 ? 0.002 : i === 2 ? -0.004 : 0.004),
          };
          place.image_url = placeImgs[i] || fallbacks[i % fallbacks.length];
        }
      }
    } catch (e) {
      // Non-fatal: the itinerary is already usable, only images/coords are
      // missing, so this is recorded rather than surfaced to the user.
      console.error("Error resolving assets during trip generation:", e);
      await crash.recordError(e, {
        screen: "generate-trip",
        action: "enrich_assets",
      });
    }

    setStep("saving");

    const docId = generateTripId();

    const tripRecord: TripRecord = {
      userEmail: user?.email,
      tripPlan: tripResponse,
      tripData: JSON.stringify(finalTripData),
      docId: docId,
    };

    // One write path for every tier. Demo, free and premium trips all go to the
    // same SQLite table, so there's no online check, no Firestore write and no
    // "saved offline, will sync later" state to explain to the user — the local
    // database *is* the storage, not a cache in front of it.
    const isPremium = usePremiumStore.getState().premium;
    try {
      await saveTrip(tripRecord, {
        userUid: user?.uid ?? null,
        isFreeTrip: !isPremium,
      });
      void analytics.logEvent(AnalyticsEvent.TRIP_SAVED, {
        premium: isPremium,
        total_days: totalDays,
      });
    } catch (saveErr) {
      console.error("Error saving trip to SQLite:", saveErr);
      await crash.recordError(saveErr, {
        screen: "generate-trip",
        action: "saveTrip",
      });
      // The itinerary exists but couldn't be persisted, so the user got nothing
      // — refund the credit rather than charging them for a lost trip.
      await refundFreeTrip();
      setLoading(false);
      setError("Your itinerary was generated but couldn't be saved. Please try again.");
      return;
    }

    setLoading(false);
    router.replace("/(tabs)/mytrip");
  };

  if (paywallBlocked) {
    return (
      <SafeAreaView className="p-6 h-full flex flex-col items-center justify-center">
        <Text className="font-outfit-bold text-3xl text-center text-purple-700">
          You've used your free AI trip
        </Text>
        <Text className="font-outfit-medium text-lg text-center mt-4 text-gray-600">
          Upgrade to Premium to generate unlimited trips and unlock all premium features.
        </Text>

        <TouchableOpacity
          onPress={() => router.replace("/premium")}
          className="bg-purple-600 rounded-full px-8 py-4 mt-10"
        >
          <Text className="font-outfit-bold text-white text-lg">View Plans</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace("/(tabs)/mytrip")}
          className="mt-4 px-8 py-3"
        >
          <Text className="font-outfit-medium text-gray-500 text-base">
            Go Back
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView className="p-6 h-full flex flex-col items-center justify-center">
        <Text className="font-outfit-bold text-3xl text-center text-red-500">
          Something went wrong
        </Text>
        <Text className="font-outfit-medium text-lg text-center mt-4 text-gray-600">
          {error}
        </Text>

        <TouchableOpacity
          onPress={generateTrip}
          className="bg-purple-600 rounded-full px-8 py-4 mt-10"
        >
          <Text className="font-outfit-bold text-white text-lg">Try Again</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.replace("/(tabs)/mytrip")}
          className="mt-4 px-8 py-3"
        >
          <Text className="font-outfit-medium text-gray-500 text-base">
            Go Back
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="p-6 h-full flex flex-col items-center justify-center">
      <Text className="font-outfit-bold text-3xl text-center">
        Please Wait...
      </Text>
      <Text className="font-outfit-medium text-xl text-center mt-10">
        {waitingForEntitlement
          ? "Checking your subscription..."
          : STEP_LABELS[step]}
      </Text>

      <Image
        source={require("@/assets/images/loading.gif")}
        className="w-96 h-96"
      />

      <Text className="font-outfit text-gray-700 text-center mt-10">
        This might take a while, please do not go back.
      </Text>
    </SafeAreaView>
  );
};

export default GenerateTrip;
