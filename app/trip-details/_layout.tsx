import { Stack, useRouter } from "expo-router";
import { TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";

export default function TripDetailsLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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
          height: 92 + insets.top,
          paddingTop: insets.top + 4,
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
