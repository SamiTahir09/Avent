import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_KEY = "avent_demo_user";
const TRIPS_KEY = "avent_demo_trips";

export type DemoUser = {
  email: string | null;
  uid: string;
  metadata: {
    creationTime: string;
    lastSignInTime: string;
  };
};

let currentUser: DemoUser | null = null;
const authListeners = new Set<(user: DemoUser | null) => void>();

async function loadStoredUser() {
  try {
    const raw = await AsyncStorage.getItem(USER_KEY);
    if (raw) {
      currentUser = JSON.parse(raw);
      authListeners.forEach((cb) => cb(currentUser));
    }
  } catch {
    currentUser = null;
  }
}

loadStoredUser();

function notifyAuthListeners() {
  authListeners.forEach((cb) => cb(currentUser));
}

export const demoAuth = {
  get currentUser() {
    return currentUser;
  },
  onAuthStateChanged(_auth: unknown, callback?: (user: DemoUser | null) => void) {
    let cb = callback;
    if (typeof _auth === "function") {
      cb = _auth as (user: DemoUser | null) => void;
    }
    if (!cb) return () => {};
    authListeners.add(cb);
    cb(currentUser);
    return () => {
      authListeners.delete(cb!);
    };
  },
  async signOut() {
    currentUser = null;
    await AsyncStorage.removeItem(USER_KEY);
    notifyAuthListeners();
  },
};

export async function demoSignIn(email: string, _password: string) {
  const now = new Date().toISOString();

  // Reuse existing UID if same email is already stored
  const raw = await AsyncStorage.getItem(USER_KEY);
  const existing: DemoUser | null = raw ? JSON.parse(raw) : null;
  const existingUid =
    existing && existing.email === email ? existing.uid : undefined;

  currentUser = {
    email,
    uid: existingUid ?? `demo-${Date.now()}`,
    metadata: {
      creationTime: existing?.metadata?.creationTime ?? now,
      lastSignInTime: now,
    },
  };
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(currentUser));
  notifyAuthListeners();
  return { user: currentUser };
}

export async function demoSignUp(email: string, password: string) {
  return demoSignIn(email, password);
}

export async function demoSaveTrip(trip: TripRecord) {
  const docId = trip.docId || Date.now().toString();
  await AsyncStorage.setItem(`${TRIPS_KEY}_${docId}`, JSON.stringify(trip));

  let tripIds: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(TRIPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && typeof parsed[0] === "object") {
          // Migrate old format to individual keys
          for (const oldTrip of parsed) {
            if (oldTrip && oldTrip.docId) {
              await AsyncStorage.setItem(`${TRIPS_KEY}_${oldTrip.docId}`, JSON.stringify(oldTrip));
              tripIds.push(oldTrip.docId);
            }
          }
        } else {
          tripIds = parsed;
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load/migrate old trips list, clearing index key:", err);
    try {
      await AsyncStorage.removeItem(TRIPS_KEY);
    } catch {}
  }

  if (!tripIds.includes(docId)) {
    tripIds.push(docId);
  }
  await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(tripIds));
}

export async function demoGetTrips(email: string) {
  let tripIds: string[] = [];
  try {
    const raw = await AsyncStorage.getItem(TRIPS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        if (parsed.length > 0 && typeof parsed[0] === "object") {
          // Migrate old format if successfully read
          const migratedIds: string[] = [];
          for (const oldTrip of parsed) {
            if (oldTrip && oldTrip.docId) {
              await AsyncStorage.setItem(`${TRIPS_KEY}_${oldTrip.docId}`, JSON.stringify(oldTrip));
              migratedIds.push(oldTrip.docId);
            }
          }
          await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(migratedIds));
          return parsed.filter((trip: { userEmail?: string }) => trip.userEmail === email);
        } else {
          tripIds = parsed;
        }
      }
    }
  } catch (err) {
    console.error("CursorWindow or other error loading trips index. Resetting database to prevent crashes:", err);
    try {
      await AsyncStorage.removeItem(TRIPS_KEY);
    } catch {}
    return [];
  }

  if (tripIds.length === 0) return [];

  try {
    const keys = tripIds.map((id) => `${TRIPS_KEY}_${id}`);
    const pairs = await AsyncStorage.multiGet(keys);
    const trips: any[] = [];
    const validIds: string[] = [];

    for (let i = 0; i < pairs.length; i++) {
      const [key, value] = pairs[i];
      const id = key.replace(`${TRIPS_KEY}_`, "");
      if (value) {
        try {
          const trip = JSON.parse(value);
          if (trip.userEmail === email) {
            trips.push(trip);
          }
          validIds.push(id);
        } catch {}
      }
    }

    if (validIds.length !== tripIds.length) {
      await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(validIds));
    }

    return trips;
  } catch (err) {
    console.error("Error reading individual trips:", err);
    return [];
  }
}

