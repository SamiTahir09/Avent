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
    setLoading(false);

    const docId = Date.now().toString();

    const tripRecord = {
      userEmail: user?.email,
      tripPlan: tripResponse,
      tripData: JSON.stringify(tripData),
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
