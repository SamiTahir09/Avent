import { View, Text, ScrollView, Image, Linking, Alert, TouchableOpacity } from "react-native";
import React, { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import moment from "moment";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import CustomButton from "@/components/CustomButton";
import LocationPhotoGallery from "@/components/LocationPhotoGallery";

const DEFAULT_IMAGE_URL =
  "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";

const UNSPLASH_KEY = process.env.EXPO_PUBLIC_UNSPLASH_ACCESS_KEY || "";

const fetchUnsplashImage = async (query: string) => {
  if (!UNSPLASH_KEY) return "";
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(
        query
      )}&per_page=3&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${UNSPLASH_KEY}` } }
    );
    if (!res.ok) return "";
    const data = await res.json();
    const results = data?.results || [];
    if (!results.length) return "";
    const pick = results[Math.floor(Math.random() * Math.min(results.length, 3))];
    return pick?.urls?.regular || pick?.urls?.small || "";
  } catch (e) {
    return "";
  }
};

const Discover = () => {
  const { tripData, tripPlan } = useLocalSearchParams();
  const [parsedTripData, setParsedTripData] = useState<any>(null);
  const [parsedTripPlan, setParsedTripPlan] = useState<any>(null);

  const fetchPlaceImage = async (placeName: string) => {
    const defaultFallback = "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY;

    // 1) Prefer Unsplash if key available
    try {
      const unsplash = await fetchUnsplashImage(placeName);
      if (unsplash) return unsplash;
    } catch (e) {
      // ignore
    }

    // 2) Wikipedia fallback
    try {
      const cleanName = placeName.split(",")[0].trim().replace(/\s+/g, "_");
      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName)}`
      );
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        const source = wikiData.originalimage?.source || wikiData.thumbnail?.source;
        if (source) return source;
      }
    } catch (error) {
      console.error("Error fetching Wikipedia fallback image:", error);
    }

    // 3) Google Places fallback (use only if available)
    if (apiKey) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(
            placeName
          )}&key=${apiKey}`
        );

        const data = await response.json();
        const place = data.results?.[0];
        if (place) {
          const photoRef = place.photos?.[0]?.photo_reference;
          if (photoRef) {
            return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photo_reference=${photoRef}&key=${apiKey}`;
          }
        }
      } catch (error) {
        console.error("Error fetching Google Place image:", error);
      }
    }

    return defaultFallback;
  };

  useEffect(() => {
    if (tripData && tripPlan) {
      const parsedTrip = JSON.parse(tripPlan as string);
      setParsedTripData(JSON.parse(tripData as string));
      // assign parsed plan first
      setParsedTripPlan(parsedTrip);

      // fetch hotel images in parallel and update once
      (async () => {
        try {
          const hotels = parsedTrip.trip_plan.hotel.options || [];
          const hotelImgPromises = hotels.map((h: any) =>
            (async () => {
              // prefer existing image_url if provided by the plan
              if (h.image_url) return h.image_url;
              const fromPlace = await fetchPlaceImage(h.name);
              if (fromPlace && fromPlace !== DEFAULT_IMAGE_URL) return fromPlace;
              const fromUnsplash = await fetchUnsplashImage(`${h.name.split(",")[0].trim()} hotel`);
              return fromUnsplash || DEFAULT_IMAGE_URL;
            })()
          );
          const hotelImgs = await Promise.all(hotelImgPromises);
          setParsedTripPlan((prev: any) => ({
            ...prev,
            trip_plan: {
              ...prev.trip_plan,
              hotel: {
                ...prev.trip_plan.hotel,
                options: prev.trip_plan.hotel.options.map((h: any, i: number) => ({
                  ...h,
                  image_url: hotelImgs[i] || h.image_url || DEFAULT_IMAGE_URL,
                })),
              },
            },
          }));
        } catch (e) {
          console.error("Error fetching hotel images:", e);
        }
      })();

      // fetch place images in parallel and update once
      (async () => {
        try {
          const places = parsedTrip.trip_plan.places_to_visit || [];
          const placeImgPromises = places.map((p: any) =>
            (async () => {
              if (p.image_url) return p.image_url;
              const fromPlace = await fetchPlaceImage(p.name);
              if (fromPlace && fromPlace !== DEFAULT_IMAGE_URL) return fromPlace;
              const fromUnsplash = await fetchUnsplashImage(`${p.name.split(",")[0].trim()} travel`);
              return fromUnsplash || DEFAULT_IMAGE_URL;
            })()
          );
          const placeImgs = await Promise.all(placeImgPromises);
          setParsedTripPlan((prev: any) => ({
            ...prev,
            trip_plan: {
              ...prev.trip_plan,
              places_to_visit: prev.trip_plan.places_to_visit.map((p: any, i: number) => ({
                ...p,
                image_url: placeImgs[i] || p.image_url || DEFAULT_IMAGE_URL,
              })),
            },
          }));
        } catch (e) {
          console.error("Error fetching place images:", e);
        }
      })();
    }
  }, [tripData, tripPlan]);

  if (!parsedTripPlan || !parsedTripData) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-xl font-outfit-medium text-gray-600">
          Select a trip to view details
        </Text>
      </View>
    );
  }

  // ✅ SMART BOOKING FUNCTION — builds real URLs
  const handleBooking = async (type: "flight" | "bus", platform?: string) => {
    const flight = parsedTripPlan?.trip_plan?.flight_details;
    const from = flight?.departure_city || "";
    const to = flight?.arrival_city || parsedTripPlan?.trip_plan?.location || "";

    let url = "";

    if (type === "flight") {
      const fromEnc = encodeURIComponent(from);
      const toEnc = encodeURIComponent(to);
      // Prefer Emirates booking. Use a site-restricted Google search to find matching Emirates routes
      // when we have origin/destination; otherwise open Emirates homepage.
      url = from && to
        ? `https://www.google.com/search?q=site:emirates.com+Flights+from+${fromEnc}+to+${toEnc}`
        : `https://www.emirates.com/`;
    } else if (type === "bus") {
      const fromEnc = encodeURIComponent(from);
      const toEnc = encodeURIComponent(to);

      if (platform === "flixbus") {
        url = `https://global.flixbus.com/bus-routes`;
      } else if (platform === "redbus") {
        // use global redbus domain which redirects appropriately for many regions
        url = `https://www.redbus.com`;
      } else {
        url = `https://www.google.com/search?q=online+bus+booking+${fromEnc}+to+${toEnc}`;
      }
    }

    try {
      // ✅ Directly open URL — canOpenURL fails on Android for HTTPS links
      await Linking.openURL(url);
    } catch (error) {
      console.error("Booking URL error:", error);
      // Fallback: open Google search
      const fallback = `https://www.google.com/search?q=online+bus+booking+${encodeURIComponent(from)}+to+${encodeURIComponent(to)}`;
      try {
        await Linking.openURL(fallback);
      } catch (e) {
        Alert.alert("خرابی", "لنک نہیں کھل سکا۔ براہ کرم دوبارہ کوشش کریں۔");
      }
    }
  };

  const handleOpenMap = (latitude: number, longitude: number) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
    Linking.openURL(url);
  };

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerStyle={{
        padding: 24,
        paddingTop: 80,
        paddingBottom: 20,
      }}
    >
      <Text className="text-3xl font-outfit-bold mb-4">Trip Details</Text>

      {/* ── Real-World Photo Gallery ── */}
      <LocationPhotoGallery
        locationName={parsedTripPlan?.trip_plan?.location || ""}
        googleApiKey={process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY}
        useRandomPhotos={true}
        style={{ marginBottom: 20 }}
      />

      {/* Trip Overview */}
      <View className="bg-purple-50 p-4 rounded-xl mb-6">
        <Text className="font-outfit-bold text-lg mb-2">Trip Overview</Text>
        <Text className="font-outfit text-gray-600">
          Duration: {parsedTripPlan.trip_plan.duration}
        </Text>
        <Text className="font-outfit text-gray-600">
          Budget: {parsedTripPlan.trip_plan.budget}
        </Text>
      </View>

      {/* Flight Details */}
      <View className="mb-8">
        <Text className="text-2xl font-outfit-bold mb-4">Flight Details</Text>
        <View className="bg-gray-50 p-4 rounded-xl border border-gray-100">
          <View className="flex-row justify-between items-center mb-4">
            <View>
              <Text className="font-outfit-bold text-lg">
                {parsedTripPlan.trip_plan.flight_details.departure_city}
              </Text>
              <Text className="font-outfit text-gray-600">
                {parsedTripPlan.trip_plan.flight_details.departure_date}{" "}
                {parsedTripPlan.trip_plan.flight_details.departure_time}
              </Text>
            </View>

            <Ionicons name="airplane" size={24} color="#8b5cf6" />

            <View>
              <Text className="font-outfit-bold text-lg">
                {parsedTripPlan.trip_plan.flight_details.arrival_city}
              </Text>
              <Text className="font-outfit text-gray-600">
                {parsedTripPlan.trip_plan.flight_details.arrival_date}{" "}
                {parsedTripPlan.trip_plan.flight_details.arrival_time}
              </Text>
            </View>
          </View>

          <View className="border-t border-gray-200 pt-4">
            <Text className="font-outfit text-gray-600">
              Airline: {parsedTripPlan.trip_plan.flight_details.airline}
            </Text>
            <Text className="font-outfit text-gray-600">
              Flight: {parsedTripPlan.trip_plan.flight_details.flight_number}
            </Text>
            <Text className="font-outfit text-gray-600">
              Price: {parsedTripPlan.trip_plan.flight_details.price}
            </Text>

            {/* ✅ REAL FLIGHT BOOKING — Providers */}
            <View style={{ marginTop: 16, gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TouchableOpacity
                  onPress={async () => {
                    try {
                      await Linking.openURL("https://www.onetravel.com/booknow/flights/destinations/country?country-code=PK&fpaffiliate=ot-googledesktop-global-destination&fpsub=Destination-Destinations_Intl_Exact_ATLAS_Global_SP&utm_term=airline%20pakistan&fpprice=&refid=&utm_campaign=&utm_source={google}&utm_medium={cpc}&device=c&campaignid=21754998913&adgroupid=168195431259&gad_source=1&gad_campaignid=21754998913&gbraid=0AAAAA-POqERIDPfqQgVXIBuyq7EIAXaA0&gclid=Cj0KCQjwi8nRBhDhARIsAHZf_paaBlEvdhTlukCBJpj3n1CV3Ma74kMt-1UZO4qtyMIkbHzVHGNb1v0aAlAvEALw_wcB");
                    } catch (e) {
                      Alert.alert("Error", "Unable to open OneTravel.");
                    }
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: "#1f2937",
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="airplane" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>OneTravel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={async () => {
                    try {
                      await Linking.openURL("https://www.skyscanner.pk/pk/en-gb/pkr/?adgroupid=146649109183&associateID=SEM_FLI_19465_00000&campaign_id=19965444611&gad_campaignid=19965444611&gad_source=1&gbraid=0AAAAAD3oWFgwSfdLRvX7nhbWhXqwetOF3&gclid=Cj0KCQjwi8nRBhDhARIsAHZf_pblybeMzyaU5MANTxVTYmE2mtC9g2b_1PMvJ3y8OA4EWp36OEXHbgUaAqtAEALw_wcB&gclsrc=aw.ds&keyword_id=kwd-18709060&previousCultureSource=URL&redirectedFrom=www.skyscanner.net&utm_campaign=PK-Flights-Search-EN-Generics&utm_medium=cpc&utm_source=google&utm_term=flight+booking");
                    } catch (e) {
                      Alert.alert("Error", "Unable to open Skyscanner.");
                    }
                  }}
                  style={{
                    flex: 1,
                    backgroundColor: "#00a699",
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                  }}
                >
                  <Ionicons name="airplane" size={18} color="#fff" />
                  <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>Skyscanner</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                onPress={async () => {
                  try {
                    await Linking.openURL("https://bookme.pk/pakistan-international-airlines");
                  } catch (e) {
                    Alert.alert("Error", "Unable to open PIA booking site.");
                  }
                }}
                style={{
                  backgroundColor: "#ef4444",
                  borderRadius: 12,
                  paddingVertical: 14,
                  marginTop: 10,
                  alignItems: "center",
                }}
              >
                <Ionicons name="airplane" size={18} color="#fff" />
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16, marginTop: 6 }}>PIA</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* ─────────────── BUS BOOKING SECTION ─────────────── */}
      <View className="mb-8">
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 8 }}>
          <FontAwesome5 name="bus" size={22} color="#7c3aed" />
          <Text className="text-2xl font-outfit-bold">Book Bus Seat</Text>
        </View>

        <View style={{ backgroundColor: "#f5f3ff", borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "#ddd6fe" }}>
          <Text style={{ fontFamily: "outfit", color: "#4b5563", marginBottom: 12, fontSize: 14 }}>
            📍 From: {parsedTripPlan.trip_plan.flight_details.departure_city || "Your City"}{"  ➜  "}
            {parsedTripPlan.trip_plan.flight_details.arrival_city || parsedTripPlan.trip_plan.location}
          </Text>

          {/* Pakistan Bus Options */}
          <Text style={{ fontWeight: "700", marginBottom: 10, color: "#6d28d9" }}>🇵🇰 Pakistan</Text>
          <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
            <TouchableOpacity
              onPress={async () => {
                try {
                  await Linking.openURL("https://daewoo.com.pk/");
                } catch (e) {
                  Alert.alert("Error", "Unable to open Daewoo website.");
                }
              }}
              style={{
                flex: 1,
                backgroundColor: "#0b5efd",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <FontAwesome5 name="bus" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>Daewoo</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={async () => {
                try {
                  await Linking.openURL("https://faisalmovers.com/booking/");
                } catch (e) {
                  Alert.alert("Error", "Unable to open Faisal Movers booking page.");
                }
              }}
              style={{
                flex: 1,
                backgroundColor: "#0369a1",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <FontAwesome5 name="ticket-alt" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>Faisal Movers</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Hotels Section */}
      <View className="mb-8">
        <Text className="text-2xl font-outfit-bold mb-4">Hotel Options</Text>
        {parsedTripPlan.trip_plan.hotel.options.map(
          (hotel: any, index: number) => (
            <View
              key={index}
              className="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100"
            >
              <Image
                source={{ uri: hotel.image_url }}
                className="w-full h-48 rounded-xl mb-4"
              />
              <Text className="font-outfit-bold text-lg">{hotel.name}</Text>
              <Text className="font-outfit text-gray-600 mb-2">
                {hotel.address}
              </Text>
              <Text className="font-outfit text-gray-600">
                Price: {hotel.price}
              </Text>
              <Text className="font-outfit text-gray-600">
                Rating: {hotel.rating} ⭐
              </Text>
              <Text className="font-outfit text-gray-600 mt-2">
                {hotel.description}
              </Text>

              <CustomButton
                title="View on Map"
                onPress={() =>
                  handleOpenMap(
                    hotel.geo_coordinates.latitude,
                    hotel.geo_coordinates.longitude
                  )
                }
                className="mt-4"
              />
            </View>
          )
        )}
      </View>

      {/* Places to Visit */}
      <View className="mb-8">
        <Text className="text-2xl font-outfit-bold mb-4">
          Places to Visit
        </Text>

        {parsedTripPlan.trip_plan.places_to_visit.map(
          (place: any, index: number) => (
            <View
              key={index}
              className="bg-gray-50 p-4 rounded-xl mb-4 border border-gray-100"
            >
              <Image
                source={{ uri: place.image_url }}
                className="w-full h-48 rounded-xl mb-4"
              />
              <Text className="font-outfit-bold text-lg">{place.name}</Text>
              <Text className="font-outfit text-gray-600 mb-2">
                {place.details}
              </Text>
              <Text className="font-outfit text-gray-600">
                Ticket Price: {place.ticket_price}
              </Text>
              <Text className="font-outfit text-gray-600">
                Time to Travel: {place.time_to_travel}
              </Text>

              <CustomButton
                title="View on Map"
                onPress={() =>
                  handleOpenMap(
                    place.geo_coordinates.latitude,
                    place.geo_coordinates.longitude
                  )
                }
                className="mt-4"
              />
            </View>
          )
        )}
      </View>
    </ScrollView>
  );
};

export default Discover;