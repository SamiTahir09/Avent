import { Tabs } from "expo-router";
import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/Colors";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import FontAwesome from "@expo/vector-icons/FontAwesome";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#8b5cf6",
        tabBarInactiveTintColor: "#64748b",
        tabBarLabelStyle: {
          fontFamily: "outfit-medium",
          fontSize: 12,
        },
      }}
    >
      <Tabs.Screen
        name="mytrip"
        options={{
          tabBarLabel: "My Trips",
          tabBarIcon: ({ focused }) => (
            <Ionicons
              name="location-sharp"
              size={24}
              color={focused ? "#8b5cf6" : "#64748b"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          tabBarLabel: "Discover",
          tabBarIcon: ({ focused }) => (
            <MaterialIcons
              name="travel-explore"
              size={24}
              color={focused ? "#8b5cf6" : "#64748b"}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarLabel: "Profile",
          tabBarIcon: ({ focused }) => (
            <FontAwesome
              name="user-o"
              size={21}
              color={focused ? "#8b5cf6" : "#64748b"}
            />
          ),
        }}
      />
    </Tabs>
  );
}
