import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
} from "react-native";
import React, { useContext, useState } from "react";
import { useRouter } from "expo-router";
import { GooglePlacesAutocomplete } from "react-native-google-places-autocomplete";
import { CreateTripContext } from "@/context/CreateTripContext";
import { isDemoMode } from "@/config/env";
import CustomButton from "@/components/CustomButton";
import { parseCoordinates } from "@/utils/coordinates";

const DEMO_PLACES = [
  "Paris, France",
  "Tokyo, Japan",
  "Dubai, UAE",
  "Lahore, Pakistan",
  "London, UK",
];

const SearchPlace = () => {
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);
  const [demoPlace, setDemoPlace] = useState("");
  const [typedDestination, setTypedDestination] = useState("");

  const saveLocation = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    let lat = 28.6139;
    let lng = 77.209;
    let imageUrl = "";

    try {
      const cleanName = name.split(",")[0].trim();
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleanName)}&format=json&limit=1`,
        { headers: { "User-Agent": "AventTravelApp/1.0" } }
      );
      if (geoRes.ok) {
        const geoData = await geoRes.json();
        if (geoData && geoData.length > 0) {
          lat = parseFloat(geoData[0].lat);
          lng = parseFloat(geoData[0].lon);
        }
      }

      const wikiRes = await fetch(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cleanName.replace(/\s+/g, "_"))}`
      );
      if (wikiRes.ok) {
        const wikiData = await wikiRes.json();
        imageUrl = wikiData.originalimage?.source || wikiData.thumbnail?.source || "";
      }
    } catch (error) {
      console.error("Error geocoding/fetching image:", error);
    }

    setTripData((prev: any[]) => {
      const newData = prev.filter((item) => !item.locationInfo);
      return [
        ...newData,
        {
          locationInfo: {
            name,
            coordinates: { lat, lng },
            url: "",
            photoRef: null,
            imageUrl: imageUrl || null,
          },
        },
      ];
    });
    router.push("/create-trip/select-traveler");
  };

  if (isDemoMode()) {
    return (
      <View className="p-6 mt-16">
        <Text className="text-4xl font-outfit-bold text-center mb-2">
          Where do you want to go?
        </Text>
        <Text className="text-lg text-gray-400 font-outfit text-center mb-8">
          Demo mode — pick or type a destination
        </Text>

        <TextInput
          className="h-14 bg-neutral-200 rounded-full px-5 font-outfit-medium text-base mb-4"
          placeholder="Type destination (e.g. Istanbul, Turkey)"
          placeholderTextColor="#818181"
          value={demoPlace}
          onChangeText={setDemoPlace}
          onSubmitEditing={() => demoPlace.trim() && saveLocation(demoPlace.trim())}
        />

        <CustomButton
          title="Continue"
          onPress={() => demoPlace.trim() && saveLocation(demoPlace.trim())}
          className="mb-6"
        />

        {DEMO_PLACES.map((place) => (
          <TouchableOpacity
            key={place}
            onPress={() => saveLocation(place)}
            className="bg-purple-50 p-4 rounded-xl mb-3"
          >
            <Text className="font-outfit-medium text-purple-800">{place}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  return (
    <View>
      <View className="flex flex-col items-center">
        <Text className="text-5xl font-outfit-bold mt-20 px-3 mb-2">
          Where do you want to go?
        </Text>
        <Text className="text-lg text-gray-400 font-outfit">
          Find your destination!
        </Text>
      </View>

      <View className="p-6 mt-10 h-full w-full flex">
        <GooglePlacesAutocomplete
          placeholder="Search for a place"
          textInputProps={{
            placeholderTextColor: "#818181",
            returnKeyType: "search",
            value: typedDestination,
            onChangeText: setTypedDestination,
            onSubmitEditing: (e) => {
              const nextValue = e.nativeEvent.text.trim();
              if (nextValue) {
                saveLocation(nextValue);
              }
            },
            clearButtonMode: "never",
          }}
          fetchDetails={true}
          enablePoweredByContainer={false}
          onPress={(data, details = null) => {
            const coords = parseCoordinates(details?.geometry?.location);
            setTripData((prev: any[]) => {
              const newData = prev.filter((item) => !item.locationInfo);
              return [
                ...newData,
                {
                  locationInfo: {
                    name: data.description,
                    coordinates: coords ?? undefined,
                    url: details?.url,
                    // @ts-ignore
                    photoRef: details?.photos?.[0]?.photo_reference,
                  },
                },
              ];
            });
            router.push("/create-trip/select-traveler");
          }}
          query={{
            key: process.env.EXPO_PUBLIC_GOOGLE_MAP_KEY,
            language: "en",
          }}
          styles={{
            container: {
              flex: 0,
            },
            textInput: {
              height: 54,
              backgroundColor: "#e2e2e2",
              borderRadius: 999,
              paddingHorizontal: 16,
              fontSize: 15,
              fontFamily: "outfit-medium",
            },
            listView: {
              backgroundColor: "#fff",
              borderRadius: 8,
              marginTop: 8,
            },
            row: {
              padding: 13,
              height: 50,
              flexDirection: "row",
              backgroundColor: "#fff",
              alignItems: "center",
            },
            separator: {
              height: 0.5,
              backgroundColor: "#c8c7cc",
            },
            description: {
              fontSize: 15,
              fontFamily: "outfit",
            },
            predefinedPlacesDescription: {
              color: "#666666",
            },
            textInputContainer: {
              color: "#b5b3b3",
            },
            clearButton: {
              color: "#b5b3b3",
            },
          }}
        />

        <CustomButton
          title="Next"
          onPress={() => {
            const nextValue = typedDestination.trim();
            if (nextValue) {
              saveLocation(nextValue);
            }
          }}
          className="mt-4"
        />
      </View>
    </View>
  );
};

export default SearchPlace;
