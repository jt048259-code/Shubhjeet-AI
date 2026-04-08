export interface Message {
  id?: string;
  role: 'user' | 'model';
  content: string;
  type: 'text' | 'image' | 'file' | 'video' | 'pdf';
  imageUrl?: string;
  videoUrl?: string;
  pdfUrl?: string;
  fileData?: string;
  fileMimeType?: string;
  fileName?: string;
  createdAt: any;
}

export interface ChatSession {
  id: string;
  userId: string;
  title: string;
  focusMode?: boolean;
  focusTopic?: string;
  createdAt: any;
  updatedAt: any;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
  interface ImportMeta {
    readonly env: {
      readonly [key: string]: string | boolean | undefined;
      readonly VITE_GEMINI_API_KEY?: string;
    };
  }
}


export interface UserProfile {
  role: string;
  interests: string;
  bio: string;
}
