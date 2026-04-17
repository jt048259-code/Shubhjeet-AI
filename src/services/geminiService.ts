import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface TimetableEntry {
  class: string;
  subject: string;
  teacherName: string;
  teacherId: string;
  day: string;
  bell: number;
}

export interface SubjectRequirement {
  class: string;
  subject: string;
  frequencyPerWeek: number;
}

export const generateTimetableAI = async (
  teachers: { uid: string; name: string; subjects: string[]; classes: string[] }[],
  requirements: SubjectRequirement[]
): Promise<TimetableEntry[]> => {
  const prompt = `
    Generate a school weekly timetable (Monday to Saturday) based on the following data:
    
    Teachers:
    ${JSON.stringify(teachers, null, 2)}
    
    Subject Requirements per Class:
    ${JSON.stringify(requirements, null, 2)}
    
    Constraints:
    1. Max 6 bells per teacher per day.
    2. A teacher can only teach their assigned subjects and classes.
    3. No two classes can have the same teacher at the same time (bell).
    4. Each class should have 6 bells per day.
    5. Try to distribute subjects evenly across the week.
    
    Return the result as a JSON array of objects with the following structure:
    {
      "class": "string",
      "subject": "string",
      "teacherName": "string",
      "teacherId": "string",
      "day": "string (Monday, Tuesday, etc.)",
      "bell": number (1-6)
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            class: { type: Type.STRING },
            subject: { type: Type.STRING },
            teacherName: { type: Type.STRING },
            teacherId: { type: Type.STRING },
            day: { type: Type.STRING },
            bell: { type: Type.NUMBER }
          },
          required: ["class", "subject", "teacherName", "teacherId", "day", "bell"]
        }
      }
    }
  });

  return JSON.parse(response.text);
};

export const suggestSubstitutionAI = async (
  absentTeacher: { name: string; subjects: string[]; classes: string[] },
  freeTeachers: { name: string; subjects: string[]; classes: string[] }[],
  timetableToday: TimetableEntry[]
): Promise<{ bell: number; class: string; originalSubject: string; suggestedTeacher: string; reason: string }[]> => {
  const prompt = `
    Suggest substitutions for an absent teacher today.
    
    Absent Teacher: ${absentTeacher.name}
    Absent Teacher's Schedule Today: ${JSON.stringify(timetableToday.filter(t => t.teacherName === absentTeacher.name), null, 2)}
    
    Available (Free) Teachers: ${JSON.stringify(freeTeachers, null, 2)}
    
    Rules:
    1. For each bell the absent teacher was supposed to teach, suggest a free teacher.
    2. Prefer teachers who teach the same subject or class.
    3. If no perfect match, suggest any free teacher for "Arrangement".
    
    Return a JSON array:
    {
      "bell": number,
      "class": "string",
      "originalSubject": "string",
      "suggestedTeacher": "string",
      "reason": "string"
    }
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            bell: { type: Type.NUMBER },
            class: { type: Type.STRING },
            originalSubject: { type: Type.STRING },
            suggestedTeacher: { type: Type.STRING },
            reason: { type: Type.STRING }
          },
          required: ["bell", "class", "originalSubject", "suggestedTeacher", "reason"]
        }
      }
    }
  });

  return JSON.parse(response.text);
};
