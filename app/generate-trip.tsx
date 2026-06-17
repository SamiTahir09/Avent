import { View, Text, Image } from "react-native";
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

const GenerateTrip = () => {
  const { tripData } = useContext(CreateTripContext);
  const [loading, setLoading] = useState(false);
  const user = auth.currentUser;

  const router = useRouter();

  useEffect(() => {
    generateTrip();
  }, []);

  const generateTrip = async () => {
    setLoading(true);

    const locationInfo = tripData.find(
      (item) => item.locationInfo
    )?.locationInfo;
    const travelers = tripData.find((item) => item.travelers)?.travelers;
    const dates = tripData.find((item) => item.dates)?.dates;
    const budget = tripData.find((item) => item.budget)?.budget;

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

    const result = await chatSession.sendMessage(FINAL_PROMPT);
    const tripResponse = JSON.parse(result.response.text());

    // Enrich coordinates and images for the trip plan
    const finalTripData = [...tripData];
    try {
      const location = locationInfo?.name || tripResponse?.trip_plan?.location || "";
      const cityName = location.split(",")[0].trim();
      
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

      let mainImageUrl = "";
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cityName.replace(/\s+/g, "_"))}`
      );
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        mainImageUrl = wikiData.originalimage?.source || wikiData.thumbnail?.source || "";
      }
      
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
        for (let i = 0; i < hotelOptions.length; i++) {
          const hotel = hotelOptions[i];
          hotel.geo_coordinates = {
            latitude: destLat + (i === 0 ? 0.005 : i === 1 ? -0.005 : 0.008),
            longitude: destLng + (i === 0 ? 0.005 : i === 1 ? -0.005 : -0.008),
          };

          let hotelImg = "";
          const hotelWikiRes = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hotel.name.split(",")[0].trim().replace(/\s+/g, "_"))}`
          );
          if (hotelWikiRes.ok) {
            const hotelWikiData = await hotelWikiRes.json();
            hotelImg = hotelWikiData.originalimage?.source || hotelWikiData.thumbnail?.source || "";
          }
          if (hotelImg) {
            hotel.image_url = hotelImg;
          } else {
            hotel.image_url = i === 0 
              ? "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800"
              : "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800";
          }
        }
      }

      if (tripResponse?.trip_plan?.places_to_visit) {
        const places = tripResponse.trip_plan.places_to_visit;
        for (let i = 0; i < places.length; i++) {
          const place = places[i];
          place.geo_coordinates = {
            latitude: destLat + (i === 0 ? 0.002 : i === 1 ? -0.002 : i === 2 ? 0.004 : -0.004),
            longitude: destLng + (i === 0 ? -0.002 : i === 1 ? 0.002 : i === 2 ? -0.004 : 0.004),
          };

          let placeImg = "";
          const placeWikiRes = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place.name.split(",")[0].trim().replace(/\s+/g, "_"))}`
          );
          if (placeWikiRes.ok) {
            const placeWikiData = await placeWikiRes.json();
            placeImg = placeWikiData.originalimage?.source || placeWikiData.thumbnail?.source || "";
          }
          if (placeImg) {
            place.image_url = placeImg;
          } else {
            const fallbacks = [
              "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800",
              "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800",
              "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800"
            ];
            place.image_url = fallbacks[i % fallbacks.length];
          }
        }
      }
    } catch (e) {
      console.error("Error resolving assets during trip generation:", e);
    }

    setLoading(false);

    const docId = Date.now().toString();

    const tripRecord = {
      userEmail: user?.email,
      tripPlan: tripResponse,
      tripData: JSON.stringify(finalTripData),
      docId: docId,
    };

    if (isDemoMode()) {
      await demoSaveTrip(tripRecord);
    } else {
      await setDoc(doc(db, "UserTrips", docId), tripRecord);
    }

    router.push("/mytrip");
  };

  return (
    <SafeAreaView className="p-6 h-full flex flex-col items-center justify-center">
      <Text className="font-outfit-bold text-3xl text-center">
        Please Wait...
      </Text>
      <Text className="font-outfit-medium text-xl text-center mt-10">
        Generating your itinerary...
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
