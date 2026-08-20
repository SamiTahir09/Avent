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
  // gemini-2.5-flash reasons before it answers, and those thinking tokens are
  // billed against maxOutputTokens. At the old 8192 a long itinerary could
  // spend the whole budget thinking and come back with an empty or half-written
  // body — which the SDK reports as a *success*, so it only blew up later at
  // JSON.parse with "Unexpected end of JSON input". gemini-1.5-flash had no
  // thinking, so this only became reachable when the model was bumped.
  maxOutputTokens: 32768,
  responseMimeType: "application/json",
  // Absent from @google/generative-ai 0.21.0's types — that SDK is the legacy
  // one and predates thinking. It serialises generationConfig verbatim into the
  // request body though, so v1beta still honours this and skips thinking
  // entirely. The raised ceiling above stays as the belt to this braces.
  thinkingConfig: { thinkingBudget: 0 },
};

/**
 * Only the parts of the SDK response we actually read. `candidates` matters
 * because MAX_TOKENS is *not* one of the finish reasons the SDK treats as
 * fatal (it only throws on RECITATION, SAFETY and LANGUAGE), so a truncated
 * response has to be caught by the caller.
 */
export type GeminiResult = {
  response: {
    text: () => string;
    candidates?: Array<{ finishReason?: string }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      totalTokenCount?: number;
    };
  };
};

const chatSession: {
  sendMessage: (prompt: string) => Promise<GeminiResult>;
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
