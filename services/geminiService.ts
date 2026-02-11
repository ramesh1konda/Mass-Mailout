
import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export const generateEmailTemplate = async (campaignName: string, goal: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Generate a professional email template for a campaign titled "${campaignName}". The goal of the email is: ${goal}. Use placeholders like {{name}} for the recipient's name. Provide a subject line and the body.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING }
          },
          required: ["subject", "body"]
        }
      }
    });

    // Fix: Access .text property directly and trim it before parsing as recommended in guidelines
    const jsonStr = response.text?.trim();
    if (!jsonStr) return null;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error generating template:", error);
    return null;
  }
};

export const refineTemplate = async (subject: string, body: string, instruction: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Refine the following email based on this instruction: "${instruction}".\n\nSubject: ${subject}\nBody: ${body}\n\nMaintain placeholders like {{name}}.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            subject: { type: Type.STRING },
            body: { type: Type.STRING }
          },
          required: ["subject", "body"]
        }
      }
    });

    // Fix: Access .text property directly and trim it before parsing as recommended in guidelines
    const jsonStr = response.text?.trim();
    if (!jsonStr) return null;
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Error refining template:", error);
    return null;
  }
};
