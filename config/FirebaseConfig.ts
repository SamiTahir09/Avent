import { isDemoMode } from "./env";
import { demoAuth } from "./demoMode";

let auth: any;
let db: any;
let app: any;
let onAuthStateChanged: any;

if (isDemoMode()) {
  auth = demoAuth;
  db = {};
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
  const { getFirestore } = require("firebase/firestore");

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
  onAuthStateChanged = firebaseOnAuthStateChanged;
}

export { app, auth, db, onAuthStateChanged };
