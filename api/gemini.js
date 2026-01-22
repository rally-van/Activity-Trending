import { GoogleGenAI } from "@google/genai";

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const apiKey = process.env.API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'Server Configuration Error: API_KEY is missing.' });
  }

  try {
    const { contents, config, model } = req.body;

    // Initialize the SDK server-side with the secure key
    const ai = new GoogleGenAI({ apiKey });
    
    // Call the model
    const response = await ai.models.generateContent({
      model: model || 'gemini-3-flash-preview',
      contents: contents,
      config: config
    });

    // Return the result
    return res.status(200).json({ text: response.text });

  } catch (error) {
    console.error('Gemini API Error:', error);
    return res.status(500).json({ 
      error: 'Failed to generate content', 
      details: error.message 
    });
  }
}