const { GoogleGenerativeAI } = require("@google/generative-ai");

const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
});

const generationConfig = {
  temperature: 1,
  topP: 0.95,
  topK: 64,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
};

const chatSession: {
  sendMessage: (prompt: string) => Promise<{ response: { text: () => string } }>;
} = model.startChat({
  generationConfig,
  history: [
    {
      role: "user",
      parts: [
        {
          text: 'Generate a trip plan for the following data: Location - Lucknow, Uttar Pradesh, India. 3 Day(s) and 2 Night(s), for a group size of Couple (2 people), with a Luxury Budget. Include Flight Details, Flight Price with Booking URL, a list of hotel options with Hotel Name, Hotel Address, Price, Hotel Image URL, Geo Coordinates, Rating, Description, and Places to visit nearby with Place Name, Place Details, Place Image URL, Geo Coordinates, Ticket Price, Time to Travel to each of the location. Make sure you give this plan in JSON format.',
        },
      ],
    },
    {
      role: "model",
      parts: [
        {
          text: '{"trip_plan":{"location":"Lucknow, Uttar Pradesh, India","duration":"3 Days and 2 Nights","group_size":"Couple (2 people)","budget":"Luxury"}}',
        },
      ],
    },
  ],
});

export { chatSession };
