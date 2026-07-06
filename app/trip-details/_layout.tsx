import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function TripDetailsLayout() {
  const router = useRouter();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackTitle: "",
        headerTitle: "Trip Details",
        headerTitleStyle: {
          fontFamily: "outfit-bold",
          fontSize: 18,
          color: "#000",
        },
        headerStyle: {
          backgroundColor: "#fff",
        },
        headerLeft: () => (
          <TouchableOpacity className="ml-4" onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color="#000" />
          </TouchableOpacity>
        ),
      }}
    >
      <Stack.Screen name="index" />
    </Stack>
  );
}
