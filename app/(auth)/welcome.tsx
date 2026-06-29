import { View, Text, TouchableOpacity, FlatList, Dimensions, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import React, { useRef, useState, useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { onboarding } from "@/constants";
import CustomButton from "@/components/CustomButton";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

const Onboarding = () => {
  const flatListRef = useRef<FlatList>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const isLastSlide = activeIndex === onboarding.length - 1;

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
      setActiveIndex(index);
    },
    []
  );

  const goNext = () => {
    if (isLastSlide) {
      router.replace("/(auth)/sign-up");
    } else {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    }
  };

  return (
    <SafeAreaView className="flex h-full items-center justify-between bg-white">
      <TouchableOpacity
        onPress={() => {
          router.replace("/(auth)/sign-up");
        }}
        className="w-full flex justify-end items-end p-5"
      >
        <Text className="text-purple-500 text-md font-outfit-bold">Skip</Text>
      </TouchableOpacity>

      <View style={{ flex: 1, width: SCREEN_WIDTH }}>
        <FlatList
          ref={flatListRef}
          data={onboarding}
          keyExtractor={(item) => String(item.id)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          bounces={false}
          renderItem={({ item }) => (
            <View style={{ width: SCREEN_WIDTH }} className="flex items-center justify-center p-5">
              <item.image width="100%" height={300} />
              <View className="flex flex-row items-center justify-center w-full mt-10">
                <Text className="text-purple-500 font-outfit-bold text-3xl mx-10 text-center">
                  {item.title}
                </Text>
              </View>
              <Text className="text-gray-500 text-center text-lg mt-3 mx-10 font-outfit font-semibold">
                {item.description}
              </Text>
            </View>
          )}
        />

        {/* Pagination dots */}
        <View className="flex flex-row items-center justify-center mb-4">
          {onboarding.map((_, index) => (
            <View
              key={index}
              className={`w-8 h-1 mx-1 rounded-full ${
                index === activeIndex ? "bg-purple-500" : "bg-slate-50"
              }`}
            />
          ))}
        </View>
      </View>

      <View className="w-full px-6 pb-6">
        <CustomButton
          title={isLastSlide ? "Get Started" : "Next"}
          onPress={goNext}
        />
      </View>
    </SafeAreaView>
  );
};

export default Onboarding;
