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
  X,
  List
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

function extractVideoId(url: string) {
  const regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[7].length === 11) ? match[7] : null;
}

// --- Utils ---
function extractSpotifyUri(input: string) {
  if (input.startsWith('spotify:')) return input;
  if (input.includes('spotify.com')) {
    const parts = input.split('?')[0].split('/');
    const id = parts.pop();
    const type = input.includes('playlist') ? 'playlist' : 'track';
    return `spotify:${type}:${id}`;
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

interface QueueItem {
  id: string;
  mediaId: string;
  mediaType: 'youtube' | 'spotify';
  title: string;
  addedBy: string;
  addedByName: string;
  timestamp: any;
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

const Lobby = ({ onJoinRoom }: { onJoinRoom: (id: string, type: 'youtube' | 'spotify') => void }) => {
  const [roomId, setRoomId] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [lobbyType, setLobbyType] = useState<'youtube' | 'spotify'>('youtube');

  const handleCreateRoom = async () => {
    let finalVid = "";
    let finalSpotifyUri = "";

    if (lobbyType === 'youtube') {
      finalVid = extractVideoId(videoUrl) || "";
    } else {
      finalSpotifyUri = extractSpotifyUri(videoUrl) || "";
    }

    if (lobbyType === 'youtube' && !finalVid) {
      alert("Please enter a valid YouTube URL");
      return;
    }
    if (lobbyType === 'spotify' && !finalSpotifyUri) {
      alert("Please enter a valid Spotify URL or URI");
      return;
    }

    const newRoomId = nanoid(10);
    const roomRef = doc(db, 'rooms', newRoomId);
    
    try {
      await setDoc(roomRef, {
        videoId: finalVid || "",
        spotifyUri: finalSpotifyUri || "",
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
    <div className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6 flex flex-col items-center justify-center">
      <div className="max-w-4xl w-full space-y-8 sm:space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-4xl sm:text-6xl font-black tracking-tighter italic">
            <span className="text-white">SYNC</span>
            <span className={cn(lobbyType === 'youtube' ? "text-red-600" : "text-green-500")}>
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
              onClick={() => setLobbyType('spotify')}
              className={cn(
                "px-4 sm:px-6 py-2 rounded-full text-sm sm:text-base font-bold transition-all border-2",
                lobbyType === 'spotify' ? "bg-green-500 border-green-500 text-white" : "border-zinc-800 text-zinc-500 hover:border-zinc-700"
              )}
            >
              SPOTIFY
            </button>
          </div>
        </header>

        <div className="grid md:grid-cols-2 gap-6 sm:gap-8">
          {/* Create Room */}
          <div className={cn(
            "bg-zinc-900/50 border p-6 sm:p-8 rounded-3xl space-y-6 transition-colors",
            lobbyType === 'youtube' ? "border-red-900/30" : "border-green-900/30"
          )}>
            <div className="flex items-center gap-3">
              <Plus size={24} className={lobbyType === 'youtube' ? "text-red-500" : "text-green-500"} />
              <h2 className="text-xl font-bold">Create {lobbyType === 'youtube' ? "Room" : "Jam"}</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Paste Link</label>
                <input
                  type="text"
                  placeholder={lobbyType === 'youtube' ? "YouTube Video URL" : "Spotify Track/Playlist URL"}
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors"
                />
              </div>
              <button
                onClick={handleCreateRoom}
                className={cn(
                  "w-full py-3 font-bold rounded-xl transition-all active:scale-[0.98]",
                  lobbyType === 'youtube' ? "bg-red-600 hover:bg-red-700" : "bg-green-500 hover:bg-green-600 text-black"
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
                onClick={() => roomId && onJoinRoom(roomId, 'youtube')}
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
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'activity' | 'queue'>('chat');
  const [showSidebar, setShowSidebar] = useState(false);
  
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
      senderName: auth.currentUser?.displayName || 'Anonymous',
      timestamp: serverTimestamp()
    });
    setChatInput('');
  };

  const addToQueue = async (val: string) => {
    if (!val.trim()) return;
    let mediaType: 'youtube' | 'spotify' = 'youtube';
    let mediaId = extractVideoId(val);
    let title = '';

    if (mediaId) {
      mediaType = 'youtube';
      title = `YouTube: ${mediaId}`;
    } else {
      mediaId = extractSpotifyUri(val);
      if (mediaId) {
        mediaType = 'spotify';
        title = `Spotify: ${mediaId.split(':')[2] || mediaId}`;
      }
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
    if (queue.length === 0) return;
    const nextItem = queue[0];
    const updates: Partial<RoomState> = {
      mediaType: nextItem.mediaType,
      currentTime: 0,
      isPlaying: true
    };
    if (nextItem.mediaType === 'youtube') {
      updates.videoId = nextItem.mediaId;
    } else {
      updates.spotifyUri = nextItem.mediaId;
    }
    
    await updateRoomState(updates);
    await removeFromQueue(nextItem.id);
    addActivity('change_video', `playing next: ${nextItem.title}`);
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

  const onPlayerEnd = () => {
    playNext();
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
              <div key={p.uid} className="w-8 h-8 sm:w-10 sm:h-10 rounded-full bg-zinc-800 border-2 border-zinc-950 flex items-center justify-center text-[10px] sm:text-xs font-bold" title={p.displayName}>
                {p.displayName[0]}
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
        {/* Player Section */}
        <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-y-auto min-h-0">
          <div className="flex gap-2 mb-4">
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
              onClick={() => updateRoomState({ mediaType: 'spotify' })}
              className={cn(
                "px-4 py-2 rounded-xl text-[10px] sm:text-xs font-bold transition-all",
                room.mediaType === 'spotify' ? "bg-green-600 text-white" : "bg-zinc-900 text-zinc-500"
              )}
            >
              SPOTIFY
            </button>
          </div>

          <div className="aspect-video bg-black rounded-2xl sm:rounded-3xl overflow-hidden shadow-2xl border border-zinc-900 shrink-0">
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
                onEnd={onPlayerEnd}
                className="w-full h-full"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center p-4 sm:p-8 bg-zinc-900/50">
                <div className="w-full max-w-md space-y-4">
                  <div className="flex items-center gap-3 text-green-500 mb-2 sm:mb-6">
                    <div className="p-2 sm:p-3 bg-green-500/10 rounded-2xl">
                      <Plus size={20} sm:size={24} />
                    </div>
                    <h3 className="text-lg sm:text-xl font-bold">Spotify Jam</h3>
                  </div>
                  
                  {room.spotifyUri && (
                    <iframe 
                      src={`https://open.spotify.com/embed/${room.spotifyUri.split(':')[1]}/${room.spotifyUri.split(':')[2]}`}
                      width="100%" 
                      height="352" 
                      frameBorder="0" 
                      allow="encrypted-media"
                      className="rounded-2xl shadow-2xl"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
          
          <div className="mt-6 space-y-4">
            <div className="bg-zinc-900/30 p-4 sm:p-6 rounded-2xl sm:rounded-3xl border border-zinc-800/50">
              <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest mb-4">Change Media</h3>
              <div className="flex flex-col sm:flex-row gap-3">
                <input 
                  type="text"
                  placeholder={room.mediaType === 'youtube' ? "Paste YouTube Link" : "Paste Spotify Link"}
                  className="flex-1 bg-zinc-950 border border-zinc-800 px-4 py-3 rounded-xl focus:outline-none focus:border-zinc-600 transition-colors text-sm"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const val = (e.target as HTMLInputElement).value;
                      const vid = extractVideoId(val);
                      const uri = extractSpotifyUri(val);
                      
                      if (vid) {
                        updateRoomState({ mediaType: 'youtube', videoId: vid, currentTime: 0, isPlaying: true });
                        addActivity('change_video', vid);
                        (e.target as HTMLInputElement).value = '';
                      } else if (uri) {
                        updateRoomState({ mediaType: 'spotify', spotifyUri: uri, currentTime: 0, isPlaying: true });
                        addActivity('change_video', `Spotify: ${uri.split(':')[1]}`);
                        (e.target as HTMLInputElement).value = '';
                      }
                    }
                  }}
                />
                <div className="flex gap-2">
                  <button 
                    onClick={(e) => {
                      const input = (e.currentTarget.parentElement?.previousSibling as HTMLInputElement);
                      const val = input.value;
                      const vid = extractVideoId(val);
                      const uri = extractSpotifyUri(val);
                      
                      if (vid) {
                        updateRoomState({ mediaType: 'youtube', videoId: vid, currentTime: 0, isPlaying: true });
                        addActivity('change_video', vid);
                        input.value = '';
                      } else if (uri) {
                        updateRoomState({ mediaType: 'spotify', spotifyUri: uri, currentTime: 0, isPlaying: true });
                        addActivity('change_video', `Spotify: ${uri.split(':')[1]}`);
                        input.value = '';
                      }
                    }}
                    className={cn(
                      "flex-1 sm:flex-none px-6 py-3 rounded-xl font-bold text-sm transition-all active:scale-95",
                      room.mediaType === 'youtube' ? "bg-red-600" : "bg-green-600 text-black"
                    )}
                  >
                    Play Now
                  </button>
                  <button 
                    onClick={(e) => {
                      const input = (e.currentTarget.parentElement?.previousSibling as HTMLInputElement);
                      addToQueue(input.value);
                      input.value = '';
                    }}
                    className="flex-1 sm:flex-none px-6 py-3 rounded-xl font-bold text-sm bg-zinc-800 hover:bg-zinc-700 transition-all active:scale-95"
                  >
                    Add Queue
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-zinc-600 mt-2 italic">Play Now replaces current media. Add Queue puts it in the line.</p>
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
                  "flex flex-col max-w-[85%]",
                  msg.senderId === auth.currentUser?.uid ? "ml-auto items-end" : "items-start"
                )}>
                  <span className="text-[10px] text-zinc-500 mb-1 px-1">{msg.senderName}</span>
                  <div className={cn(
                    "px-4 py-2 rounded-2xl text-sm",
                    msg.senderId === auth.currentUser?.uid ? "bg-zinc-100 text-black rounded-tr-none" : "bg-zinc-900 text-zinc-200 rounded-tl-none"
                  )}>
                    {msg.text}
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
