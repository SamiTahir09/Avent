import { View, Text, FlatList, TouchableOpacity } from "react-native";
import React, { useContext } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { travelerOptions } from "@/constants/Options";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { CreateTripContext } from "@/context/CreateTripContext";
import { useRouter } from "expo-router";

const SelectTraveler = () => {
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);

  const handleSelectTraveler = (option: any) => {
    setTripData((prev) => {
      const newData = prev.filter((item) => !("travelers" in item));
      return [
        ...newData,
        {
          travelers: {
            type: option.title,
            count: option.people,
          },
        },
      ];
    });
    router.push("/create-trip/select-dates");
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      onPress={() => handleSelectTraveler(item)}
      className="flex-row items-center p-4 bg-white rounded-xl mb-4 shadow-sm border border-neutral-100"
    >
      <View className="bg-purple-100 p-3 rounded-full">
        {item.icon === "person" || item.icon === "people-circle" ? (
          <Ionicons name={item.icon as any} size={24} color="#8b5cf6" />
        ) : (
          <MaterialIcons name={item.icon as any} size={24} color="#8b5cf6" />
        )}
      </View>
      <View className="flex-1 ml-4">
        <Text className="text-lg font-outfit-bold">{item.title}</Text>
        <Text className="text-gray-500 text-sm font-outfit">
          {item.description}
        </Text>
      </View>
      <View className="bg-purple-50 px-3 py-1 rounded-full">
        <Text className="text-purple-600 font-outfit-medium">
          {item.people}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView className="flex-1">
      <View className="p-6">
        <Text className="text-5xl font-outfit-bold mb-2">
          Who's Travelling?
        </Text>
        <Text className="text-gray-500 font-outfit-medium mb-6">
          Choose your travelers
        </Text>

        <FlatList
          data={travelerOptions}
          renderItem={renderItem}
          keyExtractor={(item) => item.id.toString()}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: 6 }}
        />
      </View>
    </SafeAreaView>
  );
};

export default SelectTraveler;
