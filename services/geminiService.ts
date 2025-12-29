import { GoogleGenAI } from "@google/genai";
import { StravaActivity } from '../types';

// Initialize directly with process.env.API_KEY as per guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateFitnessInsight = async (
  activities: StravaActivity[],
  userQuery: string
) => {
  // Summarize data to reduce token count
  const summary = activities.slice(0, 50).map(a => ({
    date: a.start_date.split('T')[0],
    type: a.type,
    dist: (a.distance / 1000).toFixed(2) + 'km',
    elev: a.total_elevation_gain + 'm',
    time: (a.moving_time / 60).toFixed(0) + 'min',
    name: a.name
  }));

  const systemInstruction = `
    You are an elite endurance sports coach and data analyst. 
    You are analyzing a JSON summary of the user's recent 50 activities.
    Provide concise, actionable, and encouraging feedback.
    If the user asks about trends, look at the dates and distances.
    If the user asks for comparison, compare different activity types.
    Output should be valid Markdown.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `
        Context Data (Recent 50 Activities): ${JSON.stringify(summary)}
        
        User Question: ${userQuery}
      `,
      config: {
        systemInstruction: systemInstruction,
        thinkingConfig: { thinkingBudget: 0 } // Speed over deep reasoning for dashboard chat
      }
    });

    return response.text;
  } catch (error) {
    console.error("Gemini Error:", error);
    return "I encountered an error analyzing your data. Please check your API key configuration.";
  }
};