export function buildDemoTripPlan(
  location: string,
  totalDays: number,
  totalNights: number,
  travelers: string,
  budget: string
) {
  const cityName = location.split(",")[0].trim();
  const cleanCity = encodeURIComponent(cityName);

  return {
    trip_plan: {
      location,
      duration: `${totalDays} Day(s) and ${totalNights} Night(s)`,
      group_size: travelers,
      budget,
      flight_details: {
        airline: "Demo Airlines",
        flight_number: "DM-101",
        departure_city: "Your City",
        arrival_city: cityName,
        departure_date: new Date().toISOString().slice(0, 10),
        arrival_date: new Date().toISOString().slice(0, 10),
        departure_time: "10:00 AM",
        arrival_time: "1:30 PM",
        price: budget === "Luxury" ? "₹8,500" : "₹4,200",
        booking_url: "https://example.com/book",
      },
      hotel: {
        options: [
          {
            name: `Grand ${cityName} Hotel`,
            address: `Main Street, ${location}`,
            price: budget === "Luxury" ? "₹12,000 per night" : "₹4,500 per night",
            image_url:
              "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
            geo_coordinates: { latitude: 28.6139, longitude: 77.209 },
            rating: 4.5,
            description: "A comfortable stay in the heart of the city.",
          },
          {
            name: `${cityName} Heritage Inn`,
            address: `Old Town, ${location}`,
            price: budget === "Luxury" ? "₹9,500 per night" : "₹3,200 per night",
            image_url:
              "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800",
            geo_coordinates: { latitude: 28.62, longitude: 77.21 },
            rating: 4.2,
            description: "Charming hotel with local character.",
          },
        ],
      },
      places_to_visit: [
        {
          name: "City Center",
          details: "Explore the main attractions and local culture.",
          image_url:
            "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=800",
          geo_coordinates: { latitude: 28.61, longitude: 77.2 },
          ticket_price: "Free",
          time_to_travel: "10 minutes from hotel",
        },
        {
          name: "Historic Landmark",
          details: "A must-visit heritage site in the area.",
          image_url:
            "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=800",
          geo_coordinates: { latitude: 28.615, longitude: 77.205 },
          ticket_price: "₹100",
          time_to_travel: "20 minutes from hotel",
        },
        {
          name: "Local Market",
          details: "Shop for souvenirs and try street food.",
          image_url:
            "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800",
          geo_coordinates: { latitude: 28.618, longitude: 77.215 },
          ticket_price: "Free",
          time_to_travel: "15 minutes from hotel",
        },
      ],
    },
  };
}

// ─── Demo billing (mirrors demo trips: local-only, AsyncStorage-backed) ────
// Lets the freemium flow (1 free trip, paywall, "purchase", restore) be
// exercised in demo/preview builds without Firestore or expo-iap.
const ENTITLEMENT_KEY = "avent_demo_entitlement";

const defaultDemoEntitlement = (): UserEntitlement => ({
  premium: false,
  subscriptionType: null,
  purchaseDate: null,
  expiryDate: null,
  platform: null,
  purchaseToken: null,
  productId: null,
  transactionId: null,
  subscriptionStatus: null,
  autoRenewing: null,
  freeTripsUsed: 0,
  freeTripLimit: 2,
  lastVerifiedAt: null,
});

export async function demoGetEntitlement(): Promise<UserEntitlement> {
  try {
    const raw = await AsyncStorage.getItem(ENTITLEMENT_KEY);
    if (raw) return { ...defaultDemoEntitlement(), ...JSON.parse(raw) };
  } catch {
    // fall through to defaults
  }
  return defaultDemoEntitlement();
}

async function saveDemoEntitlement(entitlement: UserEntitlement) {
  await AsyncStorage.setItem(ENTITLEMENT_KEY, JSON.stringify(entitlement));
}

export async function demoConsumeFreeTrip(): Promise<{
  allowed: boolean;
  reason: "premium" | "free_trip" | "limit_reached";
}> {
  const entitlement = await demoGetEntitlement();
  if (entitlement.premium) return { allowed: true, reason: "premium" };
  if (entitlement.freeTripsUsed < entitlement.freeTripLimit) {
    await saveDemoEntitlement({
      ...entitlement,
      freeTripsUsed: entitlement.freeTripsUsed + 1,
    });
    return { allowed: true, reason: "free_trip" };
  }
  return { allowed: false, reason: "limit_reached" };
}

export async function demoPurchase(productId: string): Promise<UserEntitlement> {
  const entitlement = await demoGetEntitlement();
  const now = Date.now();
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const subscriptionType: SubscriptionType =
    productId === "premium_yearly"
      ? "yearly"
      : productId === "premium_lifetime"
      ? "lifetime"
      : "monthly";

  const updated: UserEntitlement = {
    ...entitlement,
    premium: true,
    subscriptionType,
    purchaseDate: now,
    expiryDate: subscriptionType === "lifetime" ? null : now + THIRTY_DAYS_MS,
    platform: "android",
    purchaseToken: `demo-${now}`,
    productId,
    transactionId: `demo-${now}`,
    subscriptionStatus: "active",
    autoRenewing: subscriptionType !== "lifetime",
    lastVerifiedAt: now,
  };
  await saveDemoEntitlement(updated);
  return updated;
}

export async function demoRestore(): Promise<UserEntitlement> {
  return demoGetEntitlement();
}

export const demoChatSession = {
  sendMessage: async (prompt: string) => {
    const locationMatch = prompt.match(/Location - (.+?)\./);
    const daysMatch = prompt.match(/(\d+) Day/);
    const nightsMatch = prompt.match(/(\d+) Night/);
    const travelersMatch = prompt.match(/group size of (.+?),/);
    const budgetMatch = prompt.match(/with a (.+?) Budget/);

    const plan = buildDemoTripPlan(
      locationMatch?.[1] || "Paris, France",
      Number(daysMatch?.[1] || 3),
      Number(nightsMatch?.[1] || 2),
      travelersMatch?.[1] || "Solo (1 people)",
      budgetMatch?.[1] || "Moderate"
    );

    await new Promise((resolve) => setTimeout(resolve, 1500));

    return {
      response: {
        text: () => JSON.stringify(plan),
      },
    };
  },
};
