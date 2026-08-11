import React, { useEffect, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { router, useSegments } from "expo-router";
import { auth, onIdTokenChanged } from "@/config/FirebaseConfig";
import {
  ensureVerifiedToken,
  isEmailVerified,
} from "@/services/auth/emailGate";

/**
 * Keeps unverified (and signed-out) accounts out of every screen that isn't in
 * the `(auth)` group.
 *
 * `app/index.tsx` already routes correctly on launch, but it is only the entry
 * point: the custom URL scheme means `myapp://generate-trip` opens that screen
 * directly, without passing through it. Rather than repeat a check in each
 * screen — and miss the next one someone adds — this sits above the whole Stack
 * and reacts to route changes.
 *
 * The Firestore rules and callable functions reject unverified tokens anyway,
 * so this is not the security boundary; it exists so the failure mode is a
 * clear "verify your email" screen instead of a screen that renders and then
 * throws permission errors.
 */
const AuthGate = ({ children }: { children: React.ReactNode }) => {
  // Cast: expo-router types useSegments() as a union of the known route tuples,
  // which excludes the empty array the bare index route actually produces — so
  // the `length === 0` test below is a type error without this.
  const segments = useSegments() as string[];
  const [user, setUser] = useState<any>(auth.currentUser);
  // Nothing may be decided from `auth.currentUser` before the listener speaks:
  // it reads null while the persisted session is still being rehydrated, which
  // would eject a signed-in user on every cold start.
  const [authResolved, setAuthResolved] = useState(false);

  useEffect(() => {
    return onIdTokenChanged(auth, (next: any) => {
      setUser(next);
      setAuthResolved(true);
    });
  }, []);

  // Deliberately not scoped to a route: this has to run on the launch path that
  // goes straight into the tabs, which the redirect effect below skips entirely.
  // See ensureVerifiedToken() for the cold-start case it repairs.
  //
  // Retried on reconnect and on foreground because the launch attempt can fail:
  // verify the link on a laptop, then open the app with no signal, and the
  // refresh throws. Firebase hands back the same mutable user object on every
  // token event, so this effect's deps never change and it would not run again —
  // leaving the session holding a token the rules reject until something else
  // happened to refresh it. These two listeners are that something.
  useEffect(() => {
    if (!authResolved || !user) return;

    void ensureVerifiedToken();

    const netUnsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) void ensureVerifiedToken();
    });
    const appSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void ensureVerifiedToken();
    });

    return () => {
      netUnsubscribe();
      appSubscription.remove();
    };
  }, [authResolved, user]);

  useEffect(() => {
    if (!authResolved) return;

    // The `(auth)` group is where an unverified user is supposed to be, and the
    // bare index route does its own redirecting — stepping on either would mean
    // two navigations racing for the same decision.
    const isAuthGroup = segments[0] === "(auth)";
    const isIndex = segments.length === 0;
    if (isAuthGroup || isIndex) return;

    if (!user) {
      router.replace("/(auth)/welcome");
      return;
    }
    if (!isEmailVerified(user)) {
      router.replace("/(auth)/verify-email");
    }
  }, [authResolved, user, segments]);

  return <>{children}</>;
};

export default AuthGate;
