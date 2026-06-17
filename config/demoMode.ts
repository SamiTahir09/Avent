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
  currentUser = {
    email,
    uid: `demo-${Date.now()}`,
    metadata: { creationTime: now, lastSignInTime: now },
  };
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(currentUser));
  notifyAuthListeners();
  return { user: currentUser };
}

export async function demoSignUp(email: string, password: string) {
  return demoSignIn(email, password);
}

export async function demoSaveTrip(trip: Record<string, unknown>) {
  const raw = await AsyncStorage.getItem(TRIPS_KEY);
  const trips = raw ? JSON.parse(raw) : [];
  trips.push(trip);
  await AsyncStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
}

export async function demoGetTrips(email: string) {
  const raw = await AsyncStorage.getItem(TRIPS_KEY);
  const trips = raw ? JSON.parse(raw) : [];
  return trips.filter((trip: { userEmail?: string }) => trip.userEmail === email);
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
            image_url: `https://loremflickr.com/800/600/${cleanCity},hotel/all`,
            geo_coordinates: { latitude: 28.6139, longitude: 77.209 },
            rating: 4.5,
            description: "A comfortable stay in the heart of the city.",
          },
          {
            name: `${cityName} Heritage Inn`,
            address: `Old Town, ${location}`,
            price: budget === "Luxury" ? "₹9,500 per night" : "₹3,200 per night",
            image_url: `https://loremflickr.com/800/600/${cleanCity},resort/all`,
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
          image_url: `https://loremflickr.com/800/600/${cleanCity},city/all`,
          geo_coordinates: { latitude: 28.61, longitude: 77.2 },
          ticket_price: "Free",
          time_to_travel: "10 minutes from hotel",
        },
        {
          name: "Historic Landmark",
          details: "A must-visit heritage site in the area.",
          image_url: `https://loremflickr.com/800/600/${cleanCity},landmark/all`,
          geo_coordinates: { latitude: 28.615, longitude: 77.205 },
          ticket_price: "₹100",
          time_to_travel: "20 minutes from hotel",
        },
        {
          name: "Local Market",
          details: "Shop for souvenirs and try street food.",
          image_url: `https://loremflickr.com/800/600/${cleanCity},market/all`,
          geo_coordinates: { latitude: 28.618, longitude: 77.215 },
          ticket_price: "Free",
          time_to_travel: "15 minutes from hotel",
        },
      ],
    },
  };
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
