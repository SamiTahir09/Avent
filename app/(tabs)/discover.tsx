import { View, Text, ScrollView, Image, Linking, Alert, TouchableOpacity } from "react-native";
import React, { useEffect, useState } from "react";
import { useLocalSearchParams } from "expo-router";
import moment from "moment";
import { Ionicons, MaterialIcons, FontAwesome5 } from "@expo/vector-icons";
import CustomButton from "@/components/CustomButton";
import LocationPhotoGallery from "@/components/LocationPhotoGallery";

const DEFAULT_IMAGE_URL =
  "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";

const Discover = () => {
  const { tripData, tripPlan } = useLocalSearchParams();
  const [parsedTripData, setParsedTripData] = useState<any>(null);
  const [parsedTripPlan, setParsedTripPlan] = useState<any>(null);

  const fetchPlaceImage = async (placeName: string) => {
    const defaultFallback = "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?q=80&w=2071&auto=format&fit=crop";
    const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY;
    
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

    return defaultFallback;
  };

  useEffect(() => {
    if (tripData && tripPlan) {
      const parsedTrip = JSON.parse(tripPlan as string);
      setParsedTripData(JSON.parse(tripData as string));
      setParsedTripPlan(parsedTrip);

      parsedTrip.trip_plan.hotel.options.forEach(
        async (hotel: any, index: number) => {
          const imageUrl = await fetchPlaceImage(hotel.name);
          setParsedTripPlan((prev: any) => ({
            ...prev,
            trip_plan: {
              ...prev.trip_plan,
              hotel: {
                ...prev.trip_plan.hotel,
                options: prev.trip_plan.hotel.options.map((h: any, i: number) =>
                  i === index ? { ...h, image_url: imageUrl } : h
                ),
              },
            },
          }));
        }
      );

      parsedTrip.trip_plan.places_to_visit.forEach(
        async (place: any, index: number) => {
          const imageUrl = await fetchPlaceImage(place.name);
          setParsedTripPlan((prev: any) => ({
            ...prev,
            trip_plan: {
              ...prev.trip_plan,
              places_to_visit: prev.trip_plan.places_to_visit.map(
                (p: any, i: number) =>
                  i === index ? { ...p, image_url: imageUrl } : p
              ),
            },
          }));
        }
      );
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
    const date = flight?.departure_date || "";

    let url = "";

    if (type === "flight") {
      // Google Flights — always works
      const fromEnc = encodeURIComponent(from);
      const toEnc = encodeURIComponent(to);
      url = `https://www.google.com/travel/flights?q=Flights+from+${fromEnc}+to+${toEnc}`;
    } else if (type === "bus") {
      const fromEnc = encodeURIComponent(from);
      const toEnc = encodeURIComponent(to);

      if (platform === "daewoo") {
        url = `https://www.daewoobus.com.pk`;
      } else if (platform === "faisal") {
        url = `https://www.faisalmoversbooking.com`;
      } else if (platform === "flixbus") {
        url = `https://global.flixbus.com/bus-routes`;
      } else if (platform === "redbus") {
        url = `https://www.redbus.pk`;
      } else {
        url = `https://www.google.com/search?q=bus+booking+${fromEnc}+to+${toEnc}`;
      }
    }

    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert("Error", "Cannot open this link on your device");
      }
    } catch (error) {
      console.error(error);
      Alert.alert("Error", "Something went wrong while opening booking");
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

            {/* ✅ REAL FLIGHT BOOKING — Google Flights */}
            <TouchableOpacity
              onPress={() => handleBooking("flight")}
              style={{
                backgroundColor: "#8b5cf6",
                borderRadius: 12,
                paddingVertical: 14,
                marginTop: 16,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Ionicons name="airplane" size={20} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>
                Book Flight on Google Flights
              </Text>
            </TouchableOpacity>
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
              onPress={() => handleBooking("bus", "daewoo")}
              style={{
                flex: 1,
                backgroundColor: "#7c3aed",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <FontAwesome5 name="bus" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>Daewoo Bus</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleBooking("bus", "faisal")}
              style={{
                flex: 1,
                backgroundColor: "#059669",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <FontAwesome5 name="bus-alt" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>Faisal Movers</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleBooking("bus", "redbus")}
              style={{
                flex: 1,
                backgroundColor: "#dc2626",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <FontAwesome5 name="ticket-alt" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>RedBus PK</Text>
            </TouchableOpacity>
          </View>

          {/* International Bus Options */}
          <Text style={{ fontWeight: "700", marginBottom: 10, color: "#6d28d9" }}>🌍 International</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <TouchableOpacity
              onPress={() => handleBooking("bus", "flixbus")}
              style={{
                flex: 1,
                backgroundColor: "#16a34a",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <FontAwesome5 name="bus" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>FlixBus</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleBooking("bus")}
              style={{
                flex: 1,
                backgroundColor: "#0369a1",
                borderRadius: 12,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <Ionicons name="search" size={18} color="#fff" />
              <Text style={{ color: "#fff", fontWeight: "700", marginTop: 6, fontSize: 13 }}>Search More</Text>
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