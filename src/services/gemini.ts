import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY!;
const ai = new GoogleGenAI({ apiKey });

export const generateChatResponse = async (
  prompt: string, 
  history: { role: string; parts: any[] }[], 
  userProfile?: any,
  file?: { data: string; mimeType: string },
  focusMode?: { active: boolean; topic: string }
) => {
  const model = "gemini-3-flash-preview";
  
  let personalization = "";
  if (userProfile) {
    personalization = `The user has provided some information about themselves:
- Role: ${userProfile.role || 'Not specified'}
- Interests: ${userProfile.interests || 'Not specified'}
- Bio: ${userProfile.bio || 'Not specified'}
Please use this information to personalize your responses and make them more relevant to the user.`;
  }

  let focusInstruction = "";
  if (focusMode?.active && focusMode.topic) {
    focusInstruction = `\n\nFOCUS MODE IS ON. The user wants to focus ONLY on: "${focusMode.topic}". 
    If the user's message is NOT related to this topic, you MUST politely refuse to answer and remind them that Focus Mode is active for "${focusMode.topic}". 
    Do not engage in any off-topic conversation.`;
  }

  const chat = ai.chats.create({
    model,
    config: {
      systemInstruction: `You are Shubhjeet AI, a highly advanced and friendly AI assistant created by Shubhjeet. You must NEVER mention 'Gemini', 'Google', or any other AI model names. If asked who created you, say 'Shubhjeet'. You can chat, generate images, analyze files, and provide helpful information. When a user provides a file, analyze it and answer their questions about it.
      
      ${personalization}
      ${focusInstruction}

      CRITICAL INSTRUCTIONS:
      1. MOOD & STYLE ANALYSIS: Pay close attention to the user's tone, mood, accent, and speaking style (formal, informal, slang, regional dialect, etc.). Adjust your response style to match or support their mood and mirror their communication style to build better rapport.
      2. EMOJIS: Use relevant emojis in your responses to make them more engaging and expressive, based on the detected mood and style.
      3. PROFESSIONAL FORMATTING: If the user asks for writing tasks like notes, prompts, articles, or code, provide them in a highly structured, professional, and visually appealing format using Markdown (headers, bullet points, bold text, code blocks, etc.). Make it look "good" and easy to read.
      4. BE CONCISE YET HELPFUL: Don't over-explain unless asked, but ensure the quality of your output is top-notch.
      5. IDENTITY: You are Shubhjeet AI. Never mention Gemini or Google. If asked about your creator, say 'Shubhjeet'.`,
    },
    history,
  });

  const parts: any[] = [{ text: prompt }];
  if (file) {
    parts.push({
      inlineData: {
        data: file.data.split(',')[1] || file.data, // Strip prefix if present
        mimeType: file.mimeType,
      },
    });
  }

  const response: GenerateContentResponse = await chat.sendMessage({ message: parts });
  return response.text;
};

export const generateVideo = async (prompt: string) => {
  try {
    const currentApiKey = process.env.GEMINI_API_KEY!;
    const currentAi = new GoogleGenAI({ apiKey: currentApiKey });
    const model = 'veo-3.1-fast-generate-preview';
    
    let operation = await currentAi.models.generateVideos({
      model,
      prompt,
      config: {
        numberOfVideos: 1,
        resolution: '720p',
        aspectRatio: '16:9'
      }
    });

    while (!operation.done) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      operation = await currentAi.operations.getVideosOperation({ operation: operation });
    }

    const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (downloadLink) {
      const response = await fetch(downloadLink, {
        method: 'GET',
        headers: {
          'x-goog-api-key': currentApiKey,
        },
      });
      const blob = await response.blob();
      return { videoUrl: URL.createObjectURL(blob) };
    }
  } catch (error: any) {
    console.error("Video Generation Error:", error);
    if (error.message?.includes("Requested entity was not found")) {
      return { error: "API Key error. Please try selecting your API key again.", needsKeyReset: true };
    }
    return { error: error instanceof Error ? error.message : "An unknown error occurred during video generation." };
  }
  return { error: "Failed to generate video: No video data returned." };
};

export const generatePDFContent = async (topic: string) => {
  const model = "gemini-3-flash-preview";
  const response = await ai.models.generateContent({
    model,
    contents: `The user wants to generate a PDF about: "${topic}". 
    Please provide:
    1. A professional title for the PDF.
    2. A detailed and well-formatted text content for the page (about 200-300 words).
    3. A specific image prompt (max 50 words) that describes a visual to go with this content.
    
    Return the response in JSON format with keys: "title", "content", "imagePrompt".`,
    config: {
      responseMimeType: "application/json",
    }
  });
  
  try {
    return JSON.parse(response.text);
  } catch (e) {
    return null;
  }
};

export const generateImage = async (prompt: string) => {
  try {
    const model = "gemini-2.5-flash-image";
    const response = await ai.models.generateContent({
      model,
      contents: {
        parts: [
          {
            text: prompt,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "1:1",
        },
      },
    });

    let textResponse = "";
    for (const part of response.candidates?.[0]?.content?.parts || []) {
      if (part.inlineData) {
        const base64EncodeString: string = part.inlineData.data;
        return { imageUrl: `data:image/png;base64,${base64EncodeString}` };
      }
      if (part.text) {
        textResponse += part.text;
      }
    }
    
    if (textResponse) {
      return { error: textResponse };
    }
  } catch (error) {
    console.error("Image Generation Error:", error);
    return { error: error instanceof Error ? error.message : "An unknown error occurred during image generation." };
  }
  return { error: "Failed to generate image: No image data returned." };
};

export const generateSpeech = async (text: string) => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return `data:audio/mp3;base64,${base64Audio}`;
    }
  } catch (error) {
    console.error("TTS Error:", error);
  }
  return null;
};
