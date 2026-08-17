import { Redirect } from "expo-router";
import { useEffect, useState } from "react";

import { auth, onAuthStateChanged } from "@/config/FirebaseConfig";
import { isVerified } from "@/services/auth/emailAuth";
import InteractiveOpeningLogo from "@/components/InteractiveOpeningLogo";

/**
 * The app's only cold-start gate. Three outcomes:
 *   no session          → welcome
 *   session, unverified → verify-email   (this is what makes the email check
 *                         un-skippable: reinstalling, force-quitting or deep
 *                         linking past sign-up all land here)
 *   session, verified   → tabs
 */
export default function HomeScreen() {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<any>(auth.currentUser);
  const [showOpening, setShowOpening] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser: any) => {
      // The cached `emailVerified` flag can be stale — someone may have clicked
      // the link on their laptop since this device last saw a token. Refresh it
      // before deciding, so a verified user isn't bounced back to the verify
      // screen on every launch.
      if (nextUser && nextUser.emailVerified === false) {
        try {
          await nextUser.reload();
        } catch {
          // Offline: fall through with the cached flag. Worst case the user
          // taps "I've verified my email" once.
        }
      }
      setUser(nextUser);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Both gates must clear before routing: previously the logo finishing while
  // auth was still resolving redirected a signed-in user to /welcome for a frame.
  if (isLoading || showOpening) {
    return <InteractiveOpeningLogo onFinish={() => setShowOpening(false)} />;
  }

  if (!user) return <Redirect href="/(auth)/welcome" />;

  if (!isVerified(user)) {
    return (
      <Redirect
        href={{
          pathname: "/(auth)/verify-email",
          params: { email: user.email ?? "" },
        }}
      />
    );
  }

  return <Redirect href="/(tabs)/mytrip" />;
}
