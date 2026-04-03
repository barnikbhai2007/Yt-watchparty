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
  getDocs,
  Timestamp,
  getDocFromServer,
  query,
  orderBy,
  limit,
  addDoc,
  deleteDoc
} from 'firebase/firestore';
import { 
  signInAnonymously, 
  updateProfile, 
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
  X,
  List,
  Edit2,
  SkipBack,
  SkipForward,
  Repeat
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
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

function extractVideoId(url: string | undefined | null) {
  if (!url) return null;
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

import { GoogleGenAI } from "@google/genai";

// --- Utils ---
function extractSoundCloudUrl(input: string | undefined | null) {
  if (!input) return null;
  if (input.includes('soundcloud.com')) {
    return input;
  }
  return null;
}

interface RoomState {
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  lastUpdated: Timestamp;
  updatedBy: string;
  name?: string;
  title?: string;
  mediaType: 'youtube' | 'music';
  musicUrl?: string;
  repeat: boolean;
}

interface SearchResult {
  id: string;
  title: string;
  thumbnail: string;
  url: string;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  photoURL?: string;
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
  photoURL?: string;
  lastSeen: Timestamp;
}

interface QueueItem {
  id: string;
  mediaId: string;
  mediaType: 'youtube' | 'music';
  title: string;
  addedBy: string;
  addedByName: string;
  timestamp: any;
}

// --- Components ---

const AVATARS = [
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Aneka",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Mimi",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Jack",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Oliver",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Sophie",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Leo",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Chloe",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Max",
  "https://api.dicebear.com/7.x/avataaars/svg?seed=Lily"
];

const UserProfile = ({ className }: { className?: string }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(auth.currentUser?.displayName || '');
  const [selectedAvatar, setSelectedAvatar] = useState(auth.currentUser?.photoURL || AVATARS[0]);

  if (!auth.currentUser) return null;

  const handleSave = async () => {
    if (!name.trim()) return;
    try {
      await updateProfile(auth.currentUser!, {
        displayName: name,
        photoURL: selectedAvatar
      });
      setIsEditing(false);
    } catch (error) {
      console.error("Failed to update profile", error);
    }
  };

  return (
    <>
      <div className={cn("flex items-center gap-3 bg-zinc-900/80 backdrop-blur-md px-4 py-2 rounded-full border border-zinc-800 shadow-xl", className)}>
        <img src={auth.currentUser.photoURL || undefined} alt="Avatar" className="w-8 h-8 rounded-full bg-zinc-800" />
        <span className="text-sm font-bold hidden sm:inline">{auth.currentUser.displayName}</span>
        <button onClick={() => setIsEditing(true)} className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors" title="Edit Profile">
          <Edit2 size={16} />
        </button>
        <button onClick={() => auth.signOut()} className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-white transition-colors" title="Logout">
          <LogOut size={16} />
        </button>
      </div>

      {isEditing && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl max-w-md w-full space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-white">Edit Profile</h2>
              <button onClick={() => setIsEditing(false)} className="text-zinc-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Your Name</label>
                <input
                  type="text"
                  maxLength={20}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors text-white"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Choose Avatar</label>
                <div className="grid grid-cols-5 gap-2">
                  {AVATARS.map((avatar, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSelectedAvatar(avatar)}
                      className={cn(
                        "p-1 rounded-xl transition-all",
                        selectedAvatar === avatar ? "bg-blue-500 scale-110" : "bg-zinc-800 hover:bg-zinc-700 hover:scale-105"
                      )}
                    >
                      <img src={avatar} alt={`Avatar ${idx + 1}`} className="w-full h-auto rounded-lg" />
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="w-full py-3 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all active:scale-[0.98]"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const Login = () => {
  const [name, setName] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATARS[0]);
  const [isJoining, setIsJoining] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsJoining(true);
    try {
      const { user } = await signInAnonymously(auth);
      await updateProfile(user, {
        displayName: name,
        photoURL: selectedAvatar
      });
      // Force a reload or state update if needed, but onAuthStateChanged might catch it.
      // Actually, onAuthStateChanged fires before updateProfile finishes sometimes, 
      // so we might need to handle that, but typically it's fine.
      window.location.reload(); // Simple way to ensure profile is loaded
    } catch (error) {
      console.error("Login failed:", error);
      setIsJoining(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-white p-4">
      <div className="max-w-md w-full space-y-8 text-center bg-zinc-900/50 p-8 rounded-3xl border border-zinc-800">
        <div className="flex justify-center">
          <div className="p-4 bg-red-600 rounded-2xl shadow-2xl shadow-red-900/20">
            <YoutubeIcon size={48} />
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight">SyncTube</h1>
          <p className="mt-2 text-zinc-400">Watch YouTube with friends, perfectly in sync.</p>
        </div>
        
        <form onSubmit={handleLogin} className="space-y-6 text-left">
          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Your Name</label>
            <input
              type="text"
              required
              maxLength={20}
              placeholder="Enter your name..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Choose Avatar</label>
            <div className="grid grid-cols-5 gap-2">
              {AVATARS.map((avatar, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedAvatar(avatar)}
                  className={cn(
                    "p-1 rounded-xl transition-all",
                    selectedAvatar === avatar ? "bg-blue-500 scale-110" : "bg-zinc-800 hover:bg-zinc-700 hover:scale-105"
                  )}
                >
                  <img src={avatar} alt={`Avatar ${idx + 1}`} className="w-full h-auto rounded-lg" />
                </button>
              ))}
            </div>
          </div>

          <button
            type="submit"
            disabled={isJoining || !name.trim()}
            className="w-full py-4 bg-white text-black font-bold rounded-xl hover:bg-zinc-200 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isJoining ? "Joining..." : "Enter SyncTube"}
          </button>
        </form>
      </div>
    </div>
  );
};

const Lobby = ({ onJoinRoom }: { onJoinRoom: (id: string, type?: 'youtube' | 'music') => void }) => {
  const [roomId, setRoomId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [lobbyType, setLobbyType] = useState<'youtube' | 'music'>('youtube');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim()) return;
    
    // If it's a direct URL, just create room
    if (videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be') || videoUrl.includes('soundcloud.com')) {
      handleCreateRoom();
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    try {
      const searchUrl = lobbyType === 'music'
        ? `https://yt-search-nine.vercel.app/music?q=${encodeURIComponent(videoUrl)}`
        : `https://yt-search-nine.vercel.app/search?q=${encodeURIComponent(videoUrl)}`;
      
      const response = await fetch(searchUrl);
      if (!response.ok) throw new Error("Search API request failed");
      const results = await response.json();
      setSearchResults(results);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const createRoomFromSearch = async (result: SearchResult) => {
    const newRoomId = nanoid(10);
    const roomRef = doc(db, 'rooms', newRoomId);
    try {
      await setDoc(roomRef, {
        videoId: result.id,
        musicUrl: "",
        currentTime: 0,
        isPlaying: true,
        lastUpdated: serverTimestamp(),
        updatedBy: auth.currentUser?.uid,
        name: lobbyType === 'youtube' ? "YouTube Party" : "Music Jam",
        title: result.title,
        mediaType: lobbyType,
        repeat: false
      });
      onJoinRoom(newRoomId, lobbyType);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rooms/${newRoomId}`);
    }
  };

  const handleCreateRoom = async () => {
    let finalVid = "";
    let finalMusicUrl = "";

    if (lobbyType === 'youtube') {
      finalVid = extractVideoId(videoUrl) || "";
      if (!finalVid) {
        alert("Please enter a valid YouTube URL");
        return;
      }
    } else {
      finalMusicUrl = extractSoundCloudUrl(videoUrl) || "";
      if (!finalMusicUrl) {
        finalVid = extractVideoId(videoUrl) || "";
        if (!finalVid) {
          alert("Please enter a valid YouTube or SoundCloud URL");
          return;
        }
      }
    }

    const newRoomId = nanoid(10);
    const roomRef = doc(db, 'rooms', newRoomId);
    
    try {
      await setDoc(roomRef, {
        videoId: finalVid || "",
        musicUrl: finalMusicUrl || "",
        currentTime: 0,
        isPlaying: true,
        lastUpdated: serverTimestamp(),
        updatedBy: auth.currentUser?.uid,
        name: lobbyType === 'youtube' ? "YouTube Party" : "Music Jam",
        mediaType: lobbyType,
        repeat: false
      });
      onJoinRoom(newRoomId, lobbyType);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rooms/${newRoomId}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 flex flex-col items-center justify-center relative">
      <UserProfile className="absolute top-4 right-4 z-50" />
      <div className="max-w-4xl w-full space-y-8 sm:space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-4xl sm:text-6xl font-black tracking-tighter italic">
            <span className="text-white">SYNC</span>
            <span className={cn(lobbyType === 'youtube' ? "text-red-600" : "text-blue-500")}>
              {lobbyType === 'youtube' ? "TUBE" : "JAM"}
            </span>
          </h1>
          <div className="flex justify-center gap-2 sm:gap-4">
            <button 
              onClick={() => setLobbyType('youtube')}
              className={cn(
                "px-4 sm:px-6 py-2 rounded-full text-sm sm:text-base font-bold transition-all border-2",
                lobbyType === 'youtube' ? "bg-red-600 border-red-600 text-white" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
              )}
            >
              YOUTUBE
            </button>
            <button 
              onClick={() => setLobbyType('music')}
              className={cn(
                "px-4 sm:px-6 py-2 rounded-full text-sm sm:text-base font-bold transition-all border-2",
                lobbyType === 'music' ? "bg-blue-500 border-blue-500 text-white" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
              )}
            >
              MUSIC
            </button>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-6 sm:gap-8">
          {/* Create Room */}
          <div className={cn(
            "bg-zinc-900/50 border p-6 sm:p-8 rounded-3xl space-y-6 transition-colors",
            lobbyType === 'youtube' ? "border-red-900/30" : "border-blue-900/30"
          )}>
            <div className="flex items-center gap-3">
              <Plus size={24} className={lobbyType === 'youtube' ? "text-red-500" : "text-blue-500"} />
              <h2 className="text-xl font-bold">Create {lobbyType === 'youtube' ? "Room" : "Jam"}</h2>
            </div>
            <div className="space-y-4">
              <form onSubmit={handleSearch} className="space-y-2 relative" ref={searchContainerRef}>
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Search or Paste Link</label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder={lobbyType === 'youtube' ? "Search or paste YouTube URL" : "Search or paste SoundCloud URL"}
                    value={videoUrl}
                    onChange={(e) => setVideoUrl(e.target.value)}
                    onFocus={() => {
                      if (videoUrl.trim() && searchResults.length === 0) {
                        handleSearch(new Event('submit') as any);
                      }
                    }}
                    className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 pr-12 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
                  />
                  <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-white transition-colors">
                    {isSearching ? <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" /> : <Search size={18} />}
                  </button>
                </div>

                <AnimatePresence>
                  {searchResults.length > 0 && (
                    <motion.div 
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-64 overflow-y-auto"
                    >
                      {searchResults.map((result) => (
                        <div key={result.id} className="flex items-center gap-3 p-3 hover:bg-zinc-800 transition-colors group/item">
                          <img src={result.thumbnail || undefined} alt="" className="w-16 h-10 object-cover rounded-lg shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold truncate">{result.title}</p>
                          </div>
                          <button 
                            type="button"
                            onClick={() => createRoomFromSearch(result)}
                            className="p-2 bg-zinc-100 text-black rounded-lg hover:bg-white transition-colors opacity-0 group-hover/item:opacity-100"
                            title="Start Party"
                          >
                            <Play size={14} fill="currentColor" />
                          </button>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </form>
              <button
                onClick={handleCreateRoom}
                className={cn(
                  "w-full py-3 font-bold rounded-xl transition-all active:scale-[0.98]",
                  lobbyType === 'youtube' ? "bg-red-600 hover:bg-red-700" : "bg-blue-500 hover:bg-blue-600 text-white"
                )}
              >
                {lobbyType === 'youtube' ? "Start Party" : "Start Jam"}
              </button>
            </div>
          </div>

          {/* Join Room */}
          <div className="bg-zinc-900/50 border border-zinc-800 p-6 sm:p-8 rounded-3xl space-y-6">
            <div className="flex items-center gap-3 text-zinc-400">
              <ArrowRight size={24} />
              <h2 className="text-xl font-bold">Join Existing</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Room ID</label>
                <input
                  type="text"
                  placeholder="Enter ID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                onClick={() => roomId && onJoinRoom(roomId)}
                className="w-full py-3 bg-zinc-100 text-black hover:bg-white font-bold rounded-xl transition-all active:scale-[0.98]"
              >
                Join Party
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute bottom-4 left-0 right-0 text-center text-zinc-600 text-xs font-medium tracking-wide pointer-events-none">
        Made with ❤️ in India (brokenaqua - barnik)
      </div>
    </div>
  );
};

const EMOJIS = ['😂', '❤️', '🔥', '😮', '😢', '👏', '🎉', '✨'];

const FloatingEmojis = ({ roomId }: { roomId: string }) => {
  const [emojis, setEmojis] = useState<{id: string, emoji: string, x: number}[]>([]);

  useEffect(() => {
    const q = query(collection(db, 'rooms', roomId, 'reactions'), orderBy('timestamp', 'desc'), limit(5));
    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data();
          // Only show if it's recent (within last 5 seconds)
          const time = data.timestamp ? data.timestamp.toMillis() : Date.now();
          if (Date.now() - time < 5000) {
            const newEmoji = {
              id: change.doc.id + Math.random(), // Ensure unique ID even if same doc triggers
              emoji: data.emoji,
              x: Math.random() * 80 + 10 // 10% to 90%
            };
            setEmojis(prev => [...prev, newEmoji]);
            setTimeout(() => {
              setEmojis(prev => prev.filter(e => e.id !== newEmoji.id));
            }, 3000);
          }
        }
      });
    });
    return unsub;
  }, [roomId]);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[100]">
      <AnimatePresence>
        {emojis.map(e => (
          <motion.div
            key={e.id}
            initial={{ y: '20vh', opacity: 1, x: `${e.x}vw`, scale: 0.5 }}
            animate={{ y: '-120vh', opacity: 0, scale: 2.5 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2.5, ease: 'easeOut' }}
            className="absolute bottom-0 text-4xl sm:text-6xl"
          >
            {e.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

const Room = ({ roomId, onLeave }: { roomId: string; onLeave: () => void }) => {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [player, setPlayer] = useState<any>(null);
  const [scPlayer, setScPlayer] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'activity' | 'queue'>('chat');
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  
  const [duration, setDuration] = useState(0);
  const [localProgress, setLocalProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [toasts, setToasts] = useState<{id: string, message: string}[]>([]);
  
  const isUpdatingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    let interval: any;
    if (room?.isPlaying && player && !isDragging) {
      interval = setInterval(() => {
        try {
          const current = player.getCurrentTime();
          const dur = player.getDuration();
          if (current !== undefined) setLocalProgress(current);
          if (dur !== undefined && dur > 0) setDuration(dur);
        } catch (e) {}
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [room?.isPlaying, player, isDragging]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalProgress(parseFloat(e.target.value));
  };

  const handleSeekCommit = async () => {
    if (player) {
      player.seekTo(localProgress, true);
      await updateRoomState({ currentTime: localProgress });
      addActivity('seek', `to ${Math.floor(localProgress)}s`);
    }
  };

  const sendEmoji = async (emoji: string) => {
    if (!auth.currentUser) return;
    const reactionsRef = collection(db, 'rooms', roomId, 'reactions');
    try {
      await addDoc(reactionsRef, {
        emoji,
        userId: auth.currentUser.uid,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      console.error("Failed to send emoji:", error);
    }
  };


  // --- Presence & Activity ---
  useEffect(() => {
    if (!auth.currentUser) return;
    
    const participantRef = doc(db, 'rooms', roomId, 'participants', auth.currentUser.uid);
    const updatePresence = async () => {
      await setDoc(participantRef, {
        uid: auth.currentUser?.uid,
        displayName: auth.currentUser?.displayName,
        photoURL: auth.currentUser?.photoURL || '',
        lastSeen: serverTimestamp()
      }, { merge: true });
    };

    updatePresence();
    const interval = setInterval(updatePresence, 30000); // Update every 30s

    const addActivityLocal = async (type: Activity['type'], details?: string) => {
      const activitiesRef = collection(db, 'rooms', roomId, 'activities');
      await addDoc(activitiesRef, {
        type,
        userId: auth.currentUser?.uid,
        userName: auth.currentUser?.displayName || 'Anonymous',
        timestamp: serverTimestamp(),
        details: details || ''
      });
    };

    addActivityLocal('join');

    return () => {
      clearInterval(interval);
      deleteDoc(participantRef);
      addActivityLocal('leave');
    };
  }, [roomId]);

  // --- Subscriptions ---
  useEffect(() => {
    const roomRef = doc(db, 'rooms', roomId);
    const messagesRef = collection(db, 'rooms', roomId, 'messages');
    const activitiesRef = collection(db, 'rooms', roomId, 'activities');
    const participantsRef = collection(db, 'rooms', roomId, 'participants');
    const queueRef = collection(db, 'rooms', roomId, 'queue');

    const unsubRoom = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as RoomState;
        setRoom(data);
        
        // Sync Media - Fix for background tabs
        if ((data.mediaType === 'youtube' || data.mediaType === 'music') && data.updatedBy !== auth.currentUser?.uid && player) {
          try {
            const playerState = player.getPlayerState();
            const isPlayerPlaying = playerState === YouTube.PlayerState.PLAYING;
            
            if (data.isPlaying && !isPlayerPlaying) {
              player.playVideo();
            } else if (!data.isPlaying && isPlayerPlaying) {
              player.pauseVideo();
            }

            const localTime = player.getCurrentTime() || 0;
            if (Math.abs(localTime - data.currentTime) > 2) {
              player.seekTo(data.currentTime, true);
            }
          } catch (error) {
            console.error("Player sync error:", error);
          }
        }
      } else {
        onLeave();
      }
    });

    const unsubMessages = onSnapshot(query(messagesRef, orderBy('timestamp', 'asc'), limit(50)), (snapshot) => {
      setMessages(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    });

    let initialActivitiesLoad = true;
    const unsubActivities = onSnapshot(query(activitiesRef, orderBy('timestamp', 'desc'), limit(20)), (snapshot) => {
      const acts = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Activity));
      setActivities(acts);

      if (!initialActivitiesLoad) {
        snapshot.docChanges().forEach(change => {
          if (change.type === 'added') {
            const data = change.doc.data() as Activity;
            if (data.userId === auth.currentUser?.uid) return; // Don't toast own actions
            
            let actionText: string = data.type;
            switch(data.type) {
              case 'join': actionText = 'joined the room'; break;
              case 'leave': actionText = 'left the room'; break;
              case 'pause': actionText = 'paused the video'; break;
              case 'play': actionText = 'resumed the video'; break;
              case 'seek': actionText = `seeked ${data.details || ''}`; break;
              case 'change_video': actionText = `changed video: ${data.details || ''}`; break;
            }
            const msg = `${data.userName} ${actionText}`;
            const id = change.doc.id;
            setToasts(prev => [...prev, { id, message: msg }]);
            setTimeout(() => {
              setToasts(prev => prev.filter(t => t.id !== id));
            }, 3000);
          }
        });
      }
      initialActivitiesLoad = false;
    });

    const unsubParticipants = onSnapshot(participantsRef, (snapshot) => {
      setParticipants(snapshot.docs.map(d => d.data() as Participant));
    });

    const unsubQueue = onSnapshot(query(queueRef, orderBy('timestamp', 'asc')), (snapshot) => {
      setQueue(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as QueueItem)));
    });

    return () => {
      unsubRoom();
      unsubMessages();
      unsubActivities();
      unsubParticipants();
      unsubQueue();
    };
  }, [roomId, player, onLeave]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addToQueue = async (val: string) => {
    if (!val.trim()) return;
    let mediaType: 'youtube' | 'music' = room?.mediaType || 'youtube';
    let mediaId = extractVideoId(val);
    let title = 'Unknown Title';

    if (mediaId) {
      try {
        const response = await fetch(`/api/proxy/oembed?url=https://www.youtube.com/watch?v=${mediaId}`);
        if (response.ok) {
          const data = await response.json();
          title = data.title || 'Unknown Title';
        }
      } catch (e) {
        console.error("Failed to fetch title", e);
        title = `Video: ${mediaId}`;
      }
    } else {
      // Maybe it's a SoundCloud URL, just use the URL as ID for now
      mediaId = val;
      title = 'Music Link';
    }

    if (!mediaId) return;

    const queueRef = collection(db, 'rooms', roomId, 'queue');
    await addDoc(queueRef, {
      mediaId,
      mediaType,
      title,
      addedBy: auth.currentUser?.uid,
      addedByName: auth.currentUser?.displayName || 'Anonymous',
      timestamp: serverTimestamp()
    });
    addActivity('change_video', `queued ${title}`);
  };

  const removeFromQueue = async (itemId: string) => {
    const itemRef = doc(db, 'rooms', roomId, 'queue', itemId);
    await deleteDoc(itemRef);
  };

  const playNext = async () => {
    if (room?.repeat) {
      await updateRoomState({ currentTime: 0, isPlaying: true });
      return;
    }
    
    // Add current to history
    if (room && room.videoId) {
      const historyRef = collection(db, 'rooms', roomId, 'history');
      await addDoc(historyRef, {
        mediaId: room.videoId,
        mediaType: room.mediaType,
        title: room.title || "Unknown Title",
        timestamp: serverTimestamp()
      });
    }

    const queueRef = collection(db, 'rooms', roomId, 'queue');
    const q = query(queueRef, orderBy('timestamp', 'asc'), limit(1));
    try {
      const snapshot = await getDocs(q);
      if (snapshot.empty) return;
      
      const nextDoc = snapshot.docs[0];
      const nextItem = { id: nextDoc.id, ...nextDoc.data() } as QueueItem;
      
      const updates: Partial<RoomState> = {
        mediaType: nextItem.mediaType,
        currentTime: 0,
        isPlaying: true,
        title: nextItem.title || "Unknown Title",
        videoId: nextItem.mediaId
      };
      if (nextItem.mediaType === 'music') {
        updates.musicUrl = nextItem.mediaId;
      }
      
      await updateRoomState(updates);
      await removeFromQueue(nextItem.id);
      addActivity('change_video', `playing next: ${nextItem.title}`);
    } catch (error) {
      console.error("Failed to play next:", error);
    }
  };

  const playPrevious = async () => {
    const historyRef = collection(db, 'rooms', roomId, 'history');
    const q = query(historyRef, orderBy('timestamp', 'desc'), limit(1));
    try {
      const snapshot = await getDocs(q);
      if (snapshot.empty) return;
      
      const prevDoc = snapshot.docs[0];
      const prevItem = { id: prevDoc.id, ...prevItemData(prevDoc.data()) } as QueueItem;
      
      const updates: Partial<RoomState> = {
        mediaType: prevItem.mediaType,
        currentTime: 0,
        isPlaying: true,
        title: prevItem.title,
        videoId: prevItem.mediaId
      };
      if (prevItem.mediaType === 'music') {
        updates.musicUrl = prevItem.mediaId;
      }
      
      await updateRoomState(updates);
      await deleteDoc(prevDoc.ref); // Remove from history
      addActivity('change_video', `playing previous: ${prevItem.title}`);
    } catch (error) {
      console.error("Failed to play previous:", error);
    }
  };

  const prevItemData = (data: any) => ({
    ...data,
    mediaId: data.mediaId,
    mediaType: data.mediaType,
    title: data.title,
    timestamp: data.timestamp
  });

  const updateRoomState = async (updates: Partial<RoomState>) => {
    if (isUpdatingRef.current) return;
    const roomRef = doc(db, 'rooms', roomId);
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      await updateDoc(roomRef, {
        ...updates,
        lastUpdated: serverTimestamp(),
        updatedBy: uid
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
      senderName: auth.currentUser?.displayName || 'Anonymous',
      photoURL: auth.currentUser?.photoURL || '',
      timestamp: serverTimestamp()
    });
    setChatInput('');
  };

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target);
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    const newState = event.data;
    const isPlaying = newState === YouTube.PlayerState.PLAYING;
    const currentTime = event.target.getCurrentTime();

    // Prevent echoing back the state if it matches what the room already says
    if (room && room.isPlaying === isPlaying && Math.abs((room.currentTime || 0) - currentTime) < 2) {
      return;
    }

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

  const onPlayerEnd = () => {
    playNext();
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInput.trim()) return;

    setIsSearching(true);
    setSearchResults([]);

    try {
      // Using the user's custom yt-search backend directly (CORS fixed)
      const searchUrl = room?.mediaType === 'music'
        ? `https://yt-search-nine.vercel.app/music?q=${encodeURIComponent(searchInput)}`
        : `https://yt-search-nine.vercel.app/search?q=${encodeURIComponent(searchInput)}`;

      const response = await fetch(searchUrl);
      
      if (!response.ok) {
        throw new Error("Search API request failed");
      }

      const results = await response.json();
      setSearchResults(results);
    } catch (error) {
      console.error("Search failed:", error);
      if (error instanceof TypeError) {
        console.error("This might be a CORS issue or network error.");
      }
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const selectSearchResult = (result: SearchResult) => {
    const updates: Partial<RoomState> = {
      videoId: result.id,
      title: result.title,
      currentTime: 0,
      isPlaying: true
    };
    
    if (room?.mediaType === 'music') {
      updates.musicUrl = result.url;
      addActivity('change_video', `Music: ${result.title}`);
    } else {
      addActivity('change_video', result.title);
    }
    
    updateRoomState(updates);
    setSearchResults([]);
    setSearchInput('');
  };

  const addToQueueFromResult = async (result: SearchResult) => {
    const queueRef = collection(db, 'rooms', roomId, 'queue');
    await addDoc(queueRef, {
      mediaId: result.id,
      mediaType: room?.mediaType || 'youtube',
      title: result.title,
      addedBy: auth.currentUser?.uid,
      addedByName: auth.currentUser?.displayName || 'Anonymous',
      timestamp: serverTimestamp()
    });
    addActivity('change_video', `queued ${result.title}`);
    setSearchResults([]);
    setSearchInput('');
  };

  useEffect(() => {
    // Music logic removed as we use YouTube player for both modes now.
  }, [room?.musicUrl, room?.mediaType]);

  if (!room) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white">Loading Party...</div>;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <header className="p-3 sm:p-4 border-b border-zinc-900 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md z-20 shrink-0">
        <div className="flex items-center gap-2 sm:gap-4">
          <button onClick={onLeave} className="p-2 hover:bg-zinc-900 rounded-lg transition-colors">
            <LogOut size={20} className="rotate-180" />
          </button>
          <div>
            <h2 className="font-bold text-sm sm:text-lg leading-tight truncate max-w-[120px] sm:max-w-none">{room.name || "Watch Party"}</h2>
            <p className="text-[10px] sm:text-xs text-zinc-500 font-mono uppercase tracking-wider">{roomId}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3">
          <UserProfile />
          <button 
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-3 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-xs sm:text-sm font-medium transition-all"
          >
            {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
            <span className="hidden sm:inline">{copied ? "Copied!" : "Copy ID"}</span>
          </button>
          
          <button 
            onClick={() => setShowSidebar(!showSidebar)}
            className="lg:hidden p-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-zinc-400"
          >
            <MessageSquare size={20} />
          </button>

          <div className="hidden sm:flex -space-x-2">
            {participants.slice(0, 3).map((p) => (
              p.photoURL ? (
                <img key={p.uid} src={p.photoURL} alt={p.displayName} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-zinc-800 border-2 border-zinc-950 object-cover" title={p.displayName} />
              ) : (
                <div key={p.uid} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-[10px] sm:text-xs font-bold" title={p.displayName}>
                  {p.displayName[0]}
                </div>
              )
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Toasts */}
        <div className="absolute bottom-4 left-4 z-[100] flex flex-col gap-2 pointer-events-none">
          <AnimatePresence>
            {toasts.map(t => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, x: -20, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-800 text-white px-4 py-3 rounded-xl shadow-2xl border border-zinc-700 text-sm font-medium flex items-center gap-3"
              >
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                {t.message}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Player Section */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-y-auto min-h-0">
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex gap-2">
              <button 
                onClick={() => updateRoomState({ mediaType: 'youtube' })}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold transition-all",
                  room.mediaType === 'youtube' ? "bg-red-600 text-white" : "bg-zinc-900 text-zinc-500"
                )}
              >
                YOUTUBE
              </button>
              <button 
                onClick={() => updateRoomState({ mediaType: 'music' })}
                className={cn(
                  "px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold transition-all",
                  room.mediaType === 'music' ? "bg-blue-600 text-white" : "bg-zinc-900 text-zinc-500"
                )}
              >
                YT MUSIC
              </button>
            </div>

            <form onSubmit={handleSearch} className="flex-1 relative group" ref={searchContainerRef}>
              <input 
                type="text"
                placeholder={room.mediaType === 'youtube' ? "Search YouTube..." : "Search Music..."}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onFocus={() => {
                  if (searchInput.trim() && searchResults.length === 0) {
                    // Re-trigger search if focused and has input but no results
                    handleSearch(new Event('submit') as any);
                  }
                }}
                className="w-full bg-zinc-900 border border-zinc-800 px-4 py-2.5 pr-10 rounded-xl focus:outline-none focus:border-zinc-600 transition-all text-sm"
              />
              <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-white transition-colors">
                {isSearching ? <div className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" /> : <Search size={18} />}
              </button>

              <AnimatePresence>
                {searchResults.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50"
                  >
                    {searchResults.map((result) => (
                      <div key={result.id} className="flex items-center gap-3 p-3 hover:bg-zinc-800 transition-colors group/item">
                        <img src={result.thumbnail || undefined} alt="" className="w-16 h-10 object-cover rounded-lg shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{result.title}</p>
                        </div>
                        <div className="flex gap-2 opacity-0 group-hover/item:opacity-100 transition-opacity">
                          <button 
                            onClick={() => selectSearchResult(result)}
                            className="p-2 bg-zinc-100 text-black rounded-lg hover:bg-white transition-colors"
                            title="Play Now"
                          >
                            <Play size={14} fill="currentColor" />
                          </button>
                          <button 
                            onClick={() => addToQueueFromResult(result)}
                            className="p-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                            title="Add to Queue"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </div>

          <div className="aspect-video bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border border-zinc-900 shrink-0 relative">
            {room.mediaType === 'youtube' ? (
              room.videoId ? (
                <YouTube
                  videoId={room.videoId || ""}
                  opts={{
                    width: '100%',
                    height: '100%',
                    playerVars: { autoplay: 0, controls: 1, modestbranding: 1, rel: 0 },
                  }}
                  onReady={onPlayerReady}
                  onStateChange={onPlayerStateChange}
                  onEnd={onPlayerEnd}
                  onError={(e) => console.error("YouTube Player Error:", e.data)}
                  className="w-full h-full"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-500">
                  No video selected
                </div>
              )
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-zinc-900 via-blue-950 to-zinc-900 flex flex-col items-center justify-center p-6 relative overflow-hidden">
                {/* Background Glow */}
                <div className="absolute inset-0 bg-blue-500/10 blur-[120px] rounded-full scale-150 animate-pulse" />
                
                <div className="relative z-10 flex flex-col items-center text-center space-y-6 w-full max-w-sm">
                  <motion.div 
                    animate={{ 
                      scale: room.isPlaying ? [1, 1.05, 1] : 1,
                      rotate: room.isPlaying ? [0, 2, -2, 0] : 0
                    }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                    className="relative"
                  >
                    <img 
                      src={`https://img.youtube.com/vi/${room.videoId}/maxresdefault.jpg`}
                      alt="Album Art"
                      className="w-48 h-48 sm:w-64 sm:h-64 object-cover rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10"
                      onError={(e) => {
                        const target = e.target as HTMLImageElement;
                        if (!target.src.endsWith('0.jpg')) {
                          target.src = `https://img.youtube.com/vi/${room.videoId}/0.jpg`;
                        } else {
                          target.src = 'https://images.unsplash.com/photo-1614680376593-902f74cf0d41?q=80&w=400&auto=format&fit=crop';
                        }
                      }}
                    />
                    {room.isPlaying && (
                      <div className="absolute -bottom-4 -right-4 bg-blue-600 p-3 rounded-2xl shadow-xl">
                        <ActivityIcon size={24} className="text-white animate-bounce" />
                      </div>
                    )}
                  </motion.div>

                  <div className="space-y-2">
                    <h3 className="text-xl sm:text-2xl font-black tracking-tight truncate w-full px-4">
                      {room.title || room.name || "Music Jam"}
                    </h3>
                    <p className="text-blue-400 font-bold text-[10px] uppercase tracking-[0.2em]">YT Music Mode</p>
                  </div>

                  <div className="w-full px-8 z-50">
                    <div className="flex items-center gap-4">
                      <span className="text-xs font-mono text-zinc-400 w-10 text-right">
                        {Math.floor(localProgress / 60)}:{(Math.floor(localProgress % 60)).toString().padStart(2, '0')}
                      </span>
                      <input 
                        type="range" 
                        min={0} 
                        max={duration || 100} 
                        value={localProgress} 
                        onChange={handleSeek}
                        onMouseDown={() => setIsDragging(true)}
                        onMouseUp={() => { setIsDragging(false); handleSeekCommit(); }}
                        onTouchStart={() => setIsDragging(true)}
                        onTouchEnd={() => { setIsDragging(false); handleSeekCommit(); }}
                        className="flex-1 h-2 bg-zinc-800/50 rounded-lg appearance-none cursor-pointer accent-white backdrop-blur-sm"
                      />
                      <span className="text-xs font-mono text-zinc-400 w-10">
                        {Math.floor(duration / 60)}:{(Math.floor(duration % 60)).toString().padStart(2, '0')}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-6 pt-2 z-50">
                    <button className="text-zinc-400 hover:text-white transition-colors">
                      <Repeat size={20} />
                    </button>
                    <button
                      onClick={playPrevious}
                      className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                    >
                      <SkipBack size={24} fill="currentColor" />
                    </button>
                    <button
                      onClick={() => {
                        if (!player) return;
                        if (room.isPlaying) {
                          player.pauseVideo();
                          updateRoomState({ isPlaying: false });
                        } else {
                          player.playVideo();
                          updateRoomState({ isPlaying: true });
                        }
                      }}
                      disabled={!player}
                      className={cn(
                        "w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center bg-white text-black rounded-full hover:scale-110 transition-all shadow-[0_0_50px_rgba(255,255,255,0.2)] active:scale-95",
                        !player && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {room.isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
                    </button>
                    <button
                      onClick={playNext}
                      className="p-2 hover:bg-zinc-800 rounded-full transition-colors"
                    >
                      <SkipForward size={24} fill="currentColor" />
                    </button>
                    <button
                      onClick={() => updateRoomState({ repeat: !room.repeat })}
                      className={cn(
                        "p-2 hover:bg-zinc-800 rounded-full transition-colors",
                        room.repeat ? "text-blue-500" : "text-zinc-500"
                      )}
                    >
                      <Repeat size={24} />
                    </button>
                  </div>

                  {/* Hidden Player for Audio Sync */}
                  <div className="absolute top-0 left-0 w-1 h-1 opacity-0 pointer-events-none overflow-hidden">
                    {room.videoId && (
                      <YouTube
                        videoId={room.videoId}
                        opts={{
                          width: '100%',
                          height: '100%',
                          playerVars: { autoplay: 1, controls: 0, modestbranding: 1, rel: 0 },
                        }}
                        onReady={(e) => {
                          onPlayerReady(e);
                          if (room.isPlaying) e.target.playVideo();
                        }}
                        onStateChange={onPlayerStateChange}
                        onEnd={onPlayerEnd}
                        onError={(e) => console.error("YouTube Player Error:", e.data)}
                      />
                    )}
                  </div>
                </div>

                {/* Visualizer Bars */}
                <div className="absolute bottom-0 left-0 right-0 h-24 flex items-end justify-center gap-1 px-4 opacity-30">
                  {[...Array(20)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ height: room.isPlaying ? [20, 60, 30, 80, 40] : 10 }}
                      transition={{ 
                        repeat: Infinity, 
                        duration: 0.5 + Math.random(), 
                        delay: i * 0.05 
                      }}
                      className="w-1 bg-blue-500 rounded-t-full"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
          <FloatingEmojis roomId={roomId} />

          {/* Emoji Bar */}
          <div className="mt-6 bg-zinc-900/50 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-800/50 space-y-4">
            <div className="flex justify-center gap-2 sm:gap-4">
              {EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => sendEmoji(emoji)}
                  className="text-2xl sm:text-3xl hover:scale-125 transition-transform active:scale-90"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          
          <div className="mt-6 space-y-4">
            <div className="bg-zinc-900/30 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-800/50">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <input 
                    type="text"
                    placeholder="Paste Link to Queue..."
                    className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors text-sm"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        addToQueue(val);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }}
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-zinc-600 uppercase tracking-widest hidden sm:block">
                    Paste Link
                  </div>
                </div>
                <button 
                  onClick={(e) => {
                    const input = (e.currentTarget.previousSibling?.firstChild as HTMLInputElement);
                    if (input) {
                      addToQueue(input.value);
                      input.value = '';
                    }
                  }}
                  className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-sm transition-all active:scale-95"
                >
                  Add to Queue
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 bg-zinc-900/30 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-800/50">
              <div className={cn(
                "w-3 h-3 rounded-full animate-pulse",
                room.isPlaying ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]" : "bg-zinc-500"
              )} />
              <div>
                <span className="font-bold text-sm sm:text-lg block">
                  {room.isPlaying ? "Live Syncing" : "Paused"}
                </span>
                <span className="text-[10px] sm:text-xs text-zinc-500">
                  {participants.length} user{participants.length !== 1 ? 's' : ''} connected
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar (Chat & Activity) */}
        <aside className={cn(
          "fixed inset-y-0 right-0 w-full sm:w-80 bg-zinc-950 border-l border-zinc-900 z-30 lg:relative lg:translate-x-0 transition-transform duration-300 flex flex-col",
          showSidebar ? "translate-x-0" : "translate-x-full"
        )}>
          <div className="p-4 border-b border-zinc-900 flex items-center justify-between lg:hidden">
            <h3 className="font-bold">Room Activity</h3>
            <button onClick={() => setShowSidebar(false)} className="p-2 hover:bg-zinc-900 rounded-lg">
              <X size={20} />
            </button>
          </div>

          <div className="flex p-2 gap-1 bg-zinc-900/50 m-4 rounded-xl shrink-0">
            <button 
              onClick={() => setActiveTab('chat')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all",
                activeTab === 'chat' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <MessageSquare size={14} />
              CHAT
            </button>
            <button 
              onClick={() => setActiveTab('queue')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all",
                activeTab === 'queue' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <List size={14} />
              QUEUE
            </button>
            <button 
              onClick={() => setActiveTab('activity')}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-bold transition-all",
                activeTab === 'activity' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <ActivityIcon size={14} />
              LOGS
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 space-y-4 custom-scrollbar">
            {activeTab === 'chat' ? (
              messages.map((msg) => (
                <div key={msg.id} className={cn(
                  "flex max-w-[85%] gap-2",
                  msg.senderId === auth.currentUser?.uid ? "ml-auto flex-row-reverse" : "flex-row"
                )}>
                  {msg.photoURL ? (
                    <img src={msg.photoURL} alt="" className="w-6 h-6 rounded-full bg-zinc-800 shrink-0 mt-4" />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-zinc-800 shrink-0 mt-4 flex items-center justify-center text-[10px] font-bold">
                      {msg.senderName[0]}
                    </div>
                  )}
                  <div className={cn(
                    "flex flex-col",
                    msg.senderId === auth.currentUser?.uid ? "items-end" : "items-start"
                  )}>
                    <span className="text-[10px] text-zinc-500 mb-1 px-1">{msg.senderName}</span>
                    <div className={cn(
                      "px-4 py-2 rounded-2xl text-sm",
                      msg.senderId === auth.currentUser?.uid ? "bg-zinc-100 text-black rounded-tr-none" : "bg-zinc-900 text-zinc-200 rounded-tl-none"
                    )}>
                      {msg.text}
                    </div>
                  </div>
                </div>
              ))
            ) : activeTab === 'queue' ? (
              <div className="space-y-3">
                {queue.length === 0 ? (
                  <div className="text-center py-8 text-zinc-600">
                    <List size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-xs">Queue is empty</p>
                  </div>
                ) : (
                  queue.map((item, idx) => (
                    <div key={item.id} className="bg-zinc-900/50 p-3 rounded-xl border border-zinc-800/50 group">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-mono text-zinc-600">{idx + 1}</span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">{item.title}</p>
                            <p className="text-[10px] text-zinc-500">Added by {item.addedByName}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => removeFromQueue(item.id)}
                          className="p-1.5 text-zinc-600 hover:text-red-500 transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
                {queue.length > 0 && (
                  <button 
                    onClick={playNext}
                    className="w-full py-2 bg-zinc-100 text-black rounded-lg text-xs font-bold hover:bg-white transition-colors"
                  >
                    Play Next
                  </button>
                )}
              </div>
            ) : (
              activities.map((act) => (
                <div key={act.id} className="flex gap-3 items-start group">
                  <div className="w-1 h-8 bg-zinc-800 group-hover:bg-zinc-600 rounded-full transition-colors shrink-0" />
                  <div>
                    <p className="text-xs text-zinc-300">
                      <span className="font-bold text-white">{act.userName}</span> {act.type}d {act.details}
                    </p>
                    <span className="text-[10px] text-zinc-600">{act.timestamp ? format(act.timestamp.toDate(), 'HH:mm') : '...'}</span>
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {activeTab === 'chat' && (
            <form onSubmit={sendMessage} className="p-4 border-t border-zinc-900 bg-zinc-950">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Message..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 px-4 py-3 pr-12 rounded-2xl focus:outline-none focus:border-zinc-700 transition-colors text-sm"
                />
                <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-400 hover:text-white transition-colors">
                  <Send size={18} />
                </button>
              </div>
            </form>
          )}
        </aside>
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
