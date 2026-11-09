import React, { useEffect, useRef, useState } from 'react';
import { Avatar } from './Common.jsx';
import RichText from './RichText.jsx';
import { CopyIcon, EditIcon, PaperclipIcon, TrashIcon } from './Icons.jsx';
import { formatBytes, formatTime } from '../utils.js';
import { mediaUrl } from '../api.js';

const QUICK_REACTIONS = ['❤️', '😂', '🔥', '👍', '✨'];

async function copyText(value, onToast) {
  try {
    await navigator.clipboard.writeText(value);
    onToast?.('Copied to clipboard.', 'info');
  } catch {
    onToast?.('Could not copy to clipboard.', 'error');
  }
}

function Attachment({ attachment, onImageClick }) {
  if (!attachment) return null;
  const url = mediaUrl(attachment.url);
  if (attachment.type === 'image') {
    return (
      <button
        className="attachment-image"
        onClick={() => onImageClick?.({ ...attachment, url })}
        title="Open image"
      >
        <img src={url} alt={attachment.name} loading="lazy" />
      </button>
    );
  }
  if (attachment.type === 'video') {
    return (
      <video
        className="attachment-video"
        src={url}
        controls
        preload="metadata"
        playsInline
      />
    );
  }
  if (attachment.type === 'audio') {
    return (
      <div className="attachment-audio">
        <PaperclipIcon size={16} />
        <div className="attachment-audio-info">
          <b>{attachment.name}</b>
          <span>{formatBytes(attachment.size)}</span>
        </div>
        <audio src={url} controls preload="metadata" />
      </div>
    );
  }
  return (
    <a className="attachment-file" href={url} target="_blank" rel="noreferrer">
      <span className="attachment-file-icon">
        <PaperclipIcon size={18} />
      </span>
      <span className="attachment-file-info">
        <b>{attachment.name}</b>
        <span>{formatBytes(attachment.size)}</span>
      </span>
    </a>
  );
}

export default function MessageItem({
  message,
  grouped,
  me,
  canManage,
  onDelete,
  onEdit,
  onReact,
  onImageClick,
  onToast,
}) {
  const user = {
    username: message.username,
    avatarColor: message.avatarColor,
  };
  const isOwn = message.userId === me.id;
  const reactions =
    message.reactions && typeof message.reactions === 'object' ? message.reactions : {};
  const reactionEntries = Object.entries(reactions).filter(
    ([, users]) => Array.isArray(users) && users.length > 0,
  );

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text || '');
  const [bursts, setBursts] = useState([]);
  const editRef = useRef(null);
  const burstRef = useRef(0);

  useEffect(() => {
    if (!editing) setDraft(message.text || '');
  }, [message.text, editing]);

  useEffect(() => {
    if (!editing) return;
    const el = editRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  function startEdit() {
    setDraft(message.text || '');
    setEditing(true);
  }

  function saveEdit() {
    const value = draft.trim();
    setEditing(false);
    if (!value || value === message.text) return;
    onEdit?.(message, value);
  }

  function onEditKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditing(false);
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      saveEdit();
    }
  }

  function sendReaction(emoji) {
    onReact?.(message, emoji);
    burstRef.current += 1;
    const id = `${Date.now()}_${burstRef.current}`;
    setBursts((list) => [...list.slice(-4), { id, emoji }]);
  }

  return (
    <div
      className={`message ${grouped ? 'grouped' : ''} ${isOwn ? 'is-self' : ''} ${
        reactionEntries.length ? 'has-reactions' : ''
      }`}
    >
      <div className="message-avatar-col">
        {grouped ? (
          <span className="message-hover-time">{formatTime(message.createdAt)}</span>
        ) : (
          <Avatar user={user} size={40} className="message-avatar" />
        )}
      </div>

      <div className="message-content">
        {!grouped && (
          <div className="message-head">
            <span className={`message-author ${isOwn ? 'is-self' : ''}`}>{message.username}</span>
            <span className="message-time" title={new Date(message.createdAt).toLocaleString()}>
              {formatTime(message.createdAt)}
            </span>
            {message.editedAt && (
              <span className="edited-tag" title={`Edited ${new Date(message.editedAt).toLocaleString()}`}>
                (edited)
              </span>
            )}
          </div>
        )}

        {editing ? (
          <div className="message-edit">
            <textarea
              ref={editRef}
              className="message-edit-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onEditKeyDown}
              maxLength={4000}
              rows={Math.min(6, Math.max(1, draft.split('\n').length))}
              aria-label="Edit message"
            />
            <div className="message-edit-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={saveEdit} disabled={!draft.trim()}>
                Save
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <span className="message-edit-hint">Enter to save · Esc to cancel</span>
            </div>
          </div>
        ) : (
          message.text && (
            <div className="message-text">
              <RichText text={message.text} />
            </div>
          )
        )}

        {message.attachment && (
          <Attachment attachment={message.attachment} onImageClick={onImageClick} />
        )}

        {reactionEntries.length > 0 && (
          <div className="message-reactions">
            {reactionEntries.map(([emoji, users]) => {
              const mine = users.includes(me.id);
              return (
                <button
                  key={emoji}
                  type="button"
                  className={`reaction-chip ${mine ? 'mine' : ''}`}
                  onClick={() => sendReaction(emoji)}
                  aria-label={`React with ${emoji}`}
                  aria-pressed={mine}
                  title={`${users.length} reaction${users.length === 1 ? '' : 's'}`}
                >
                  <span className="reaction-emoji">{emoji}</span>
                  <b>{users.length}</b>
                </button>
              );
            })}
          </div>
        )}

        {bursts.map((burst) => (
          <span
            key={burst.id}
            className="reaction-burst"
            aria-hidden="true"
            onAnimationEnd={() => setBursts((list) => list.filter((entry) => entry.id !== burst.id))}
          >
            {burst.emoji}
          </span>
        ))}
      </div>

      <div className="message-actions">
        <div className="message-quick-reactions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="message-action quick-react"
              onClick={() => sendReaction(emoji)}
              data-tooltip={`React ${emoji}`}
              aria-label={`React with ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
        <span className="message-action-divider" />
        <button
          className="message-action"
          onClick={() =>
            copyText(message.text || mediaUrl(message.attachment?.url) || '', onToast)
          }
          data-tooltip="Copy"
          aria-label="Copy message"
        >
          <CopyIcon size={16} />
        </button>
        {isOwn && onEdit && (
          <button
            className="message-action"
            onClick={startEdit}
            data-tooltip="Edit"
            aria-label="Edit message"
          >
            <EditIcon size={16} />
          </button>
        )}
        {canManage && (
          <button
            className="message-action danger"
            onClick={() => onDelete?.(message)}
            data-tooltip="Delete"
            aria-label="Delete message"
          >
            <TrashIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
