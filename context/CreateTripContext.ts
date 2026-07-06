import { createContext } from "react";

interface TripContextType {
  tripData: TripDataItem[];
  setTripData: React.Dispatch<React.SetStateAction<TripDataItem[]>>;
}

export const CreateTripContext = createContext<TripContextType>({
  tripData: [],
  setTripData: () => {},
});