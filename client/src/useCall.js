import { useCallback, useEffect, useRef, useState } from 'react';
import { sfx } from './sfx.js';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

const RING_TIMEOUT_MS = 45000;

/**
 * Owns everything WebRTC: local media, peer connections, signaling and the
 * ringing state for direct-message calls.
 */
export function useCall({ socket, onToast }) {
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const pcsRef = useRef(new Map());
  const callRef = useRef(null);
  const incomingRef = useRef(null);
  const ringStopRef = useRef(null);
  const pendingIceRef = useRef(new Map());
  const remoteStreamsRef = useRef({});
  const mutedRef = useRef(false);
  const cameraOnRef = useRef(false);

  const [call, _setCall] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [remoteStreams, _setRemoteStreams] = useState({});
  const [localStream, _setLocalStream] = useState(null);
  const [incoming, _setIncoming] = useState(null);
  const [muted, _setMuted] = useState(false);
  const [cameraOn, _setCameraOn] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  const setCall = useCallback((value) => {
    callRef.current = value;
    _setCall(value);
  }, []);

  const setIncoming = useCallback((value) => {
    incomingRef.current = value;
    _setIncoming(value);
  }, []);

  const setRemoteStreams = useCallback((updater) => {
    _setRemoteStreams((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      remoteStreamsRef.current = next;
      return next;
    });
  }, []);

  const setLocalStream = useCallback((stream) => {
    localStreamRef.current = stream;
    _setLocalStream(stream);
  }, []);

  const stopRing = useCallback(() => {
    if (ringStopRef.current) {
      ringStopRef.current();
      ringStopRef.current = null;
    }
  }, []);

  const closePeer = useCallback(
    (peerId) => {
      const pc = pcsRef.current.get(peerId);
      if (pc) {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        pcsRef.current.delete(peerId);
      }
      pendingIceRef.current.delete(peerId);
      setRemoteStreams((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    },
    [setRemoteStreams],
  );

  const cleanupCall = useCallback(() => {
    pcsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    });
    pcsRef.current.clear();
    pendingIceRef.current.clear();
    setRemoteStreams({});
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
    setCall(null);
    setParticipants([]);
    mutedRef.current = false;
    cameraOnRef.current = false;
    _setMuted(false);
    _setCameraOn(false);
    stopRing();
  }, [setCall, setLocalStream, setRemoteStreams, stopRing]);

  const emitSignal = useCallback((toUserId, data) => {
    const channelId = callRef.current?.channelId;
    if (!channelId) return;
    socketRef.current?.emit('call:signal', { toUserId, channelId, data });
  }, []);

  const ensurePeer = useCallback(
    (peerId) => {
      const existing = pcsRef.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      const local = localStreamRef.current;
      if (local) {
        local.getTracks().forEach((track) => pc.addTrack(track, local));
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          emitSignal(peerId, { type: 'ice', candidate: event.candidate });
        }
      };

      pc.ontrack = (event) => {
        const stream = event.streams[0];
        if (stream) {
          setRemoteStreams((prev) => ({ ...prev, [peerId]: stream }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          closePeer(peerId);
        }
      };

      pcsRef.current.set(peerId, pc);
      return pc;
    },
    [closePeer, emitSignal, setRemoteStreams],
  );

  const offerTo = useCallback(
    async (peerId) => {
      try {
        const pc = ensurePeer(peerId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitSignal(peerId, { type: 'offer', sdp: pc.localDescription });
      } catch (err) {
        console.warn('[call] could not create offer', err);
      }
    },
    [emitSignal, ensurePeer],
  );

  const flushIce = useCallback(async (peerId, pc) => {
    const queued = pendingIceRef.current.get(peerId) || [];
    pendingIceRef.current.delete(peerId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        /* ignore stale candidates */
      }
    }
  }, []);

  const startCall = useCallback(
    async (channelId, { video = false } = {}) => {
      const s = socketRef.current;
      if (!s || !channelId) return false;

      if (callRef.current?.channelId === channelId) {
        setMinimized(false);
        return true;
      }
      if (callRef.current) {
        s.emit('voice:leave');
        cleanupCall();
      }

      stopRing();
      setIncoming(null);

      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: video
            ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
            : false,
        });
      } catch {
        if (video) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            onToast?.('Camera unavailable — joining with voice only.', 'warn');
          } catch {
            onToast?.('Microphone access is required to join a call.', 'error');
            return false;
          }
        } else {
          onToast?.('Microphone access is required to join a call.', 'error');
          return false;
        }
      }

      setLocalStream(stream);
      const hasVideo = stream.getVideoTracks().length > 0;
      mutedRef.current = false;
      cameraOnRef.current = hasVideo;
      _setMuted(false);
      _setCameraOn(hasVideo);
      setRemoteStreams({});
      setParticipants([]);
      setCall({
        channelId,
        status: 'connecting',
        video: hasVideo,
        startedAt: Date.now(),
      });
      setMinimized(false);

      s.emit('voice:join', { channelId, camera: hasVideo });
      sfx.join();
      return true;
    },
    [cleanupCall, onToast, setCall, setIncoming, setLocalStream, setRemoteStreams, stopRing],
  );

  const leaveCall = useCallback(() => {
    socketRef.current?.emit('voice:leave');
    cleanupCall();
    sfx.leave();
  }, [cleanupCall]);

  const acceptIncoming = useCallback(async () => {
    const inc = incomingRef.current;
    if (!inc) return;
    const s = socketRef.current;
    setIncoming(null);
    stopRing();
    const joined = await startCall(inc.channelId, { video: Boolean(inc.video) });
    if (!joined) {
      s?.emit('call:decline', { channelId: inc.channelId, toUserId: inc.from.id });
    }
  }, [setIncoming, startCall, stopRing]);

  const declineIncoming = useCallback(() => {
    const inc = incomingRef.current;
    if (!inc) return;
    socketRef.current?.emit('call:decline', {
      channelId: inc.channelId,
      toUserId: inc.from.id,
    });
    setIncoming(null);
    stopRing();
    sfx.leave();
  }, [setIncoming, stopRing]);

  const toggleMute = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks?.()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    mutedRef.current = !track.enabled;
    _setMuted(!track.enabled);
    socketRef.current?.emit('voice:state', {
      muted: mutedRef.current,
      camera: cameraOnRef.current,
    });
    sfx.mute();
  }, []);

  const toggleCamera = useCallback(async () => {
    const local = localStreamRef.current;
    const s = socketRef.current;
    if (!local || !s || !callRef.current) return;

    const existingTrack = local.getVideoTracks()[0];
    if (existingTrack) {
      existingTrack.enabled = !existingTrack.enabled;
      cameraOnRef.current = existingTrack.enabled;
      _setCameraOn(existingTrack.enabled);
      s.emit('voice:state', { muted: mutedRef.current, camera: existingTrack.enabled });
      return;
    }

    let camStream;
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      });
    } catch {
      onToast?.('Could not access your camera.', 'error');
      return;
    }

    const track = camStream.getVideoTracks()[0];
    if (!track) return;
    local.addTrack(track);
    setLocalStream(new MediaStream(local.getTracks()));
    cameraOnRef.current = true;
    _setCameraOn(true);
    s.emit('voice:state', { muted: mutedRef.current, camera: true });

    for (const [peerId, pc] of pcsRef.current.entries()) {
      try {
        pc.addTrack(track, local);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        emitSignal(peerId, { type: 'offer', sdp: pc.localDescription });
      } catch (err) {
        console.warn('[call] camera renegotiation failed', err);
      }
    }
  }, [emitSignal, onToast, setLocalStream]);

  /* ---------------- socket wiring ---------------- */
  useEffect(() => {
    if (!socket) return undefined;

    const onVoiceJoined = ({ channelId, peers = [] }) => {
      if (callRef.current?.channelId !== channelId) return;
      const isDm = channelId.startsWith('dm:');
      setCall({
        ...callRef.current,
        status: isDm && peers.length === 0 ? 'ringing' : 'connected',
      });
      setParticipants(peers);
      peers.forEach((peer) => offerTo(peer.userId));
      if (isDm) sfx.join();
    };

    const onVoiceUpdate = ({ channelId, participants: list }) => {
      if (callRef.current?.channelId !== channelId) return;

      // A direct call is over as soon as the other person leaves.
      if (
        channelId.startsWith('dm:') &&
        callRef.current?.status === 'connected' &&
        (list?.length || 0) < 2
      ) {
        socket.emit('voice:leave');
        cleanupCall();
        onToast?.('The call ended.', 'info');
        return;
      }

      setParticipants(list || []);
      if (callRef.current?.status === 'ringing' && list?.length > 1) {
        setCall({ ...callRef.current, status: 'connected' });
      }
      const ids = new Set((list || []).map((p) => p.userId));
      setRemoteStreams((prev) => {
        let changed = false;
        const next = {};
        for (const [id, stream] of Object.entries(prev)) {
          if (ids.has(id)) next[id] = stream;
          else changed = true;
        }
        return changed ? next : prev;
      });
    };

    const onPeerJoined = ({ channelId }) => {
      if (callRef.current?.channelId !== channelId) return;
      if (callRef.current?.status === 'ringing') {
        setCall({ ...callRef.current, status: 'connected' });
      }
    };

    const onPeerLeft = ({ channelId, userId }) => {
      if (callRef.current?.channelId !== channelId) return;
      closePeer(userId);
      sfx.leave();
    };

    const onSignal = async ({ fromUserId, channelId, data }) => {
      if (callRef.current?.channelId !== channelId || !data) return;
      const pc = ensurePeer(fromUserId);
      try {
        if (data.type === 'offer') {
          await pc.setRemoteDescription(data.sdp);
          await flushIce(fromUserId, pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          emitSignal(fromUserId, { type: 'answer', sdp: pc.localDescription });
        } else if (data.type === 'answer') {
          await pc.setRemoteDescription(data.sdp);
          await flushIce(fromUserId, pc);
        } else if (data.type === 'ice' && data.candidate) {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(data.candidate);
          } else {
            const queue = pendingIceRef.current.get(fromUserId) || [];
            queue.push(data.candidate);
            pendingIceRef.current.set(fromUserId, queue);
          }
        }
      } catch (err) {
        console.warn('[call] signal error', err);
      }
    };

    const onIncoming = (payload) => {
      if (callRef.current) {
        socket.emit('call:decline', {
          channelId: payload.channelId,
          toUserId: payload.from.id,
        });
        return;
      }
      if (incomingRef.current) return;
      stopRing();
      setIncoming(payload);
      ringStopRef.current = sfx.ring();
    };

    const onAccepted = ({ channelId }) => {
      if (callRef.current?.channelId !== channelId) return;
      if (callRef.current?.status === 'ringing') {
        setCall({ ...callRef.current, status: 'connected' });
      }
    };

    const onDeclined = ({ channelId, by }) => {
      if (callRef.current?.channelId !== channelId) return;
      socket.emit('voice:leave');
      cleanupCall();
      onToast?.(`${by?.username || 'They'} declined the call.`, 'info');
      sfx.leave();
    };

    const onCancelled = ({ channelId }) => {
      if (incomingRef.current?.channelId === channelId) {
        setIncoming(null);
        stopRing();
        onToast?.('The call ended.', 'info');
      }
      if (callRef.current?.channelId === channelId) {
        cleanupCall();
      }
    };

    const onDisconnect = () => {
      if (callRef.current) {
        cleanupCall();
        onToast?.('Call disconnected — you went offline.', 'warn');
      }
      if (incomingRef.current) {
        setIncoming(null);
        stopRing();
      }
    };

    socket.on('voice:joined', onVoiceJoined);
    socket.on('voice:update', onVoiceUpdate);
    socket.on('voice:peer_joined', onPeerJoined);
    socket.on('voice:peer_left', onPeerLeft);
    socket.on('call:signal', onSignal);
    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:declined', onDeclined);
    socket.on('call:cancelled', onCancelled);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('voice:joined', onVoiceJoined);
      socket.off('voice:update', onVoiceUpdate);
      socket.off('voice:peer_joined', onPeerJoined);
      socket.off('voice:peer_left', onPeerLeft);
      socket.off('call:signal', onSignal);
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:declined', onDeclined);
      socket.off('call:cancelled', onCancelled);
      socket.off('disconnect', onDisconnect);
    };
  }, [
    socket,
    cleanupCall,
    closePeer,
    emitSignal,
    ensurePeer,
    flushIce,
    offerTo,
    onToast,
    setCall,
    setIncoming,
    setRemoteStreams,
    stopRing,
  ]);

  /* auto-end unanswered outgoing DM calls */
  useEffect(() => {
    if (!call || call.status !== 'ringing' || !call.channelId.startsWith('dm:')) return undefined;
    const timer = setTimeout(() => {
      if (callRef.current?.status === 'ringing' && callRef.current?.channelId === call.channelId) {
        socketRef.current?.emit('voice:leave');
        cleanupCall();
        onToast?.('No answer — call ended.', 'info');
      }
    }, RING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [call, cleanupCall, onToast]);

  /* release media on unmount */
  useEffect(
    () => () => {
      if (callRef.current) socketRef.current?.emit('voice:leave');
      stopRing();
      pcsRef.current.forEach((pc) => {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
      });
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [stopRing],
  );

  return {
    call,
    participants,
    remoteStreams,
    localStream,
    incoming,
    muted,
    cameraOn,
    minimized,
    setMinimized,
    startCall,
    leaveCall,
    acceptIncoming,
    declineIncoming,
    toggleMute,
    toggleCamera,
  };
}
