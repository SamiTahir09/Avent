import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { useEffect, useState } from "react";
import InteractiveOpeningLogo from "@/components/InteractiveOpeningLogo";
import { isEmailVerified } from "@/services/auth/emailGate";

export default function HomeScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState(auth.currentUser);
  const [showOpening, setShowOpening] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user: any) => {
      setUser(user);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // The opening animation can finish (or be tapped through in ~2s) long before
  // Firebase resolves the persisted session — that first callback waits on a
  // network round trip with a 30s timeout. Redirecting to Welcome here, as this
  // used to, unmounts this screen for good: when auth resolves seconds later
  // nothing re-evaluates, and a signed-in user is left retyping their password
  // because their connection was slow. Waiting is the only correct answer.
  if (isLoading) {
    return showOpening ? (
      <InteractiveOpeningLogo onFinish={() => setShowOpening(false)} />
    ) : (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#8b5cf6" />
      </View>
    );
  }

  if (user) {
    // Signed in is not the same as allowed in. An unverified account gets the
    // gate on every launch, not just the one right after sign-up — otherwise
    // killing and reopening the app would be a way straight past it.
    //
    // The flag on the persisted user record can lag reality (link clicked on
    // another device, app killed before the refresh landed), so the verify
    // screen re-checks on mount and forwards through if it has since flipped.
    return isEmailVerified(user) ? (
      <Redirect href="/(tabs)/mytrip" />
    ) : (
      <Redirect href="/(auth)/verify-email" />
    );
  }

  return <Redirect href="/(auth)/welcome" />;
}
