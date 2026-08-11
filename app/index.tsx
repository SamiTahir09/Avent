import { Redirect } from "expo-router";
import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { useEffect, useState } from "react";
import InteractiveOpeningLogo from "@/components/InteractiveOpeningLogo";

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

  if (isLoading) {
    return showOpening ? (
      <InteractiveOpeningLogo onFinish={() => setShowOpening(false)} />
    ) : (
      <Redirect href="/(auth)/welcome" />
    );
  }

  if (user) return <Redirect href="/(tabs)/mytrip" />;

  return <Redirect href="/(auth)/welcome" />;
}
