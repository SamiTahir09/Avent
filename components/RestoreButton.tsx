import React, { useState } from "react";
import { TouchableOpacity, Text, ActivityIndicator, Alert } from "react-native";
import { useBilling } from "@/hooks/useBilling";

const RestoreButton = () => {
  const { restore } = useBilling();
  const [loading, setLoading] = useState(false);

  const handleRestore = async () => {
    setLoading(true);
    try {
      const { restored } = await restore();
      Alert.alert(
        restored ? "Purchases Restored" : "Nothing to Restore",
        restored
          ? "Your Premium subscription has been restored."
          : "We couldn't find a previous purchase for this account."
      );
    } catch {
      Alert.alert(
        "Restore Failed",
        "Something went wrong while restoring your purchases. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <TouchableOpacity
      onPress={handleRestore}
      disabled={loading}
      className="mt-2 mb-4 py-3 items-center"
    >
      {loading ? (
        <ActivityIndicator color="#8b5cf6" />
      ) : (
        <Text className="text-purple-600 font-outfit-bold">Restore Purchases</Text>
      )}
    </TouchableOpacity>
  );
};

export default RestoreButton;
