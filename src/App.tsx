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
  getDocFromServer
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
  Check
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
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

// --- Types ---
interface RoomState {
  videoId: string;
  currentTime: number;
  isPlaying: boolean;
  lastUpdated: Timestamp;
  updatedBy: string;
  name?: string;
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

const Lobby = ({ onJoinRoom }: { onJoinRoom: (id: string) => void }) => {
  const [roomId, setRoomId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');

  const handleCreateRoom = async () => {
    const vid = extractVideoId(videoUrl);
    if (!vid) {
      alert("Please enter a valid YouTube URL");
      return;
    }

    const newRoomId = nanoid(10);
    const roomRef = doc(db, 'rooms', newRoomId);
    
    try {
      await setDoc(roomRef, {
        videoId: vid,
        currentTime: 0,
        isPlaying: false,
        lastUpdated: serverTimestamp(),
        updatedBy: auth.currentUser?.uid,
        name: "New Party"
      });
      onJoinRoom(newRoomId);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `rooms/${newRoomId}`);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-6 flex flex-col items-center justify-center">
      <div className="max-w-xl w-full space-y-12">
        <header className="text-center space-y-2">
          <h1 className="text-5xl font-black tracking-tighter italic">SYNC<span className="text-red-600">TUBE</span></h1>
          <p className="text-zinc-500 font-medium">Start a party or join an existing one.</p>
        </header>

        <div className="grid md:grid-cols-2 gap-8">
          {/* Create Room */}
          <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-6">
            <div className="flex items-center gap-3 text-red-500">
              <Plus size={24} />
              <h2 className="text-xl font-bold">Create Room</h2>
            </div>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="YouTube URL"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-red-600 transition-colors"
              />
              <button
                onClick={handleCreateRoom}
                className="w-full py-3 bg-red-600 hover:bg-red-700 font-bold rounded-xl transition-all active:scale-[0.98]"
              >
                Start Party
              </button>
            </div>
          </div>

          {/* Join Room */}
          <div className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-6">
            <div className="flex items-center gap-3 text-zinc-400">
              <ArrowRight size={24} />
              <h2 className="text-xl font-bold">Join Room</h2>
            </div>
            <div className="space-y-4">
              <input
                type="text"
                placeholder="Room ID"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
              />
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
    </div>
  );
};

const Room = ({ roomId, onLeave }: { roomId: string; onLeave: () => void }) => {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [player, setPlayer] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const isUpdatingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);

  useEffect(() => {
    const roomRef = doc(db, 'rooms', roomId);
    const unsubscribe = onSnapshot(roomRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as RoomState;
        setRoom(data);
        
        // Sync player if not the one who updated
        if (data.updatedBy !== auth.currentUser?.uid && player) {
          isUpdatingRef.current = true;
          
          // Sync play/pause
          if (data.isPlaying) {
            player.playVideo();
          } else {
            player.pauseVideo();
          }

          // Sync time if difference is > 2 seconds
          const localTime = player.getCurrentTime();
          if (Math.abs(localTime - data.currentTime) > 2) {
            player.seekTo(data.currentTime, true);
          }

          setTimeout(() => {
            isUpdatingRef.current = false;
          }, 500);
        }
      } else {
        alert("Room not found");
        onLeave();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `rooms/${roomId}`);
    });

    return () => unsubscribe();
  }, [roomId, player, onLeave]);

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

  const onPlayerReady: YouTubeProps['onReady'] = (event) => {
    setPlayer(event.target);
  };

  const onPlayerStateChange: YouTubeProps['onStateChange'] = (event) => {
    if (isUpdatingRef.current) return;

    const newState = event.data;
    const isPlaying = newState === YouTube.PlayerState.PLAYING;
    const currentTime = event.target.getCurrentTime();

    if (newState === YouTube.PlayerState.PLAYING || newState === YouTube.PlayerState.PAUSED) {
      updateRoomState({ isPlaying, currentTime });
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!room) return <div className="min-h-screen bg-zinc-950 flex items-center justify-center text-white">Loading Party...</div>;

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-zinc-900 flex items-center justify-between bg-zinc-950/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button onClick={onLeave} className="p-2 hover:bg-zinc-900 rounded-lg transition-colors">
            <LogOut size={20} className="rotate-180" />
          </button>
          <div>
            <h2 className="font-bold text-lg leading-tight">{room.name || "Watch Party"}</h2>
            <p className="text-xs text-zinc-500 font-mono uppercase tracking-wider">{roomId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={handleCopyLink}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-xl text-sm font-medium transition-all"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
            {copied ? "Copied!" : "Copy ID"}
          </button>
          <div className="w-10 h-10 rounded-full bg-red-600 flex items-center justify-center font-bold border-2 border-zinc-950 ring-2 ring-red-600/20">
            {auth.currentUser?.displayName?.[0] || "U"}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row gap-6 p-6 max-w-[1600px] mx-auto w-full">
        {/* Player Section */}
        <div className="flex-1 space-y-6">
          <div className="aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl border border-zinc-900">
            <YouTube
              videoId={room.videoId}
              opts={{
                width: '100%',
                height: '100%',
                playerVars: {
                  autoplay: 0,
                  controls: 1,
                  modestbranding: 1,
                  rel: 0,
                },
              }}
              onReady={onPlayerReady}
              onStateChange={onPlayerStateChange}
              className="w-full h-full"
            />
          </div>
          
          <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-3 h-3 rounded-full animate-pulse",
                room.isPlaying ? "bg-green-500" : "bg-zinc-500"
              )} />
              <span className="font-medium text-zinc-300">
                {room.isPlaying ? "Playing Now" : "Paused"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-zinc-500 text-sm">
              <Users size={16} />
              <span>Synced with friends</span>
            </div>
          </div>
        </div>

        {/* Sidebar / Info */}
        <div className="w-full lg:w-80 space-y-6">
          <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800 h-full">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <Share2 size={18} className="text-red-500" />
              Invite Friends
            </h3>
            <p className="text-sm text-zinc-400 mb-6">
              Share this Room ID with your friends to watch together.
            </p>
            <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800 font-mono text-center text-xl tracking-widest text-red-500">
              {roomId}
            </div>
          </div>
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

  return <Lobby onJoinRoom={setCurrentRoomId} />;
}
