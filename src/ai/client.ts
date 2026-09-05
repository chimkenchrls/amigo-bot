import { GoogleGenAI } from "@google/genai";

export function createGenAI(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}
