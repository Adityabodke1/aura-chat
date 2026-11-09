import React, { useMemo, useState } from 'react';
import {
  ChevronDownIcon,
  CopyIcon,
  HashIcon,
  HeadphonesIcon,
  HeadphonesOffIcon,
  MicIcon,
  MicOffIcon,
  PhoneOffIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  VolumeIcon,
  WifiIcon,
} from './Icons.jsx';
import { Avatar } from './Common.jsx';
import { dmChannelId, roomChannelId } from '../utils.js';

export default function Sidebar({
  boot,
  me,
  view,
  setView,
  online,
  unread,
  friendsTab,
  onOpenFriends,
  room,
  voiceByChannel,
  call,
  callLabel,
  onStartCall,
  onOpenRoomInfo,
  onCopyCode,
  onCreateRoom,
  onJoinRoom,
  onOpenSettings,
  muted,
  onToggleMute,
  deafened,
  onToggleDeafen,
  onToast,
  onUnminimize,
  onLeaveCall,
  mobileOpen,
}) {
  const [query, setQuery] = useState('');
  const onlineSet = useMemo(() => new Set(online), [online]);
  const pendingCount = boot.incoming.length;

  const friends = useMemo(() => {
    const list = [...boot.friends];
    list.sort((a, b) => {
      const aOn = onlineSet.has(a.id) ? 0 : 1;
      const bOn = onlineSet.has(b.id) ? 0 : 1;
      if (aOn !== bOn) return aOn - bOn;
      return a.username.localeCompare(b.username);
    });
    return list;
  }, [boot.friends, onlineSet]);

  const filteredFriends = query.trim()
    ? friends.filter((f) => f.username.toLowerCase().includes(query.trim().toLowerCase()))
    : friends;

  const inRoomView = view.type === 'room' && room;
  const voiceChannelId = room ? roomChannelId(room.id) : null;
  const inThisVoice = call && room && call.channelId === voiceChannelId;
  const roomVoice = room ? voiceByChannel[voiceChannelId] || [] : [];

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      {inRoomView ? (
        <>
          <button className="sidebar-room-header" onClick={onOpenRoomInfo}>
            <span className="sidebar-room-name">{room.name}</span>
            <ChevronDownIcon size={18} />
          </button>

          <div className="channel-scroll">
            <div className="channel-group">
              <div className="channel-group-label">Text Channels</div>
              <button
                className={`channel-row ${view.type === 'room' ? 'active' : ''}`}
                onClick={() => setView({ type: 'room', id: room.id })}
              >
                <HashIcon size={20} />
                <span>general</span>
              </button>
            </div>

            <div className="channel-group">
              <div className="channel-group-label">Voice Channels</div>
              <button
                className={`channel-row voice-row ${inThisVoice ? 'connected' : ''}`}
                onClick={() => {
                  if (inThisVoice) onUnminimize?.();
                  else onStartCall(voiceChannelId, { video: false });
                }}
                title={inThisVoice ? 'Show call' : 'Join voice'}
              >
                <VolumeIcon size={20} />
                <span>Voice</span>
                {inThisVoice && <span className="live-pill">LIVE</span>}
                {!inThisVoice && <span className="voice-join-hint">Join</span>}
              </button>

              {roomVoice.length > 0 && (
                <div className="voice-user-list">
                  {roomVoice.map((p) => (
                    <div key={p.userId} className="voice-user">
                      <Avatar
                        user={{
                          username: p.username,
                          avatarColor: p.avatarColor,
                        }}
                        size={22}
                        className={p.muted ? 'is-muted' : ''}
                      />
                      <span>{p.userId === me.id ? `${p.username} (you)` : p.username}</span>
                      {p.muted && <MicOffIcon size={13} className="voice-user-icon" />}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button className="room-code-card" onClick={onCopyCode} title="Copy room code">
              <span className="room-code-label">Room code · invite only</span>
              <span className="room-code-value">
                {room.otp.slice(0, 3)} {room.otp.slice(3)}
                <CopyIcon size={15} />
              </span>
              <span className="room-code-hint">Click to copy · friends can join with this code</span>
            </button>

            <div className="sidebar-room-actions">
              <button className="sidebar-room-action" onClick={onCreateRoom}>
                <PlusIcon size={15} /> New room
              </button>
              <button className="sidebar-room-action" onClick={onJoinRoom}>
                <HashIcon size={15} /> Join with code
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="sidebar-search">
            <SearchIcon size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find or start a conversation"
              aria-label="Search conversations"
            />
          </div>

          <div className="home-nav">
            <button
              className={`home-nav-item ${view.type === 'friends' ? 'active' : ''}`}
              onClick={() => onOpenFriends(friendsTab)}
            >
              <UsersIcon size={20} />
              <span>Friends</span>
              {pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
          </div>

          <div className="dm-section">
            <div className="channel-group-label dm-label">
              <span>Direct Messages</span>
              <button
                className="dm-add"
                onClick={() => onOpenFriends('add')}
                data-tooltip="Add a friend"
                aria-label="Add a friend"
              >
                <PlusIcon size={15} />
              </button>
            </div>

            <div className="dm-list">
              {filteredFriends.map((friend) => {
                const channelId = dmChannelId(me.id, friend.id);
                const active = view.type === 'dm' && view.id === friend.id;
                const count = unread[channelId] || 0;
                return (
                  <button
                    key={friend.id}
                    className={`dm-row ${active ? 'active' : ''}`}
                    onClick={() => setView({ type: 'dm', id: friend.id })}
                  >
                    <Avatar
                      user={friend}
                      size={32}
                      status={onlineSet.has(friend.id)}
                    />
                    <span className="dm-name">{friend.username}</span>
                    {count > 0 && <span className="badge">{count > 9 ? '9+' : count}</span>}
                  </button>
                );
              })}
              {filteredFriends.length === 0 && (
                <p className="dm-empty">
                  {boot.friends.length === 0
                    ? 'No friends yet — add one by exact username.'
                    : 'No conversations match your search.'}
                </p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="sidebar-bottom">
        {call && (
          <div className={`voice-connected ${call.status === 'ringing' ? 'is-ringing' : ''}`}>
            <button className="voice-connected-main" onClick={onUnminimize} title="Show call">
              <span className="voice-connected-icon">
                <WifiIcon size={16} />
              </span>
              <span className="voice-connected-text">
                <b>{callLabel}</b>
                <span>{call.status === 'ringing' ? 'Ringing…' : 'Voice Connected'}</span>
              </span>
            </button>
            <button className="voice-hangup" onClick={onLeaveCall} title="Disconnect">
              <PhoneOffIcon size={18} />
            </button>
          </div>
        )}

        <div className="user-panel">
          <div className="user-info">
            <Avatar user={me} size={32} status />
            <div className="user-meta">
              <span className="user-name">{me.username}</span>
              <span className="user-status">
                <i /> Online
              </span>
            </div>
          </div>
          <div className="user-actions">
            <button
              className={`icon-btn ${call && muted ? 'danger' : ''}`}
              onClick={call ? onToggleMute : () => onToast?.('Join a voice channel to use your microphone.', 'info')}
              data-tooltip={call && muted ? 'Unmute' : 'Mute'}
              aria-label="Mute"
            >
              {call && muted ? <MicOffIcon size={18} /> : <MicIcon size={18} />}
            </button>
            <button
              className={`icon-btn ${deafened ? 'danger' : ''}`}
              onClick={onToggleDeafen}
              data-tooltip={deafened ? 'Undeafen' : 'Deafen'}
              aria-label="Deafen"
            >
              {deafened ? <HeadphonesOffIcon size={18} /> : <HeadphonesIcon size={18} />}
            </button>
            <button
              className="icon-btn"
              onClick={onOpenSettings}
              data-tooltip="User Settings"
              aria-label="User settings"
            >
              <SettingsIcon size={18} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
