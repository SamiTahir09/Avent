export const isDemoMode = (): boolean => {
  if (process.env.EXPO_PUBLIC_DEMO_MODE === "true") return true;
  return !process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
};
