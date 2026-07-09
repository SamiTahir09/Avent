import { create } from "zustand";

const DEFAULT_FREE_TRIP_LIMIT = 2;

interface PremiumState extends UserEntitlement {
  products: NormalizedProduct[];
  purchaseState: PurchaseState;
  purchaseError: string | null;
  entitlementLoaded: boolean;
}

interface PremiumActions {
  setEntitlement: (patch: Partial<UserEntitlement>) => void;
  setEntitlementLoaded: (loaded: boolean) => void;
  setProducts: (products: NormalizedProduct[]) => void;
  setPurchaseState: (state: PurchaseState, error?: string | null) => void;
  reset: () => void;
}

const initialEntitlement: UserEntitlement = {
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
  freeTripLimit: DEFAULT_FREE_TRIP_LIMIT,
  lastVerifiedAt: null,
};

const initialState: PremiumState = {
  ...initialEntitlement,
  products: [],
  purchaseState: "idle",
  purchaseError: null,
  entitlementLoaded: false,
};

// Pure state container — no Firestore/expo-iap imports here. Everything that
// touches Firestore or the Play Billing client lives in hooks/useBilling.ts
// and services/billing/*, which call these setters. Keeping this file free
// of I/O is what makes every screen safe to subscribe to via a selector
// without triggering side effects on render.
export const usePremiumStore = create<PremiumState & PremiumActions>((set) => ({
  ...initialState,

  setEntitlement: (patch) => set((state) => ({ ...state, ...patch })),

  setEntitlementLoaded: (loaded) => set({ entitlementLoaded: loaded }),

  setProducts: (products) => set({ products }),

  setPurchaseState: (purchaseState, error = null) =>
    set({ purchaseState, purchaseError: error }),

  reset: () => set({ ...initialState }),
}));

// A free user may generate a trip while they still have free trips left;
// a premium user always may. Derived on read rather than stored, so it can
// never drift from the fields it's computed from.
export const selectCanGenerateTrip = (state: PremiumState) =>
  state.premium || state.freeTripsUsed < state.freeTripLimit;

export const selectProductByPeriod = (
  state: PremiumState,
  productId: string
): NormalizedProduct | undefined => state.products.find((p) => p.productId === productId);
