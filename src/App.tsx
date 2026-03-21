/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc,
  getDocs,
  where,
  setDoc,
  getDoc,
  getDocFromServer
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signIn, logOut } from './firebase';
import { Message, ChatSession, UserProfile } from './types';
import { 
  generateChatResponse, 
  generateImage, 
  generateSpeech, 
  generateVideo,
  generatePDFContent 
} from './services/gemini';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

import { 
  Send, 
  Plus, 
  Image as ImageIcon, 
  LogOut, 
  MessageSquare, 
  User as UserIcon, 
  Bot, 
  Loader2,
  Trash2,
  Menu,
  X,
  Sparkles,
  Volume2,
  VolumeX,
  Settings,
  Download,
  Save,
  Video,
  FileText,
  Target,
  ShieldAlert
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import ReactMarkdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile>({ role: '', interests: '', bio: '' });
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<{ data: string; mimeType: string; name: string } | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [focusTopic, setFocusTopic] = useState('');
  const [isFocusTopicModalOpen, setIsFocusTopicModalOpen] = useState(false);
  const [isKeySelectionNeeded, setIsKeySelectionNeeded] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    }
    testConnection();

    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        // Fetch user profile
        try {
          const profileDoc = await getDoc(doc(db, 'users', u.uid, 'profile', 'data'));
          if (profileDoc.exists()) {
            setUserProfile(profileDoc.data() as UserProfile);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${u.uid}/profile/data`);
        }
      } else {
        setSessions([]);
        setCurrentSessionId(null);
        setMessages([]);
        setUserProfile({ role: '', interests: '', bio: '' });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessionList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as ChatSession[];
      setSessions(sessionList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'sessions');
    });

    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (!currentSessionId) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, 'sessions', currentSessionId, 'messages'),
      orderBy('createdAt', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messageList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Message[];
      setMessages(messageList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `sessions/${currentSessionId}/messages`);
    });

    return () => unsubscribe();
  }, [currentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handlePlayAudio = async (message: Message) => {
    if (playingAudioId === message.id) {
      audioRef.current?.pause();
      setPlayingAudioId(null);
      return;
    }

    try {
      setPlayingAudioId(message.id!);
      const audioUrl = await generateSpeech(message.content);
      if (audioUrl) {
        if (audioRef.current) {
          audioRef.current.src = audioUrl;
          audioRef.current.play();
        } else {
          const audio = new Audio(audioUrl);
          audioRef.current = audio;
          audio.play();
        }
        audioRef.current!.onended = () => setPlayingAudioId(null);
      } else {
        setPlayingAudioId(null);
      }
    } catch (error) {
      console.error("Audio error:", error);
      setPlayingAudioId(null);
    }
  };

  const createNewSession = async () => {
    if (!user) return;
    const newSession = {
      userId: user.uid,
      title: 'New Chat',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    try {
      const docRef = await addDoc(collection(db, 'sessions'), newSession);
      setCurrentSessionId(docRef.id);
      setIsSidebarOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'sessions');
    }
  };

  const saveProfile = async () => {
    if (!user) return;
    const path = `users/${user.uid}/profile/data`;
    try {
      await setDoc(doc(db, path), userProfile);
      setIsProfileModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const downloadImage = async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error("Download error:", error);
    }
  };

  const resizeImage = (base64Str: string, maxWidth = 800, maxHeight = 800): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64Str;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7)); // Compress to 70% quality
      };
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      setSelectedFile({
        data: base64,
        mimeType: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (currentSessionId) {
      const session = sessions.find(s => s.id === currentSessionId);
      if (session) {
        setFocusMode(session.focusMode || false);
        setFocusTopic(session.focusTopic || '');
      }
    }
  }, [currentSessionId, sessions]);

  const handleToggleFocusMode = async () => {
    if (!currentSessionId) return;
    const newFocusMode = !focusMode;
    setFocusMode(newFocusMode);
    
    if (newFocusMode && !focusTopic) {
      setIsFocusTopicModalOpen(true);
    } else {
      await updateDoc(doc(db, 'sessions', currentSessionId), { focusMode: newFocusMode });
    }
  };

  const handleSetFocusTopic = async (topic: string) => {
    if (!currentSessionId) return;
    setFocusTopic(topic);
    setIsFocusTopicModalOpen(false);
    await updateDoc(doc(db, 'sessions', currentSessionId), { 
      focusMode: true,
      focusTopic: topic 
    });
  };

  const handleGeneratePDF = async (topic: string) => {
    if (!currentSessionId || !user) return;
    setIsLoading(true);
    try {
      const content = await generatePDFContent(topic);
      if (!content) throw new Error("Failed to generate PDF content");

      const imageResult = await generateImage(content.imagePrompt);
      
      const doc = new jsPDF();
      doc.setFontSize(22);
      doc.text(content.title, 20, 20);
      
      doc.setFontSize(12);
      const splitText = doc.splitTextToSize(content.content, 170);
      doc.text(splitText, 20, 40);

      if (imageResult.imageUrl) {
        doc.addImage(imageResult.imageUrl, 'PNG', 20, 150, 170, 100);
      }

      const pdfBlob = doc.output('blob');
      const pdfUrl = URL.createObjectURL(pdfBlob);

      const botMessage: Message = {
        role: 'model',
        content: `I've generated a PDF for you about "${topic}".`,
        type: 'pdf',
        pdfUrl: pdfUrl,
        fileName: `${topic.replace(/\s+/g, '_')}.pdf`,
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, 'sessions', currentSessionId, 'messages'), botMessage);
    } catch (error) {
      console.error("PDF Generation Error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async (e?: React.FormEvent, type: 'text' | 'image' | 'video' | 'pdf' = 'text') => {
    if (e) e.preventDefault();
    const trimmedInput = input.trim();
    if ((!trimmedInput && !selectedFile) || !user || isLoading) return;

    let actualType = type;
    const lowerInput = trimmedInput.toLowerCase();
    
    if (lowerInput.includes('generate video') || lowerInput.includes('make a video') || lowerInput.includes('create video')) {
      actualType = 'video';
      // Check for API key for Veo
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          setIsKeySelectionNeeded(true);
          return;
        }
      }
    } else if (lowerInput.includes('generate image') || lowerInput.includes('imagine image') || lowerInput.includes('create image')) {
      actualType = 'image';
    } else if (lowerInput.includes('generate pdf') || lowerInput.includes('make a pdf') || lowerInput.includes('create pdf')) {
      actualType = 'pdf';
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      const newSession = {
        userId: user.uid,
        title: trimmedInput ? (trimmedInput.slice(0, 30) + (trimmedInput.length > 30 ? '...' : '')) : (selectedFile?.name || 'New Chat'),
        focusMode: focusMode,
        focusTopic: focusTopic,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'sessions'), newSession);
      sessionId = docRef.id;
      setCurrentSessionId(sessionId);
    }

    const userMessage: any = {
      role: 'user',
      content: trimmedInput || (selectedFile ? `Uploaded file: ${selectedFile.name}` : ''),
      type: selectedFile ? 'file' : 'text',
      createdAt: serverTimestamp(),
    };

    if (selectedFile) {
      userMessage.fileData = selectedFile.data;
      userMessage.fileMimeType = selectedFile.mimeType;
      userMessage.fileName = selectedFile.name;
    }

    const currentFile = selectedFile;
    setSelectedFile(null);
    setInput('');
    setIsLoading(true);

    try {
      await addDoc(collection(db, 'sessions', sessionId, 'messages'), userMessage);
      await updateDoc(doc(db, 'sessions', sessionId), { updatedAt: serverTimestamp() });

      if (actualType === 'image' && !currentFile) {
        const result = await generateImage(trimmedInput);
        if (result.imageUrl) {
          const compressedImageUrl = await resizeImage(result.imageUrl);
          const botMessage: Message = {
            role: 'model',
            content: `Generated image for: ${trimmedInput}`,
            type: 'image',
            imageUrl: compressedImageUrl,
            createdAt: serverTimestamp(),
          };
          await addDoc(collection(db, 'sessions', sessionId, 'messages'), botMessage);
        } else {
          const botMessage: Message = {
            role: 'model',
            content: result.error || 'Sorry, I could not generate the image.',
            type: 'text',
            createdAt: serverTimestamp(),
          };
          await addDoc(collection(db, 'sessions', sessionId, 'messages'), botMessage);
        }
      } else if (actualType === 'video' && !currentFile) {
        const result = await generateVideo(trimmedInput);
        if (result.videoUrl) {
          const botMessage: Message = {
            role: 'model',
            content: `Generated video for: ${trimmedInput}`,
            type: 'video',
            videoUrl: result.videoUrl,
            createdAt: serverTimestamp(),
          };
          await addDoc(collection(db, 'sessions', sessionId, 'messages'), botMessage);
        } else {
          if ((result as any).needsKeyReset) {
            setIsKeySelectionNeeded(true);
          }
          const botMessage: Message = {
            role: 'model',
            content: result.error || 'Sorry, I could not generate the video.',
            type: 'text',
            createdAt: serverTimestamp(),
          };
          await addDoc(collection(db, 'sessions', sessionId, 'messages'), botMessage);
        }
      } else if (actualType === 'pdf' && !currentFile) {
        await handleGeneratePDF(trimmedInput.replace(/generate pdf|make a pdf|create pdf/gi, '').trim() || 'General Topic');
      } else {
        const history = messages.map(m => ({
          role: m.role,
          parts: m.type === 'file' ? [
            { text: m.content },
            { inlineData: { data: m.fileData?.split(',')[1] || m.fileData, mimeType: m.fileMimeType } }
          ] : [{ text: m.content }]
        }));
        const aiResponse = await generateChatResponse(
          trimmedInput || (currentFile ? `Please analyze this file: ${currentFile.name}` : ''), 
          history, 
          userProfile,
          currentFile ? { data: currentFile.data, mimeType: currentFile.mimeType } : undefined,
          { active: focusMode, topic: focusTopic }
        );
        const botMessage: Message = {
          role: 'model',
          content: aiResponse || 'Sorry, I could not generate a response.',
          type: 'text',
          createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, 'sessions', sessionId, 'messages'), botMessage);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `sessions/${sessionId}/messages`);
    } finally {
      setIsLoading(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#050505] flex flex-col items-center justify-center p-4 text-white font-sans">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-8 max-w-md"
        >
          <div className="relative inline-block">
            <div className="absolute -inset-4 bg-emerald-500/20 blur-2xl rounded-full" />
            <Sparkles className="w-20 h-20 text-emerald-500 relative" />
          </div>
          <h1 className="text-6xl font-black tracking-tighter uppercase italic">
            Shubhjeet AI
          </h1>
          <p className="text-zinc-400 text-lg font-medium leading-relaxed">
            Your intelligent companion for creative chat and instant image generation.
          </p>
          <button
            onClick={signIn}
            className="w-full py-4 bg-white text-black font-bold rounded-2xl hover:bg-emerald-500 hover:text-white transition-all duration-300 flex items-center justify-center gap-3 group"
          >
            <UserIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
            Sign in with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0A0A0A] text-zinc-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className="fixed inset-y-0 left-0 z-50 w-72 bg-[#111111] border-r border-white/5 flex flex-col md:relative"
          >
            <div className="p-4 flex items-center justify-between">
              <h2 className="text-xl font-black tracking-tighter uppercase italic text-emerald-500">
                Shubhjeet
              </h2>
              <button onClick={() => setIsSidebarOpen(false)} className="md:hidden">
                <X className="w-6 h-6" />
              </button>
            </div>

            <button
              onClick={createNewSession}
              className="mx-4 mb-4 p-3 bg-white/5 border border-white/10 rounded-xl flex items-center gap-3 hover:bg-white/10 transition-colors"
            >
              <Plus className="w-5 h-5" />
              <span className="font-semibold text-sm">New Chat</span>
            </button>

            <div className="flex-1 overflow-y-auto px-2 space-y-1">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setCurrentSessionId(s.id);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={cn(
                    "w-full p-3 rounded-xl flex items-center gap-3 text-left transition-all group",
                    currentSessionId === s.id ? "bg-emerald-500/10 text-emerald-500" : "hover:bg-white/5 text-zinc-400"
                  )}
                >
                  <MessageSquare className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium truncate">{s.title}</span>
                </button>
              ))}
            </div>

            <div className="p-4 border-t border-white/5 space-y-2">
              <button
                onClick={() => setIsProfileModalOpen(true)}
                className="w-full p-2 text-zinc-400 hover:text-emerald-500 flex items-center gap-2 text-sm transition-colors"
              >
                <Settings className="w-4 h-4" />
                Personalize AI
              </button>
              <div className="flex items-center gap-3 p-2">
                <img src={user.photoURL || ''} className="w-8 h-8 rounded-full" alt="" />
                <div className="flex-1 truncate">
                  <p className="text-sm font-bold truncate">{user.displayName}</p>
                </div>
              </div>
              <button
                onClick={logOut}
                className="w-full p-2 text-zinc-500 hover:text-red-400 flex items-center gap-2 text-sm transition-colors"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Key Selection Modal */}
      {isKeySelectionNeeded && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-3xl p-8 w-full max-w-md animate-in zoom-in-95">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-amber-500/20 rounded-2xl flex items-center justify-center">
                <ShieldAlert className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold">API Key Required</h3>
                <p className="text-sm text-zinc-500">Video generation requires a paid API key.</p>
              </div>
            </div>
            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
              To generate videos, you need to select a paid Google Cloud project API key. 
              Please visit <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" className="text-emerald-500 hover:underline">billing documentation</a> for more info.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setIsKeySelectionNeeded(false)}
                className="flex-1 p-4 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (window.aistudio) {
                    await window.aistudio.openSelectKey();
                    setIsKeySelectionNeeded(false);
                    handleSend(); // Retry sending
                  }
                }}
                className="flex-1 p-4 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all"
              >
                Select Key
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Focus Topic Modal */}
      {isFocusTopicModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-[#1A1A1A] border border-white/10 rounded-3xl p-8 w-full max-w-md animate-in zoom-in-95">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-12 h-12 bg-emerald-500/20 rounded-2xl flex items-center justify-center">
                <Target className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-xl font-bold">Focus Mode</h3>
                <p className="text-sm text-zinc-500">What should we focus on?</p>
              </div>
            </div>
            <input
              type="text"
              placeholder="e.g., Education, Coding, Fitness..."
              className="w-full bg-white/5 border border-white/10 rounded-xl p-4 mb-6 focus:outline-none focus:border-emerald-500 transition-all"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSetFocusTopic((e.target as HTMLInputElement).value);
                }
              }}
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setIsFocusTopicModalOpen(false);
                  setFocusMode(false);
                }}
                className="flex-1 p-4 bg-white/5 hover:bg-white/10 rounded-xl font-bold transition-all"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const input = document.querySelector('input[placeholder="e.g., Education, Coding, Fitness..."]') as HTMLInputElement;
                  if (input.value) handleSetFocusTopic(input.value);
                }}
                className="flex-1 p-4 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all"
              >
                Start Focus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      <AnimatePresence>
        {isProfileModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-[#111111] border border-white/10 rounded-3xl p-8 max-w-lg w-full space-y-6"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-black tracking-tighter uppercase italic text-emerald-500">
                  Personalize Shubhjeet AI
                </h2>
                <button onClick={() => setIsProfileModalOpen(false)}>
                  <X className="w-6 h-6" />
                </button>
              </div>
              <p className="text-zinc-400 text-sm">
                Tell me about yourself so I can provide better, more personalized responses.
              </p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your Role</label>
                  <input
                    type="text"
                    placeholder="e.g. Coder, Student, Educator"
                    value={userProfile.role}
                    onChange={(e) => setUserProfile({ ...userProfile, role: e.target.value })}
                    className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl p-3 focus:border-emerald-500/50 outline-none text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Interests</label>
                  <input
                    type="text"
                    placeholder="e.g. AI, Space, Cooking, Gaming"
                    value={userProfile.interests}
                    onChange={(e) => setUserProfile({ ...userProfile, interests: e.target.value })}
                    className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl p-3 focus:border-emerald-500/50 outline-none text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-widest text-zinc-500">Short Bio</label>
                  <textarea
                    placeholder="Tell me a bit more about what you do..."
                    value={userProfile.bio}
                    onChange={(e) => setUserProfile({ ...userProfile, bio: e.target.value })}
                    className="w-full bg-[#1A1A1A] border border-white/10 rounded-xl p-3 focus:border-emerald-500/50 outline-none text-sm min-h-[100px] resize-none"
                  />
                </div>
              </div>
              <button
                onClick={saveProfile}
                className="w-full py-4 bg-emerald-500 text-white font-bold rounded-2xl hover:bg-emerald-400 transition-all flex items-center justify-center gap-2"
              >
                <Save className="w-5 h-5" />
                Save Personalization
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Header */}
        <header className="h-16 border-bottom border-white/5 flex items-center px-4 gap-4 bg-[#0A0A0A]/80 backdrop-blur-md sticky top-0 z-40">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className={cn("p-2 hover:bg-white/5 rounded-lg", isSidebarOpen && "hidden")}
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-sm font-bold text-zinc-400 uppercase tracking-widest">
              {currentSessionId ? sessions.find(s => s.id === currentSessionId)?.title : 'New Conversation'}
            </h1>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8">
          {messages.length === 0 && !isLoading && (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-20">
              <Bot className="w-16 h-16" />
              <p className="text-xl font-medium">How can I help you today?</p>
            </div>
          )}
          
          {messages.map((m) => (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={m.id}
              className={cn(
                "flex gap-4 max-w-3xl mx-auto",
                m.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              <div className={cn(
                "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                m.role === 'user' ? "bg-emerald-500" : "bg-zinc-800"
              )}>
                {m.role === 'user' ? <UserIcon className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
              </div>
              <div className={cn(
                "flex-1 space-y-2",
                m.role === 'user' ? "text-right" : "text-left"
              )}>
                <div className={cn(
                  "inline-block p-4 rounded-2xl text-sm leading-relaxed",
                  m.role === 'user' ? "bg-emerald-500/10 text-emerald-50" : "bg-zinc-900 text-zinc-300"
                )}>
                  {m.type === 'image' ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <p className="text-xs text-zinc-500 italic">{m.content}</p>
                        <button
                          onClick={() => downloadImage(m.imageUrl!, `shubhjeet-ai-${Date.now()}.png`)}
                          className="p-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-emerald-500 transition-all"
                          title="Download Image"
                        >
                          <Download className="w-4 h-4" />
                        </button>
                      </div>
                      <img 
                        src={m.imageUrl} 
                        className="rounded-xl w-full max-w-md border border-white/10" 
                        alt="Generated"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  ) : m.type === 'video' ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4 mb-2">
                        <p className="text-xs text-zinc-500 italic">{m.content}</p>
                      </div>
                      <video 
                        src={m.videoUrl} 
                        controls 
                        className="rounded-xl w-full max-w-md border border-white/10"
                      />
                    </div>
                  ) : m.type === 'pdf' ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/10">
                        <div className="w-12 h-12 bg-red-500/20 rounded-lg flex items-center justify-center">
                          <FileText className="w-6 h-6 text-red-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{m.fileName}</p>
                          <p className="text-xs text-zinc-500">PDF Document Generated</p>
                        </div>
                        <a 
                          href={m.pdfUrl} 
                          download={m.fileName}
                          className="p-2 bg-white/5 hover:bg-white/10 rounded-lg text-zinc-400 hover:text-emerald-500 transition-all"
                        >
                          <Download className="w-5 h-5" />
                        </a>
                      </div>
                      <p className="text-sm text-zinc-400">{m.content}</p>
                    </div>
                  ) : m.type === 'file' ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                          <Plus className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold truncate">{m.fileName}</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{m.fileMimeType}</p>
                        </div>
                      </div>
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className="relative group/msg">
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                      {m.role === 'model' && (
                        <button
                          onClick={() => handlePlayAudio(m)}
                          className="absolute -right-12 top-0 p-2 text-zinc-500 hover:text-emerald-500 transition-colors opacity-0 group-hover/msg:opacity-100"
                        >
                          {playingAudioId === m.id ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
          {isLoading && (
            <div className="flex gap-4 max-w-3xl mx-auto">
              <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center animate-pulse">
                <Bot className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="inline-block p-4 rounded-2xl bg-zinc-900">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 md:p-8 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A] to-transparent">
          <div className="max-w-3xl mx-auto mb-4 flex items-center justify-between px-2">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleFocusMode}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${focusMode ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${focusMode ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <span className={`text-xs font-medium ${focusMode ? 'text-emerald-500' : 'text-zinc-500'}`}>
                  Focus Mode {focusMode ? `(${focusTopic})` : 'Off'}
                </span>
              </div>
            </div>
            <div className="text-[10px] text-zinc-600 font-medium uppercase tracking-widest flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3" />
              Shubhjeet AI can make mistakes
            </div>
          </div>
          
          {selectedFile && (
            <div className="max-w-3xl mx-auto mb-4 flex items-center gap-3 p-3 bg-[#1A1A1A] border border-emerald-500/30 rounded-2xl animate-in fade-in slide-in-from-bottom-2">
              <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                <Plus className="w-5 h-5 text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{selectedFile.name}</p>
                <p className="text-[10px] text-zinc-500 uppercase tracking-widest">{selectedFile.mimeType}</p>
              </div>
              <button 
                onClick={() => setSelectedFile(null)}
                className="p-2 hover:bg-white/5 rounded-full text-zinc-500 hover:text-red-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <form 
            onSubmit={(e) => handleSend(e)}
            className="max-w-3xl mx-auto relative group"
          >
            <input 
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
              accept="image/*,application/pdf,text/*"
            />
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Ask Shubhjeet AI anything..."
              className="w-full bg-[#1A1A1A] border border-white/10 rounded-2xl p-4 pl-14 pr-32 min-h-[60px] max-h-48 resize-none focus:outline-none focus:border-emerald-500/50 transition-all text-sm"
              rows={1}
            />
            <div className="absolute left-2 bottom-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-zinc-500 hover:text-emerald-500 transition-colors"
                title="Upload File"
              >
                <Plus className="w-6 h-6" />
              </button>
            </div>
            <div className="absolute right-2 bottom-2 flex gap-2">
              <button
                type="button"
                onClick={() => handleSend(undefined, 'image')}
                disabled={isLoading || !input.trim()}
                className="p-2 text-zinc-500 hover:text-emerald-500 disabled:opacity-50 transition-colors"
                title="Generate Image"
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-400 disabled:opacity-50 transition-all"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
          </form>
          <p className="text-center text-[10px] text-zinc-600 mt-4 uppercase tracking-[0.2em]">
            Shubhjeet AI v1.1 • Created by Shubhjeet
          </p>
        </div>
      </main>
    </div>
  );
}
