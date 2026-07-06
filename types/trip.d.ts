declare interface TripCoordinates {
  lat: number;
  lng: number;
}

declare interface TripLocationInfo {
  name: string;
  coordinates?: TripCoordinates;
  url?: string;
  photoRef?: string | null;
  imageUrl?: string | null;
  weather?: any;
}

declare interface TripTravelers {
  type: string;
  count: string | number;
}

declare interface TripDates {
  startDate: Date | string;
  endDate: Date | string;
  totalNumberOfDays: number;
}

declare interface TripBudget {
  type: string;
}

declare type TripDataItem =
  | { locationInfo: TripLocationInfo }
  | { travelers: TripTravelers }
  | { dates: TripDates }
  | { budget: TripBudget };

declare interface TripPlanFlightDetails {
  airline?: string;
  flight_number?: string;
  departure_city?: string;
  arrival_city?: string;
  departure_date?: string;
  arrival_date?: string;
  departure_time?: string;
  arrival_time?: string;
  price?: string;
  booking_url?: string;
}

declare interface TripPlanHotelOption {
  name: string;
  address?: string;
  price?: string;
  image_url?: string;
  geo_coordinates?: { latitude: number; longitude: number };
  rating?: number | string;
  description?: string;
}

declare interface TripPlanPlace {
  name: string;
  details?: string;
  image_url?: string;
  geo_coordinates?: { latitude: number; longitude: number };
  ticket_price?: string;
  time_to_travel?: string;
}

declare interface TripPlan {
  trip_plan: {
    location?: string;
    duration?: string;
    group_size?: string;
    budget?: string;
    flight_details?: TripPlanFlightDetails;
    hotel?: { options: TripPlanHotelOption[] };
    places_to_visit?: TripPlanPlace[];
  };
}

declare interface TripRecord {
  userEmail?: string | null;
  tripPlan: TripPlan;
  tripData: string;
  docId: string;
}
