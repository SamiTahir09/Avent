declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_FIREBASE_API_KEY?: string;
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
    EXPO_PUBLIC_FIREBASE_PROJECT_ID?: string;
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?: string;
    EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?: string;
    EXPO_PUBLIC_FIREBASE_APP_ID?: string;
    EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID?: string;
    EXPO_PUBLIC_GEMINI_API_KEY?: string;
    EXPO_PUBLIC_GOOGLE_MAP_KEY?: string;
    EXPO_PUBLIC_GOOGLE_API_KEY?: string;
    EXPO_PUBLIC_UNSPLASH_ACCESS_KEY?: string;
    EXPO_PUBLIC_WEATHERAPI_KEY?: string;
    EXPO_PUBLIC_DEMO_MODE?: string;
    /** GA4 Measurement Protocol secret — the analytics path used in Expo Go. */
    EXPO_PUBLIC_GA4_API_SECRET?: string;
    /** Lets Analytics/Crashlytics report while running under Metro in dev. */
    EXPO_PUBLIC_FORCE_TELEMETRY_IN_DEV?: string;
    /**
     * "true" makes the premium buttons grant premium instantly with no payment.
     * TESTING ONLY — must be false for a production build.
     */
    EXPO_PUBLIC_BILLING_BYPASS?: string;
  }
}
