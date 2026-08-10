import { isDemoMode } from "./env";
import { demoAuth } from "./demoMode";

let auth: any;
let db: any;
let app: any;
let functionsInstance: any;
let onAuthStateChanged: any;
let onIdTokenChanged: any;

if (isDemoMode()) {
  auth = demoAuth;
  db = {};
  app = {};
  functionsInstance = {};
  onAuthStateChanged = (_auth: any, callback: any) => {
    return demoAuth.onAuthStateChanged(_auth, callback);
  };
  onIdTokenChanged = (_auth: any, callback: any) => {
    return demoAuth.onIdTokenChanged(_auth, callback);
  };
} else {
  const { initializeApp } = require("firebase/app");
  const {
    initializeAuth,
    getReactNativePersistence,
    onAuthStateChanged: firebaseOnAuthStateChanged,
    onIdTokenChanged: firebaseOnIdTokenChanged,
  } = require("firebase/auth");
  const AsyncStorage =
    require("@react-native-async-storage/async-storage").default;
  const { getFirestore } = require("firebase/firestore");
  const { getFunctions } = require("firebase/functions");

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
  db = getFirestore(app);
  functionsInstance = getFunctions(app);
  onAuthStateChanged = firebaseOnAuthStateChanged;
  onIdTokenChanged = firebaseOnIdTokenChanged;
}

export {
  app,
  auth,
  db,
  functionsInstance as functions,
  onAuthStateChanged,
  // Fires on sign-in, sign-out *and* token refresh. Consumers that care about
  // email verification must use this one: clicking the verification link does
  // not change auth state, so onAuthStateChanged stays silent, but the forced
  // getIdToken(true) in services/auth/emailGate.ts does fire this.
  onIdTokenChanged,
};
