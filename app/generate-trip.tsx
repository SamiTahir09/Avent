import { View, Text, Image, TouchableOpacity, Alert } from "react-native";
import React, { useContext, useEffect, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { CreateTripContext } from "@/context/CreateTripContext";
import { AI_PROMPT } from "@/constants/Options";
import { chatSession } from "@/config/GeminiConfig";
import { useRouter } from "expo-router";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "@/config/FirebaseConfig";
import { isDemoMode } from "@/config/env";
import { demoSaveTrip } from "@/config/demoMode";
import { isOnline, queueTripForSync } from "@/services/OfflineSync";

const generateTripId = () =>
  `${Date.now().toString()}${Math.random().toString(36).slice(2, 8)}`;

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
  const user = auth.currentUser;

  const router = useRouter();

  useEffect(() => {
    generateTrip();
  }, []);

  const generateTrip = async () => {
    setLoading(true);
    setError(null);
    setStep("prompting");

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

    let tripResponse: any;
    try {
      const result = await chatSession.sendMessage(FINAL_PROMPT);
      tripResponse = JSON.parse(result.response.text());
    } catch (err: any) {
      console.error("AI trip generation failed:", err);
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
      
      if (isDemoMode() && (!locationInfo?.coordinates || locationInfo.coordinates.lat === 28.6139)) {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)}&format=json&limit=1`,
          { headers: { "User-Agent": "AventTravelApp/1.0" } }
        );
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData && geoData.length > 0) {
            destLat = parseFloat(geoData[0].lat);
            destLng = parseFloat(geoData[0].lon);
            const locIdx = finalTripData.findIndex((item: any) => item.locationInfo);
            if (locIdx !== -1) {
              finalTripData[locIdx] = {
                ...finalTripData[locIdx],
                locationInfo: {
                  ...finalTripData[locIdx].locationInfo,
                  coordinates: { lat: destLat, lng: destLng }
                }
              };
            }
          }
        }
      }

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
      console.error("Error resolving assets during trip generation:", e);
    }

    setStep("saving");

    const docId = generateTripId();

    const tripRecord: TripRecord = {
      userEmail: user?.email,
      tripPlan: tripResponse,
      tripData: JSON.stringify(finalTripData),
      docId: docId,
    };

    if (isDemoMode()) {
      try {
        await demoSaveTrip(tripRecord);
      } catch (saveErr) {
        console.error("Error saving demo trip:", saveErr);
        setLoading(false);
        setError("Your itinerary was generated but couldn't be saved. Please try again.");
        return;
      }
      setLoading(false);
      router.replace("/(tabs)/mytrip");
      return;
    }

    const saveOfflineAndExit = async () => {
      await queueTripForSync(tripRecord);
      setLoading(false);
      Alert.alert(
        "Saved Offline",
        "You're offline — this trip is saved on your device and will sync automatically once you're back online."
      );
      router.replace("/(tabs)/mytrip");
    };

    if (!(await isOnline())) {
      await saveOfflineAndExit();
      return;
    }

    try {
      await setDoc(doc(db, "UserTrips", docId), tripRecord);
    } catch (saveErr) {
      console.error("Error saving trip:", saveErr);
      if (!(await isOnline())) {
        await saveOfflineAndExit();
        return;
      }
      setLoading(false);
      setError("Your itinerary was generated but couldn't be saved. Please try again.");
      return;
    }

    setLoading(false);
    router.replace("/(tabs)/mytrip");
  };

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
        {STEP_LABELS[step]}
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
