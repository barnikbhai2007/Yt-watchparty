/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  updateDoc, 
  serverTimestamp, 
  getDoc,
  Timestamp,
  getDocFromServer,
  query,
  orderBy,
  limit,
  addDoc,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { nanoid } from 'nanoid';
import YouTube, { YouTubeProps } from 'react-youtube';
import { 
  Play, 
  Pause, 
  Users, 
  Share2, 
  LogOut, 
  Plus, 
  ArrowRight,
  Youtube as YoutubeIcon,
  Copy,
  Check,
  Search,
  Send,
  MessageSquare,
  Activity as ActivityIcon,
  X
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { GoogleGenAI, Type } from "@google/genai";
import { auth, db } from './firebase';

// --- Utils ---
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

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function extractVideoId(url: string) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

// --- AI Search ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

async function searchYouTube(query: string) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing");
      return [];
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the top 5 YouTube videos for: "${query}". 
      Return a JSON array of objects with "videoId" and "title". 
      Make sure the videoId is the correct 11-character string from the URL.
      Example: { "videoId": "dQw4w9WgXcQ", "title": "Rick Astley - Never Gonna Give You Up" }`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              videoId: { type: Type.STRING },
              title: { type: Type.STRING }
            },
            required: ["videoId", "title"]
          }
        },
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    console.log("Search response:", text);
    
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("JSON parse error:", e);
      const match = text.match(/\[.*\]/s);
      if (match) return JSON.parse(match[0]);
      return [];
    }
  } catch (error) {
    console.error("Search failed:", error);
    return [];
  }
}

async function searchSpotify(query: string) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is missing");
      return [];
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the top 5 Spotify tracks or playlists for: "${query}". 
      Return a JSON array of objects with "uri" and "title". 
      The uri should be in the format "spotify:track:ID" or "spotify:playlist:ID".
      Example: { "uri": "spotify:track:4cOdK2wGvWyR9p7Riaoffm", "title": "Never Gonna Give You Up - Rick Astley" }`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              uri: { type: Type.STRING },
              title: { type: Type.STRING }
            },
            required: ["uri", "title"]
          }
        },
        tools: [{ googleSearch: {} }]
      }
    });

    const text = response.text;
    console.log("Spotify search response:", text);
    
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("JSON parse error:", e);
      const match = text.match(/\[.*\]/s);
      if (match) return JSON.parse(match[0]);
      return [];
    }
  } catch (error) {
    console.error("Spotify search failed:", error);
    return [];
  }
}
interface RoomState {
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  lastUpdated: Timestamp;
  updatedBy: string;
  name?: string;
  mediaType: 'youtube' | 'spotify';
  spotifyUri?: string;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  timestamp: Timestamp;
}

interface Activity {
  id: string;
  type: 'join' | 'leave' | 'pause' | 'play' | 'seek' | 'change_video';
  userId: string;
  userName: string;
  timestamp: Timestamp;
  details?: string;
}

interface Participant {
  uid: string;
  displayName: string;
  lastSeen: Timestamp;
}

// --- Components ---

const Login = () => {
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div className="flex justify-center">
          <div className="p-4 bg-red-600 rounded-2xl shadow-2xl shadow-red-900/20">
            <YoutubeIcon size={48} />
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">SyncTube</h1>
          <p className="mt-2 text-zinc-400">Watch YouTube with friends, perfectly in sync.</p>
        </div>
        <button
          onClick={handleLogin}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-white text-black font-semibold rounded-xl hover:bg-zinc-200 transition-all active:scale-[0.98]"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    </div>
  );
};

