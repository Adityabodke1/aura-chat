import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, getToken, setToken } from './api.js';
import { createSocket } from './socket.js';
import { useCall } from './useCall.js';
import { sfx } from './sfx.js';
import { dmChannelId, roomChannelId } from './utils.js';
import { applyTheme, getTheme } from './theme.js';

import AuthScreen from './components/AuthScreen.jsx';
import GuildRail from './components/GuildRail.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatView from './components/ChatView.jsx';
import FriendsView from './components/FriendsView.jsx';
import MembersPanel from './components/MembersPanel.jsx';
import CallDock from './components/CallDock.jsx';
import IncomingCall from './components/IncomingCall.jsx';
import { Toasts } from './components/Toasts.jsx';
import { BrandMark, Spinner } from './components/Common.jsx';
import {
  CreateRoomModal,
  JoinRoomModal,
  RoomInfoModal,
  SettingsModal,
  ImageLightbox,
} from './components/Modals.jsx';

function mergeMessages(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const message of list || []) map.set(message.id, message);
  }
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function channelForView(view, myId) {
  if (view.type === 'dm' && myId) return dmChannelId(myId, view.id);
  if (view.type === 'room') return roomChannelId(view.id);
  return null;
}

export default function App() {
  const [token, setTokenState] = useState(() => getToken());
  const [boot, setBoot] = useState(null);
  const [authNotice, setAuthNotice] = useState('');
  const [loadingBoot, setLoadingBoot] = useState(() => Boolean(getToken()));
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  const [view, setView] = useState({ type: 'friends' });
  const [friendsTab, setFriendsTab] = useState('online');
  const [messages, setMessages] = useState({});
  const [unread, setUnread] = useState({});
  const [online, setOnline] = useState([]);
  const [typing, setTyping] = useState({});
  const [voiceByChannel, setVoiceByChannel] = useState({});
  const [deafened, setDeafened] = useState(false);
  const [soundOn, setSoundOn] = useState(() => sfx.enabled);
  const [modal, setModal] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(getTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const meRef = useRef(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const activeChannelRef = useRef(null);
  const typingTimersRef = useRef({});

  const pushToast = useCallback((message, kind = 'info') => {
    if (!message) return;
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, kind }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4800);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /* --------------------------- boot --------------------------- */
  useEffect(() => {
    if (!token) {
      setBoot(null);
      setLoadingBoot(false);
      return undefined;
    }
    let cancelled = false;
    setLoadingBoot(true);
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        setBoot(data);
        meRef.current = data.user;
      })
      .catch(() => {
        if (cancelled) return;
        setToken(null);
        setTokenState(null);
        setBoot(null);
        setAuthNotice('Your session expired. Please log in again.');
      })
      .finally(() => {
        if (!cancelled) setLoadingBoot(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.me();
      setBoot(data);
      meRef.current = data.user;
    } catch {
      /* the socket will surface connection issues */
    }
  }, []);

  /* --------------------------- socket -------------------------- */
  useEffect(() => {
    if (!token || !boot?.user?.id) return undefined;
    const s = createSocket(token);
    setSocket(s);
    setConnected(s.connected);

    const onConnect = () => {
      setConnected(true);
      const channelId = activeChannelRef.current;
      if (channelId) {
        s.emit('channel:open', { channelId });
        api
          .messages(channelId)
          .then(({ messages: list }) => {
            setMessages((prev) => ({ ...prev, [channelId]: mergeMessages(prev[channelId], list) }));
          })
          .catch(() => {});
      }
      const current = viewRef.current;
      if (current.type === 'room') {
        s.emit('room:request-voice', { channelId: roomChannelId(current.id) });
      }
    };

    const onDisconnect = () => setConnected(false);

    const onPresence = (payload) => setOnline(payload?.online || []);

    const onMessage = (message) => {
      setMessages((prev) => {
        const existing = prev[message.channelId];
        if (!existing) return prev;
        return { ...prev, [message.channelId]: mergeMessages(existing, [message]) };
      });

      const myId = meRef.current?.id;
      const activeChannel = channelForView(viewRef.current, myId);
      if (
        message.type === 'user' &&
        message.userId !== myId &&
        message.channelId !== activeChannel
      ) {
        setUnread((prev) => ({
          ...prev,
          [message.channelId]: (prev[message.channelId] || 0) + 1,
        }));
        sfx.message();
      }
    };

    const onMessageDeleted = ({ channelId, messageId }) => {
      setMessages((prev) => {
        const list = prev[channelId];
        if (!list) return prev;
        return { ...prev, [channelId]: list.filter((m) => m.id !== messageId) };
      });
    };

    const onMessageUpdated = (message) => {
      if (!message?.id || !message?.channelId) return;
      setMessages((prev) => {
        const list = prev[message.channelId];
        if (!list) return prev;
        return {
          ...prev,
          [message.channelId]: mergeMessages(list, [message]),
        };
      });
    };

    const onTyping = ({ channelId, user }) => {
      if (!channelId || !user) return;
      setTyping((prev) => ({ ...prev, [channelId]: user.username }));
      clearTimeout(typingTimersRef.current[channelId]);
      typingTimersRef.current[channelId] = setTimeout(() => {
        setTyping((prev) => {
          if (!(channelId in prev)) return prev;
          const next = { ...prev };
          delete next[channelId];
          return next;
        });
      }, 3800);
    };

    const onFriendRequest = ({ user }) => {
      pushToast(`${user.username} sent you a friend request.`, 'info');
      refresh();
    };
    const onFriendAccepted = ({ user }) => {
      pushToast(`You're now friends with ${user.username}.`, 'info');
      refresh();
    };
    const onRoomsChanged = () => refresh();
    const onMemberJoined = ({ roomName, user }) => {
      pushToast(`${user.username} joined ${roomName}.`, 'info');
      refresh();
    };
    const onRoomOtp = () => refresh();

    const onVoiceUpdate = ({ channelId, participants }) => {
      setVoiceByChannel((prev) => ({ ...prev, [channelId]: participants || [] }));
    };

    const onError = ({ message }) => pushToast(message, 'error');

    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    s.on('connect_error', (err) => {
      setConnected(false);
      if (err?.message === 'unauthorized') {
        setToken(null);
        setTokenState(null);
        setBoot(null);
        setAuthNotice('Your session expired. Please log in again.');
      }
    });
    s.on('presence:update', onPresence);
    s.on('message:new', onMessage);
    s.on('message:deleted', onMessageDeleted);
    s.on('message:updated', onMessageUpdated);
    s.on('typing', onTyping);
    s.on('friends:changed', refresh);
    s.on('friend:request', onFriendRequest);
    s.on('friend:accepted', onFriendAccepted);
    s.on('rooms:changed', onRoomsChanged);
    s.on('room:member_joined', onMemberJoined);
    s.on('room:otp', onRoomOtp);
    s.on('voice:update', onVoiceUpdate);
    s.on('app:error', onError);

    return () => {
      s.close();
      setSocket(null);
      setConnected(false);
    };
  }, [token, boot?.user?.id, refresh, pushToast]);

  const callApi = useCall({ socket, onToast: pushToast });

  useEffect(() => {
    return () => {
      Object.values(typingTimersRef.current).forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const me = boot?.user || null;
  const myId = me?.id;

  const activeRoom =
    view.type === 'room' && boot ? boot.rooms.find((room) => room.id === view.id) : null;
  const activeFriend =
    view.type === 'dm' && boot ? boot.friends.find((friend) => friend.id === view.id) : null;
  const channelId = channelForView(view, myId);
  activeChannelRef.current = channelId;

  const onlineSet = useMemo(() => new Set(online), [online]);

  /* --------------------------- view guards -------------------- */
  useEffect(() => {
    if (!boot) return;
    if (view.type === 'room' && !boot.rooms.some((room) => room.id === view.id)) {
      setView({ type: 'friends' });
    }
    if (view.type === 'dm' && !boot.friends.some((friend) => friend.id === view.id)) {
      setView({ type: 'friends' });
    }
  }, [boot, view]);

  /* --------------------------- messages ----------------------- */
  useEffect(() => {
    if (!channelId) return undefined;
    setUnread((prev) => {
      if (!prev[channelId]) return prev;
      const next = { ...prev };
      delete next[channelId];
      return next;
    });
    let cancelled = false;
    api
      .messages(channelId)
      .then(({ messages: list }) => {
        if (cancelled) return;
        setMessages((prev) => ({
          ...prev,
          [channelId]: mergeMessages(prev[channelId], list),
        }));
      })
      .catch((err) => pushToast(err.message, 'error'));
    return () => {
      cancelled = true;
    };
  }, [channelId, pushToast]);

  useEffect(() => {
    if (!socket || !channelId) return;
    socket.emit('channel:open', { channelId });
    if (view.type === 'room') socket.emit('room:request-voice', { channelId });
  }, [socket, channelId, view.type]);

  /* --------------------------- title -------------------------- */
  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0);
  useEffect(() => {
    let title = 'Aura Chat';
    if (view.type === 'room' && activeRoom) title = `#${activeRoom.name} · Aura`;
    else if (view.type === 'dm' && activeFriend) title = `${activeFriend.username} · Aura`;
    document.title = totalUnread ? `(${totalUnread}) ${title}` : title;
  }, [view, activeRoom, activeFriend, totalUnread]);

  /* --------------------------- auth --------------------------- */
  const handleAuth = useCallback((newToken, data) => {
    setToken(newToken);
    setTokenState(newToken);
    setBoot(data);
    meRef.current = data.user;
    setLoadingBoot(false);
    setAuthNotice('');
    setView({ type: 'friends' });
    setFriendsTab('online');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    setToken(null);
    setTokenState(null);
    setBoot(null);
    setMessages({});
    setUnread({});
    setOnline([]);
    setTyping({});
    setVoiceByChannel({});
    setModal(null);
    setDeafened(false);
    setView({ type: 'friends' });
    setAuthNotice('');
  }, []);

  /* --------------------------- navigation --------------------- */
  const openFriends = useCallback((tab = 'online') => {
    setView({ type: 'friends' });
    setFriendsTab(tab);
    setSidebarOpen(false);
  }, []);

  const openDm = useCallback((friend) => {
    setView({ type: 'dm', id: friend.id });
    setSidebarOpen(false);
  }, []);

  const selectRoom = useCallback((roomId) => {
    setView({ type: 'room', id: roomId });
    setSidebarOpen(false);
  }, []);

  const openRoomInfo = useCallback(() => {
    if (view.type === 'room') setModal({ type: 'roomInfo', roomId: view.id });
  }, [view]);

  const copyRoomCode = useCallback(async () => {
    const room = view.type === 'room' ? boot?.rooms.find((r) => r.id === view.id) : null;
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.otp);
      pushToast('Room code copied — send it to a friend.', 'info');
    } catch {
      pushToast('Could not copy the room code.', 'error');
    }
  }, [view, boot, pushToast]);

  const handleRoomCreated = useCallback(
    (room) => {
      setBoot((prev) => (prev ? { ...prev, rooms: [...prev.rooms, room] } : prev));
      setView({ type: 'room', id: room.id });
      setSidebarOpen(false);
      setModal({ type: 'roomInfo', roomId: room.id });
      refresh();
    },
    [refresh],
  );

  const handleRoomJoined = useCallback(
    (room) => {
      setBoot((prev) =>
        prev
          ? {
              ...prev,
              rooms: [...prev.rooms.filter((r) => r.id !== room.id), room],
            }
          : prev,
      );
      setView({ type: 'room', id: room.id });
      setSidebarOpen(false);
      setModal(null);
      refresh();
    },
    [refresh],
  );

  const handleLeaveRoom = useCallback(
    (roomId) => {
      if (callApi.call?.channelId === roomChannelId(roomId)) callApi.leaveCall();
      setModal(null);
      setView({ type: 'friends' });
      setVoiceByChannel((prev) => {
        const next = { ...prev };
        delete next[`room:${roomId}`];
        return next;
      });
      refresh();
    },
    [callApi, refresh],
  );

  const callLabel = useMemo(() => {
    if (!callApi.call) return '';
    const channel = callApi.call.channelId;
    if (channel.startsWith('room:')) {
      const found = boot?.rooms.find((room) => `room:${room.id}` === channel);
      return found ? `#${found.name}` : 'Room call';
    }
    if (channel.startsWith('dm:')) {
      const otherId = channel.slice(3).split(':').find((id) => id !== myId);
      const friend = boot?.friends.find((f) => f.id === otherId);
      return friend ? `@${friend.username}` : 'Direct call';
    }
    return 'Call';
  }, [callApi.call, boot, myId]);

  /* --------------------------- render ------------------------- */
  if (!token) {
    return <AuthScreen onAuth={handleAuth} notice={authNotice} />;
  }

  if (!boot) {
    return (
      <div className="splash">
        <BrandMark size={46} />
        <Spinner size={26} />
        <p>{loadingBoot ? 'Connecting to Aura…' : 'Preparing your space…'}</p>
      </div>
    );
  }

  const roomModal =
    modal?.type === 'roomInfo' ? boot.rooms.find((room) => room.id === modal.roomId) : null;

  return (
    <div className="app-shell">
      <div className="app-aurora" aria-hidden="true">
        <span className="aurora-blob aurora-a" />
        <span className="aurora-blob aurora-b" />
        <span className="aurora-blob aurora-c" />
        <span className="aurora-grain" />
      </div>

      <GuildRail
        rooms={boot.rooms}
        view={view}
        unread={unread}
        onHome={() => openFriends(friendsTab)}
        onSelectRoom={selectRoom}
        onCreateRoom={() => setModal({ type: 'createRoom' })}
        onJoinRoom={() => setModal({ type: 'joinRoom' })}
      />

      <Sidebar
        boot={boot}
        me={me}
        view={view}
        setView={(next) => {
          setView(next);
          setSidebarOpen(false);
        }}
        online={online}
        unread={unread}
        friendsTab={friendsTab}
        onOpenFriends={openFriends}
        room={activeRoom}
        voiceByChannel={voiceByChannel}
        call={callApi.call}
        callLabel={callLabel}
        onStartCall={callApi.startCall}
        onOpenRoomInfo={openRoomInfo}
        onCopyCode={copyRoomCode}
        onCreateRoom={() => setModal({ type: 'createRoom' })}
        onJoinRoom={() => setModal({ type: 'joinRoom' })}
        onOpenSettings={() => setModal({ type: 'settings' })}
        muted={callApi.muted}
        onToggleMute={callApi.toggleMute}
        deafened={deafened}
        onToggleDeafen={() => setDeafened((v) => !v)}
        onToast={pushToast}
        onUnminimize={() => callApi.setMinimized(false)}
        onLeaveCall={callApi.leaveCall}
        mobileOpen={sidebarOpen}
      />

      {sidebarOpen && <div className="mobile-scrim" onClick={() => setSidebarOpen(false)} />}

      {view.type === 'friends' ? (
        <FriendsView
          boot={boot}
          me={me}
          onlineSet={onlineSet}
          tab={friendsTab}
          setTab={setFriendsTab}
          onOpenDm={openDm}
          onStartCall={callApi.startCall}
          onToast={pushToast}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      ) : channelId && (activeRoom || activeFriend) ? (
        <ChatView
          me={me}
          room={activeRoom}
          friend={activeFriend}
          channelId={channelId}
          messages={messages[channelId] || []}
          onlineSet={onlineSet}
          typingUser={typing[channelId]}
          socket={socket}
          call={callApi.call}
          onStartCall={callApi.startCall}
          onShowCall={() => callApi.setMinimized(false)}
          onOpenRoomInfo={openRoomInfo}
          onOpenImage={(attachment) => setModal({ type: 'image', attachment })}
          onToast={pushToast}
          onOpenSidebar={() => setSidebarOpen(true)}
        />
      ) : null}

      {activeRoom && (
        <MembersPanel
          room={activeRoom}
          me={me}
          online={online}
          voiceByChannel={voiceByChannel}
        />
      )}

      <CallDock
        call={callApi.minimized ? null : callApi.call}
        label={callLabel}
        me={me}
        participants={callApi.participants}
        remoteStreams={callApi.remoteStreams}
        localStream={callApi.localStream}
        muted={callApi.muted}
        cameraOn={callApi.cameraOn}
        deafened={deafened}
        onToggleMute={callApi.toggleMute}
        onToggleCamera={callApi.toggleCamera}
        onLeave={callApi.leaveCall}
        onMinimize={() => callApi.setMinimized(true)}
      />

      <IncomingCall
        incoming={callApi.incoming}
        onAccept={callApi.acceptIncoming}
        onDecline={callApi.declineIncoming}
      />

      <Toasts toasts={toasts} dismiss={dismissToast} />

      {!connected && <div className="connection-banner">Reconnecting to Aura…</div>}

      {modal?.type === 'createRoom' && (
        <CreateRoomModal onClose={() => setModal(null)} onCreated={handleRoomCreated} />
      )}
      {modal?.type === 'joinRoom' && (
        <JoinRoomModal
          onClose={() => setModal(null)}
          onJoined={handleRoomJoined}
          onToast={pushToast}
        />
      )}
      {roomModal && (
        <RoomInfoModal
          room={roomModal}
          me={me}
          onClose={() => setModal(null)}
          onRegenerated={refresh}
          onLeft={() => handleLeaveRoom(roomModal.id)}
          onToast={pushToast}
        />
      )}
      {modal?.type === 'settings' && (
        <SettingsModal
          user={me}
          soundOn={soundOn}
          theme={theme}
          onThemeChange={setTheme}
          onSoundChange={(value) => {
            sfx.setEnabled(value);
            setSoundOn(value);
          }}
          onLogout={logout}
          onClose={() => setModal(null)}
          onToast={pushToast}
        />
      )}
      {modal?.type === 'image' && (
        <ImageLightbox attachment={modal.attachment} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
