import { Redirect, Tabs } from "expo-router";
import React, { useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import FontAwesome from "@expo/vector-icons/FontAwesome";

import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { isVerified } from "@/services/auth/emailAuth";

export default function TabLayout() {
  // Second line of defence behind app/index.tsx. index.tsx only runs on a cold
  // start, so without this an unverified user could reach the tabs by any other
  // route into the group — and, more importantly, a user whose account is
  // deleted or disabled mid-session would keep sitting inside the app.
  const [user, setUser] = useState<any>(auth.currentUser);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser: any) => {
      setUser(nextUser);
      setResolved(true);
    });
    return () => unsubscribe();
  }, []);

  if (!resolved && !user) return null;

  if (resolved && !user) return <Redirect href="/(auth)/welcome" />;

  if (user && !isVerified(user)) {
    return (
      <Redirect
        href={{
          pathname: "/(auth)/verify-email",
          params: { email: user.email ?? "" },
        }}
      />
    );
  }

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
