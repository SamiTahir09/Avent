import { View, Text } from "react-native";
import React, { useContext, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import CalendarPicker from "react-native-calendar-picker";
import { useRouter } from "expo-router";
import CustomButton from "@/components/CustomButton";
import { CreateTripContext } from "@/context/CreateTripContext";
import moment from "moment";

const SelectDates = () => {
  const router = useRouter();
  const { setTripData } = useContext(CreateTripContext);
  const [selectedStartDate, setSelectedStartDate] = useState<Date | null>(null);
  const [selectedEndDate, setSelectedEndDate] = useState<Date | null>(null);

  const onDateChange = (date: Date, type: "START_DATE" | "END_DATE") => {
    if (type === "START_DATE") {
      setSelectedStartDate(date);
    } else {
      setSelectedEndDate(date);
    }
  };

  const handleConfirmDates = () => {
    const totalNumberOfDays = moment(selectedEndDate).diff(
      moment(selectedStartDate),
      "days"
    );

    if (selectedStartDate && selectedEndDate) {
      setTripData((prev) => {
        const newData = prev.filter((item) => !("dates" in item));
        return [
          ...newData,
          {
            dates: {
              startDate: selectedStartDate,
              endDate: selectedEndDate,
              totalNumberOfDays: totalNumberOfDays + 1,
            },
          },
        ];
      });
      router.push("/create-trip/select-budget");
    } else {
      alert("Please select both start and end dates");
    }
  };

  return (
    <SafeAreaView className="flex-1">
      <View className="px-2 py-6">
        <Text className="text-5xl font-outfit-bold mb-2 px-4">
          When are you traveling?
        </Text>
        <Text className="text-gray-500 font-outfit-medium mb-6 px-5">
          Select your travel dates
        </Text>

        <View className="bg-white rounded-xl shadow-sm border border-neutral-100 p-4">
          <CalendarPicker
            startFromMonday={true}
            allowRangeSelection={true}
            minDate={new Date()}
            onDateChange={onDateChange}
            selectedDayColor="#8b5cf6"
            selectedDayTextColor="#ffffff"
            todayBackgroundColor="#f2e6ff"
            todayTextStyle={{ color: "#8b5cf6" }}
            textStyle={{
              fontFamily: "outfit",
              color: "#000000",
            }}
            selectedRangeStartStyle={{
              backgroundColor: "#7f6eac",
            }}
            selectedRangeEndStyle={{
              backgroundColor: "#7f6eac",
            }}
            selectedRangeStyle={{
              backgroundColor: "#8b5cf6",
            }}
          />
        </View>

        <View className="mt-6">
          <CustomButton
            title="Confirm Dates"
            onPress={handleConfirmDates}
            disabled={!selectedEndDate}
            className="disabled:opacity-50"
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

export default SelectDates;
