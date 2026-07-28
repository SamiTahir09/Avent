import { isDemoMode } from "./env";
import { demoAuth } from "./demoMode";

// Firebase is Auth-only in this app — trips and premium entitlement live in
// the on-device SQLite database (see services/db/) instead of
// Firestore/Cloud Functions, so there's no backend to keep in sync with.
let auth: any;
let app: any;
let onAuthStateChanged: any;

if (isDemoMode()) {
  auth = demoAuth;
  app = {};
  onAuthStateChanged = (_auth: any, callback: any) => {
    return demoAuth.onAuthStateChanged(_auth, callback);
  };
} else {
  const { initializeApp } = require("firebase/app");
  const {
    initializeAuth,
    getReactNativePersistence,
    onAuthStateChanged: firebaseOnAuthStateChanged,
  } = require("firebase/auth");
  const AsyncStorage =
    require("@react-native-async-storage/async-storage").default;

  const firebaseConfig = {
    apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
    measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
  };

  app = initializeApp(firebaseConfig);
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  onAuthStateChanged = firebaseOnAuthStateChanged;
}

export { app, auth, onAuthStateChanged };