const SearchModal = ({ type, onSelect, onClose }: { type: 'youtube' | 'spotify', onSelect: (id: string) => void, onClose: () => void }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    const res = type === 'youtube' ? await searchYouTube(query) : await searchSpotify(query);
    if (res.length === 0) {
      setError("No results found or search failed. Please try again.");
    }
    setResults(res);
    setLoading(false);
  };

  const isYoutube = type === 'youtube';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-zinc-900 w-full max-w-2xl rounded-3xl border border-zinc-800 overflow-hidden flex flex-col max-h-[80vh]"
      >
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Search size={20} className={isYoutube ? "text-red-500" : "text-green-500"} />
            Search {isYoutube ? "YouTube" : "Spotify"}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSearch} className="p-6 bg-zinc-950/50">
          <div className="relative">
            <input
              autoFocus
              type="text"
              placeholder={isYoutube ? "Search for videos..." : "Search for songs or playlists..."}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={cn(
                "w-full bg-zinc-900 border border-zinc-800 px-4 py-3 pl-12 rounded-xl focus:outline-none transition-colors",
                isYoutube ? "focus:border-red-600" : "focus:border-green-600"
              )}
            />
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
            <button 
              type="submit"
              disabled={loading}
              className={cn(
                "absolute right-2 top-1/2 -translate-y-1/2 px-4 py-1.5 rounded-lg text-sm font-bold disabled:opacity-50 transition-colors",
                isYoutube ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700 text-black"
              )}
            >
              {loading ? "..." : "Search"}
            </button>
          </div>
        </form>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm text-center">
              {error}
            </div>
          )}
          {results.map((item) => (
            <button
              key={isYoutube ? item.videoId : item.uri}
              onClick={() => onSelect(isYoutube ? item.videoId : item.uri)}
              className="w-full flex items-center gap-4 p-3 hover:bg-zinc-800 rounded-2xl transition-colors text-left group"
            >
              {isYoutube ? (
                <div className="w-32 aspect-video bg-zinc-800 rounded-xl overflow-hidden flex-shrink-0">
                  <img 
                    src={`https://img.youtube.com/vi/${item.videoId}/mqdefault.jpg`} 
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Plus size={24} className="text-black" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h4 className="font-bold text-zinc-200 line-clamp-2">{item.title}</h4>
                <p className="text-xs text-zinc-500 mt-1 font-mono uppercase">
                  {isYoutube ? item.videoId : item.uri}
                </p>
              </div>
            </button>
          ))}
          {!loading && results.length === 0 && query && (
            <div className="text-center py-12 text-zinc-500">No results found. Try another search.</div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const Lobby = ({ onJoinRoom }: { onJoinRoom: (id: string, type: 'youtube' | 'spotify') => void }) => {
  const [roomId, setRoomId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [lobbyType, setLobbyType] = useState<'youtube' | 'spotify'>('youtube');

  const handleCreateRoom = async (vid?: string) => {
    const finalVid = vid || (lobbyType === 'youtube' ? extractVideoId(videoUrl) : videoUrl);
    if (!finalVid && lobbyType === 'youtube') {
      alert("Please enter a valid YouTube URL or use search");
      return;
    }

    const newRoomId = nanoid(10);
    const roomRef = doc(db, 'rooms', newRoomId);
    
    try {
      await setDoc(roomRef, {
        videoId: lobbyType === 'youtube' ? (finalVid || "") : "",
        spotifyUri: lobbyType === 'spotify' ? (finalVid || "") : "",
        currentTime: 0,
        isPlaying: false,
        lastUpdated: serverTimestamp(),
        updatedBy: auth.currentUser?.uid,
        name: lobbyType === 'youtube' ? "YouTube Party" : "Spotify Jam",
        mediaType: lobbyType
      });
      onJoinRoom(newRoomId, lobbyType);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rooms/${newRoomId}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 flex flex-col items-center justify-center">
      {isSearching && (
        <SearchModal 
          type={lobbyType}
          onSelect={(id) => {
            setIsSearching(false);
            handleCreateRoom(id);
          }} 
          onClose={() => setIsSearching(false)} 
        />
      )}
      <div className="max-w-4xl w-full space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-6xl font-black tracking-tighter italic">
            <span className="text-white">SYNC</span>
            <span className={cn(lobbyType === 'youtube' ? "text-red-600" : "text-green-500")}>
              {lobbyType === 'youtube' ? "TUBE" : "JAM"}
            </span>
          </h1>
          <div className="flex justify-center gap-4">
            <button 
              onClick={() => setLobbyType('youtube')}
              className={cn(
                "px-6 py-2 rounded-full font-bold transition-all border-2",
                lobbyType === 'youtube' ? "bg-red-600 border-red-600 text-white" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
              )}
            >
              YOUTUBE
            </button>
            <button 
              onClick={() => setLobbyType('spotify')}
              className={cn(
                "px-6 py-2 rounded-full font-bold transition-all border-2",
                lobbyType === 'spotify' ? "bg-green-500 border-green-500 text-white" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
              )}
            >
              SPOTIFY
            </button>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Create Room */}
          <div className={cn(
            "bg-zinc-900/50 border p-8 rounded-3xl space-y-6 transition-colors",
            lobbyType === 'youtube' ? "border-red-900/30" : "border-green-900/30"
          )}>
            <div className="flex items-center gap-3">
              <Plus size={24} className={lobbyType === 'youtube' ? "text-red-500" : "text-green-500"} />
              <h2 className="text-xl font-bold">Create {lobbyType === 'youtube' ? "Room" : "Jam"}</h2>
            </div>
            <div className="space-y-4">
              <input
                type="text"
                placeholder={lobbyType === 'youtube' ? "YouTube URL" : "Spotify Track/Playlist URL"}
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
              />
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setIsSearching(true)}
                  className="py-3 bg-zinc-800 hover:bg-zinc-700 font-bold rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Search size={18} />
                  Search
                </button>
                <button
                  onClick={() => handleCreateRoom()}
                  className={cn(
                    "py-3 font-bold rounded-xl transition-all",
                    lobbyType === 'youtube' ? "bg-red-600 hover:bg-red-700" : "bg-green-500 hover:bg-green-600",
                    lobbyType === 'youtube' ? "" : "text-black"
                  )}
                >
                  {lobbyType === 'youtube' ? "Start" : "Start Jam"}
                </button>
              </div>
            </div>
          </div>

          {/* Join Room */}
          <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-6">
            <div className="flex items-center gap-3 text-zinc-400">
              <ArrowRight size={24} />
              <h2 className="text-xl font-bold">Join Existing</h2>
            </div>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Enter ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
              />
              <button
                onClick={() => roomId && onJoinRoom(roomId, 'youtube')} // Type doesn't matter for join
                className="w-full py-3 bg-zinc-100 text-black hover:bg-white font-bold rounded-xl transition-all active:scale-[0.98]"
              >
                Join Party
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Room = ({ roomId, onLeave }: { roomId: string; onLeave: () => void }) => {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [player, setPlayer] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'activity'>('chat');
  
  const isUpdatingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- Presence & Activity ---
  useEffect(() => {
    if (!auth.currentUser) return;
    
    const participantRef = doc(db, 'rooms', roomId, 'participants', auth.currentUser.uid);
    const updatePresence = async () => {
      await setDoc(participantRef, {
        uid: auth.currentUser?.uid,
        displayName: auth.currentUser?.displayName,
        lastSeen: serverTimestamp()
      }, { merge: true });
    };

    updatePresence();
    const interval = setInterval(updatePresence, 30000); // Update every 30s

    const addActivity = async (type: Activity['type'], details?: string) => {
      const activitiesRef = collection(db, 'rooms', roomId, 'activities');
      await addDoc(activitiesRef, {
        type,
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName,
        timestamp: serverTimestamp(),
        details
      });
    };

    addActivity('join');

    return () => {
      clearInterval(interval);
      deleteDoc(participantRef);
      addActivity('leave');
    };
  }, [roomId]);

  // --- Subscriptions ---
  useEffect(() => {
    const roomRef = doc(db, 'rooms', roomId);
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const activitiesRef = collection(db, 'rooms', roomId, 'activities');
    const participantsRef = collection(db, 'rooms', roomId, 'participants');

    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as RoomState;
        setRoom(data);
        if (data.updatedBy !== auth.currentUser?.uid && player) {
          isUpdatingRef.current = true;
          if (data.isPlaying) player.playVideo(); else player.pauseVideo();
          const localTime = player.getCurrentTime();
          if (Math.abs(localTime - data.currentTime) > 2) player.seekTo(data.currentTime, true);
          setTimeout(() => { isUpdatingRef.current = false; }, 500);
        }
      } else {
        onLeave();
      }
    });

    const unsubMessages = onSnapshot(query(messagesRef, orderBy('timestamp', 'asc'), limit(50)), (snapshot) => {
      setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    });

    const unsubActivities = onSnapshot(query(activitiesRef, orderBy('timestamp', 'desc'), limit(20)), (snapshot) => {
      setActivities(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Activity)));
    });

    const unsubParticipants = onSnapshot(participantsRef, (snapshot) => {
      setParticipants(snapshot.docs.map(d => d.data() as Participant));
    });

    return () => {
      unsubRoom();
      unsubMessages();
      unsubActivities();
      unsubParticipants();
    };
  }, [roomId, player, onLeave]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateRoomState = async (updates: Partial<RoomState>) => {
    if (isUpdatingRef.current) return;
    const roomRef = doc(db, 'rooms', roomId);
    try {
      await updateDoc(roomRef, {
        ...updates,
        lastUpdated: serverTimestamp(),
        updatedBy: auth.currentUser?.uid
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `rooms/${roomId}`);
    }
  };

  const addActivity = async (type: Activity['type'], details?: string) => {
    if (!auth.currentUser) return;
    const activitiesRef = collection(db, 'rooms', roomId, 'activities');
    try {
      await addDoc(activitiesRef, {
        type,
        userId: auth.currentUser.uid,
        userName: auth.currentUser.displayName || 'Anonymous',
        timestamp: serverTimestamp(),
        details: details || ''
      });
    } catch (error) {
      console.error("Failed to add activity:", error);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    await addDoc(messagesRef, {
      text: chatInput,
      senderId: auth.currentUser?.uid,
      senderName: auth.currentUser?.displayName,
      timestamp: serverTimestamp()
    });
    setChatInput('');
  };

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target);
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    if (isUpdatingRef.current) return;
    const newState = event.data;
    const isPlaying = newState === YouTube.PlayerState.PLAYING;
    const currentTime = event.target.getCurrentTime();

    if (newState === YouTube.PlayerState.PLAYING) {
      updateRoomState({ isPlaying, currentTime });
      addActivity('play');
    } else if (newState === YouTube.PlayerState.PAUSED) {
      updateRoomState({ isPlaying, currentTime });
      addActivity('pause');
    } else if (newState === YouTube.PlayerState.BUFFERING) {
      // Potentially a skip or seek
      const diff = Math.abs(currentTime - (room?.currentTime || 0));
      if (diff > 2) {
        updateRoomState({ currentTime });
        addActivity('seek', `to ${Math.floor(currentTime)}s`);
      }
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!room) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white">Loading Party...</div>;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col h-screen overflow-hidden">
      {isSearching && (
        <SearchModal 
          type={room.mediaType}
          onSelect={(id) => {
            setIsSearching(false);
            if (room.mediaType === 'youtube') {
              updateRoomState({ videoId: id, currentTime: 0, isPlaying: false });
            } else {
              updateRoomState({ spotifyUri: id });
            }
            addActivity('change_video', id);
          }} 
          onClose={() => setIsSearching(false)} 
        />
      )}

      {/* Header */}
      <header className="p-4 border-b border-zinc-900 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md z-10 shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onLeave} className="p-2 hover:bg-zinc-900 rounded-lg transition-colors">
            <LogOut size={20} className="rotate-180" />
          </button>
          <div className="hidden sm:block">
            <h2 className="font-bold text-lg leading-tight">{room.name || "Watch Party"}</h2>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">{roomId}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsSearching(true)}
            className="p-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl transition-all text-zinc-400 hover:text-white"
          >
            <Search size={20} />
          </button>
          <button 
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-sm font-medium transition-all"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
            <span className="hidden sm:inline">{copied ? "Copied!" : "Copy ID"}</span>
          </button>
          <div className="flex -space-x-2">
            {participants.slice(0, 3).map((p, i) => (
              <div key={p.uid} className="w-10 h-10 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-xs font-bold" title={p.displayName}>
                {p.displayName[0]}
              </div>
            ))}
            {participants.length > 3 && (
              <div className="w-10 h-10 rounded-full bg-zinc-900 border-2 border-zinc-950 flex items-center justify-center text-xs font-bold text-zinc-500">
                +{participants.length - 3}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Player Section */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-y-auto min-h-0">
          <div className="flex gap-2 mb-4">
            <button 
              onClick={() => updateRoomState({ mediaType: 'youtube' })}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                room.mediaType === 'youtube' ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-500"
              )}
            >
              YOUTUBE
            </button>
            <button 
              onClick={() => updateRoomState({ mediaType: 'spotify' })}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                room.mediaType === 'spotify' ? "bg-green-600 text-white" : "bg-zinc-900 text-zinc-500"
              )}
            >
              SPOTIFY
            </button>
          </div>

          <div className="aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border border-zinc-900 shrink-0">
            {room.mediaType === 'youtube' ? (
              <YouTube
                videoId={room.videoId}
                opts={{
                  width: '100%',
                  height: '100%',
                  playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0 },
                }}
                onReady={onPlayerReady}
                onStateChange={onPlayerStateChange}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-8 bg-zinc-900/50">
                <div className="w-full max-w-md space-y-4">
                  <div className="flex items-center gap-3 text-green-500 mb-6">
                    <div className="p-3 bg-green-500/10 rounded-2xl">
                      <Plus size={24} />
                    </div>
                    <h3 className="text-xl font-bold">Spotify Jam</h3>
                  </div>
                  <input 
                    type="text"
                    placeholder="Paste Spotify Track/Playlist URL"
                    className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-green-600 transition-colors"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        if (val.includes('spotify.com')) {
                          const uri = val.split('?')[0].split('/').pop();
                          const type = val.includes('playlist') ? 'playlist' : 'track';
                          updateRoomState({ spotifyUri: `spotify:${type}:${uri}` });
                          addActivity('change_video', `Spotify: ${type}`);
                        }
                      }
                    }}
                  />
                  {room.spotifyUri && (
                    <iframe 
                      src={`https://open.spotify.com/embed/${room.spotifyUri.split(':')[1]}/${room.spotifyUri.split(':')[2]}`}
                      width="100%" 
                      height="380" 
                      frameBorder="0" 
                      allow="encrypted-media"
                      className="rounded-2xl shadow-2xl"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          
          <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-zinc-900/30 p-6 rounded-3xl border border-zinc-800/50">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-3 h-3 rounded-full animate-pulse shadow-[0_0_10px_rgba(0,0,0,0.5)]",
                room.isPlaying ? "bg-green-500 shadow-green-500/50" : "bg-zinc-500"
              )} />
              <div>
                <span className="font-bold text-lg block">
                  {room.isPlaying ? "Live Now" : "Paused"}
                </span>
                <span className="text-sm text-zinc-500">
                  {participants.length} watching together
                </span>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-right hidden sm:block">
                <p className="text-xs text-zinc-500 uppercase font-mono tracking-widest">Last Sync</p>
                <p className="text-sm font-medium">{format(room.lastUpdated?.toDate() || new Date(), 'HH:mm:ss')}</p>
              </div>
              <div className="flex items-center gap-2 text-red-500 bg-red-500/10 px-4 py-2 rounded-xl border border-red-500/20">
                <Users size={18} />
                <span className="font-bold">{participants.length}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar (Chat & Activity) */}
        <div className="w-full lg:w-[400px] border-l border-zinc-900 flex flex-col bg-zinc-950 shrink-0 h-full lg:h-auto">
          <div className="flex border-b border-zinc-900">
            <button 
              onClick={() => setActiveTab('chat')}
              className={cn(
                "flex-1 py-4 font-bold text-sm transition-all border-b-2",
                activeTab === 'chat' ? "text-white border-red-600 bg-red-600/5" : "text-zinc-500 border-transparent hover:text-zinc-300"
              )}
            >
              <div className="flex items-center justify-center gap-2">
                <MessageSquare size={18} />
                CHAT
              </div>
            </button>
            <button 
              onClick={() => setActiveTab('activity')}
              className={cn(
                "flex-1 py-4 font-bold text-sm transition-all border-b-2",
                activeTab === 'activity' ? "text-white border-red-600 bg-red-600/5" : "text-zinc-500 border-transparent hover:text-zinc-300"
              )}
            >
              <div className="flex items-center justify-center gap-2">
                <ActivityIcon size={18} />
                ACTIVITY
              </div>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {activeTab === 'chat' ? (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.id} 
                    className={cn(
                      "flex flex-col gap-1",
                      msg.senderId === auth.currentUser?.uid ? "items-end" : "items-start"
                    )}
                  >
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-tighter">
                        {msg.senderName}
                      </span>
                      <span className="text-[10px] text-zinc-600">
                        {msg.timestamp ? format(msg.timestamp.toDate(), 'HH:mm') : ''}
                      </span>
                    </div>
                    <div className={cn(
                      "px-4 py-2 rounded-2xl max-w-[85%] text-sm",
                      msg.senderId === auth.currentUser?.uid 
                        ? "bg-red-600 text-white rounded-tr-none" 
                        : "bg-zinc-900 text-zinc-200 rounded-tl-none"
                    )}>
                      {msg.text}
                    </div>
                  </motion.div>
                ))}
                <div ref={chatEndRef} />
              </div>
            ) : (
              <div className="space-y-4">
                {activities.map((act) => (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    key={act.id} 
                    className="flex items-start gap-3 p-3 bg-zinc-900/30 rounded-2xl border border-zinc-900"
                  >
                    <div className={cn(
                      "p-2 rounded-lg shrink-0",
                      act.type === 'join' ? "bg-green-500/10 text-green-500" :
                      act.type === 'leave' ? "bg-red-500/10 text-red-500" :
                      act.type === 'pause' ? "bg-yellow-500/10 text-yellow-500" :
                      act.type === 'play' ? "bg-blue-500/10 text-blue-500" :
                      "bg-zinc-500/10 text-zinc-500"
                    )}>
                      {act.type === 'join' ? <Users size={14} /> :
                       act.type === 'leave' ? <LogOut size={14} /> :
                       act.type === 'pause' ? <Pause size={14} /> :
                       act.type === 'play' ? <Play size={14} /> :
                       <ActivityIcon size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-zinc-300">
                        <span className="font-bold text-white">{act.userName}</span>
                        {' '}
                        {act.type === 'join' ? 'joined the party' :
                         act.type === 'leave' ? 'left the party' :
                         act.type === 'pause' ? 'paused the video' :
                         act.type === 'play' ? 'started the video' :
                         act.type === 'seek' ? 'skipped ahead' :
                         'changed the video'}
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-1">
                        {act.timestamp ? format(act.timestamp.toDate(), 'HH:mm:ss') : ''}
                      </p>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {activeTab === 'chat' && (
            <form onSubmit={sendMessage} className="p-4 border-t border-zinc-900 bg-zinc-950 shrink-0">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Type a message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 px-4 py-3 pr-12 rounded-2xl focus:outline-none focus:border-red-600 transition-colors text-sm"
                />
                <button 
                  type="submit"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-red-600 hover:bg-red-600/10 rounded-xl transition-all"
                >
                  <Send size={18} />
                </button>
              </div>
            </form>
          )}
        </div>
      </main>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentRoomId, setCurrentRoomId] = useState<string | null>(null);

  useEffect(() => {
    testConnection();
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <Login />;

  if (currentRoomId) {
    return <Room roomId={currentRoomId} onLeave={() => setCurrentRoomId(null)} />;
  }

  return <Lobby onJoinRoom={(id) => setCurrentRoomId(id)} />;
}
