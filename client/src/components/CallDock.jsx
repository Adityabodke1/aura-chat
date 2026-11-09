import React, { useEffect, useRef } from 'react';
import { Avatar } from './Common.jsx';
import {
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
  WifiIcon,
} from './Icons.jsx';

function StreamVideo({ stream, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className="call-video" />;
}

function StreamAudio({ stream, deafened }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay muted={deafened} className="call-audio" />;
}

export default function CallDock({
  call,
  label,
  me,
  participants,
  remoteStreams,
  localStream,
  muted,
  cameraOn,
  deafened,
  onToggleMute,
  onToggleCamera,
  onLeave,
  onMinimize,
}) {
  if (!call) return null;

  const tiles =
    participants.length > 0
      ? participants
      : [
          {
            userId: me.id,
            username: me.username,
            avatarColor: me.avatarColor,
            muted,
            camera: cameraOn,
          },
        ];

  const status =
    call.status === 'ringing'
      ? 'Ringing…'
      : call.status === 'connecting'
        ? 'Connecting…'
        : 'Voice Connected';

  return (
    <section className="call-dock" aria-label="Call">
      <header className="call-dock-head">
        <div className="call-dock-title">
          <span className="call-dock-signal">
            <WifiIcon size={15} />
          </span>
          <div>
            <b>{label}</b>
            <span>{status}</span>
          </div>
        </div>
        <button className="icon-btn call-dock-min" onClick={onMinimize} data-tooltip="Minimize">
          <MinimizeIcon size={17} />
        </button>
      </header>

      <div className={`call-grid count-${Math.min(tiles.length, 4)}`}>
        {tiles.map((participant) => {
          const isSelf = participant.userId === me.id;
          const stream = isSelf ? localStream : remoteStreams[participant.userId];
          const showVideo = Boolean(stream) && (isSelf ? cameraOn : participant.camera) && stream?.getVideoTracks?.().length > 0;
          return (
            <div className={`call-tile ${showVideo ? 'has-video' : ''}`} key={participant.userId}>
              {showVideo ? (
                <StreamVideo stream={stream} muted={isSelf} />
              ) : (
                <div className="call-tile-placeholder">
                  <Avatar
                    user={{ username: participant.username, avatarColor: participant.avatarColor }}
                    size={64}
                  />
                </div>
              )}
              {!isSelf && stream && <StreamAudio stream={stream} deafened={deafened} />}
              <div className="call-tile-name">
                <span>{isSelf ? `${participant.username} (you)` : participant.username}</span>
                {(isSelf ? muted : participant.muted) && <MicOffIcon size={13} />}
              </div>
              {showVideo && (
                <span className="call-tile-video-badge">
                  <VideoIcon size={12} />
                </span>
              )}
            </div>
          );
        })}
      </div>

      {call.status === 'ringing' && (
        <div className="call-ringing-note">
          <span className="ring-dot" /> Waiting for them to pick up…
        </div>
      )}

      <div className="call-controls">
        <button
          className={`call-control ${muted ? 'is-off' : ''}`}
          onClick={onToggleMute}
          data-tooltip={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <MicOffIcon size={20} /> : <MicIcon size={20} />}
          <span>{muted ? 'Unmute' : 'Mute'}</span>
        </button>
        <button
          className={`call-control ${cameraOn ? 'is-on' : 'is-off'}`}
          onClick={onToggleCamera}
          data-tooltip={cameraOn ? 'Turn camera off' : 'Turn camera on'}
        >
          {cameraOn ? <VideoIcon size={20} /> : <VideoOffIcon size={20} />}
          <span>{cameraOn ? 'Camera on' : 'Camera off'}</span>
        </button>
        <button className="call-control is-danger" onClick={onLeave} data-tooltip="Disconnect">
          <PhoneOffIcon size={20} />
          <span>Disconnect</span>
        </button>
      </div>
    </section>
  );
}
