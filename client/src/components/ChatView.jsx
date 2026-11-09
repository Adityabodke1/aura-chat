import React, { useEffect, useRef, useState } from 'react';
import {
  HashIcon,
  LockIcon,
  MenuIcon,
  PhoneIcon,
  UserPlusIcon,
  VideoIcon,
} from './Icons.jsx';
import { Avatar, EmptyArt } from './Common.jsx';
import MessageItem from './MessageItem.jsx';
import Composer from './Composer.jsx';
import { formatDayLabel, roomChannelId, startOfDay } from '../utils.js';

export default function ChatView({
  me,
  room,
  friend,
  channelId,
  messages,
  onlineSet,
  typingUser,
  socket,
  call,
  onStartCall,
  onShowCall,
  onOpenRoomInfo,
  onOpenImage,
  onToast,
  onOpenSidebar,
}) {
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const dragCounter = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [dropFile, setDropFile] = useState(null);

  const isRoom = Boolean(room);
  const displayName = isRoom ? room.name : friend?.username || 'Unknown';
  const friendOnline = friend ? onlineSet.has(friend.id) : false;

  useEffect(() => {
    stickRef.current = true;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [channelId]);

  useEffect(() => {
    if (!stickRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typingUser]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
  }

  function startVoice(video) {
    if (call?.channelId === channelId) {
      onShowCall?.();
      return;
    }
    if (!isRoom && friend && !friendOnline) {
      onToast?.(`${friend.username} is offline right now.`, 'info');
      return;
    }
    onStartCall?.(channelId, { video });
  }

  function deleteMessage(message) {
    socket?.emit('message:delete', { channelId, messageId: message.id });
  }

  function reactMessage(message, emoji) {
    socket?.emit('message:react', { channelId, messageId: message.id, emoji });
  }

  function editMessage(message, text) {
    socket?.emit('message:edit', { channelId, messageId: message.id, text });
  }

  const rendered = [];
  let previous = null;
  for (const message of messages) {
    if (message.type === 'system') {
      previous = null;
      rendered.push(
        <div className="system-message" key={message.id}>
          <span className="system-arrow">→</span>
          <span>{message.text}</span>
          <span className="system-time">{formatDayLabel(message.createdAt)}</span>
        </div>,
      );
      continue;
    }

    const showDay = !previous || startOfDay(previous.createdAt) !== startOfDay(message.createdAt);
    const grouped =
      !showDay &&
      previous &&
      previous.type === 'user' &&
      previous.userId === message.userId &&
      message.createdAt - previous.createdAt < 5 * 60 * 1000;

    if (showDay) {
      rendered.push(
        <div className="day-divider" key={`day-${message.id}`}>
          <span>{formatDayLabel(message.createdAt)}</span>
        </div>,
      );
    }

    rendered.push(
      <MessageItem
        key={message.id}
        message={message}
        grouped={Boolean(grouped)}
        me={me}
        canManage={message.userId === me.id || (isRoom && room.ownerId === me.id)}
        onDelete={deleteMessage}
        onEdit={editMessage}
        onReact={reactMessage}
        onImageClick={onOpenImage}
        onToast={onToast}
      />,
    );
    previous = message;
  }

  function handleDragEnter(event) {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  }

  function handleDragLeave() {
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) setDropFile(file);
  }

  return (
    <main
      className="chat-view"
      onDragEnter={handleDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <header className="chat-header">
        <button className="mobile-menu icon-btn" onClick={onOpenSidebar} aria-label="Open menu">
          <MenuIcon size={20} />
        </button>

        {isRoom ? (
          <>
            <HashIcon size={24} className="header-hash" />
            <h1 className="chat-header-name">{displayName}</h1>
            <span className="header-divider" />
            <button className="invite-pill" onClick={onOpenRoomInfo} title="Show room code">
              <LockIcon size={12} />
              Invite-only
            </button>
          </>
        ) : (
          <>
            <Avatar user={friend} size={24} status={friendOnline} />
            <h1 className="chat-header-name">{displayName}</h1>
            <span className="header-divider" />
            <span className={`chat-header-status ${friendOnline ? 'online' : ''}`}>
              {friendOnline ? 'Online' : 'Offline'}
            </span>
          </>
        )}

        <div className="chat-header-actions">
          {isRoom && (
            <button
              className="header-icon-btn"
              onClick={onOpenRoomInfo}
              data-tooltip="Room info & code"
              aria-label="Room info"
            >
              <UserPlusIcon size={20} />
            </button>
          )}
          <button
            className="header-icon-btn"
            onClick={() => startVoice(false)}
            data-tooltip={isRoom ? 'Join voice' : 'Voice call'}
            aria-label="Start voice call"
          >
            <PhoneIcon size={20} />
          </button>
          <button
            className="header-icon-btn"
            onClick={() => startVoice(true)}
            data-tooltip={isRoom ? 'Join with camera' : 'Video call'}
            aria-label="Start video call"
          >
            <VideoIcon size={21} />
          </button>
        </div>
      </header>

      <div className="message-scroll" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            {isRoom ? (
              <>
                <div className="chat-empty-icon">
                  <HashIcon size={36} />
                </div>
                <h2>Welcome to #{room.name}</h2>
                <p>
                  This is the start of the room. Share the code{' '}
                  <b className="inline-code">{room.otp}</b> so friends can drop in.
                </p>
              </>
            ) : (
              <>
                <Avatar user={friend} size={76} className="chat-empty-avatar" />
                <h2>{displayName}</h2>
                <p>This is the beginning of your direct message history with {displayName}.</p>
              </>
            )}
            <EmptyArt variant="chat" />
          </div>
        ) : (
          <div className="messages">{rendered}</div>
        )}
      </div>

      <div className={`typing-bar ${typingUser ? 'visible' : ''}`}>
        {typingUser && (
          <>
            <b>{typingUser}</b> is typing
            <span className="typing-dots">
              <i />
              <i />
              <i />
            </span>
          </>
        )}
      </div>

      <Composer
        channelId={channelId}
        socket={socket}
        onToast={onToast}
        placeholder={isRoom ? `Message #${room.name}` : `Message @${displayName}`}
        dropFile={dropFile}
        onDropConsumed={() => setDropFile(null)}
      />

      {dragging && (
        <div className="drop-overlay">
          <div className="drop-card">
            <div className="drop-icon">
              <HashIcon size={30} />
            </div>
            <h3>Upload a file</h3>
            <p>Drop it anywhere to share with {isRoom ? 'the room' : displayName}</p>
          </div>
        </div>
      )}
    </main>
  );
}
