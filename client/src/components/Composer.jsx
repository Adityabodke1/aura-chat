import React, { useEffect, useRef, useState } from 'react';
import { api, mediaUrl } from '../api.js';
import { sfx } from '../sfx.js';
import { formatBytes } from '../utils.js';
import { ImageIcon, PaperclipIcon, SendIcon, SmileIcon, XIcon } from './Icons.jsx';
import { Spinner } from './Common.jsx';

const EMOJIS = [
  '😀', '😂', '🥹', '😍', '😎', '🤔', '😅', '🙌',
  '👏', '🔥', '✨', '💜', '💙', '❤️', '🎉', '🍕',
  '☕', '🌙', '⭐', '🐱', '🐶', '👀', '👍', '👎',
  '🫶', '🤝', '💀', '🤯', '🥳', '😴', '🎮', '🎧',
];

export default function Composer({ channelId, placeholder, socket, onToast, dropFile, onDropConsumed }) {
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiRef = useRef(null);
  const typingRef = useRef(0);

  useEffect(() => {
    setText('');
    setAttachment(null);
    setEmojiOpen(false);
    textareaRef.current?.focus();
  }, [channelId]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    if (!emojiOpen) return undefined;
    const onDown = (event) => {
      if (emojiRef.current && !emojiRef.current.contains(event.target)) setEmojiOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [emojiOpen]);

  async function uploadFile(file) {
    if (!file) return;
    if (!/^(image|video|audio)\//.test(file.type || '')) {
      onToast?.('Only images, videos and audio files can be shared.', 'error');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      onToast?.('That file is too large — 50 MB max.', 'error');
      return;
    }
    setUploading(true);
    try {
      const uploaded = await api.upload(file);
      setAttachment(uploaded);
    } catch (err) {
      onToast?.(err.message, 'error');
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!dropFile) return;
    uploadFile(dropFile);
    onDropConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropFile]);

  function send() {
    const body = text.trim();
    if (uploading) {
      onToast?.('Hang tight — your file is still uploading.', 'info');
      return;
    }
    if (!body && !attachment) return;
    if (!socket?.connected) {
      onToast?.('You are offline. Reconnecting…', 'error');
      return;
    }
    socket.emit('message:send', {
      channelId,
      text: body,
      attachment: attachment || undefined,
    });
    setText('');
    setAttachment(null);
    sfx.sent();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function onKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function onChange(event) {
    setText(event.target.value);
    const now = Date.now();
    if (event.target.value && now - typingRef.current > 2200) {
      typingRef.current = now;
      socket?.emit('typing:start', { channelId });
    }
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  }

  function onPaste(event) {
    const file = [...(event.clipboardData?.files || [])][0];
    if (file) {
      event.preventDefault();
      uploadFile(file);
    }
  }

  const canSend = (text.trim().length > 0 || Boolean(attachment)) && !uploading;

  return (
    <div className="composer-shell">
      {(attachment || uploading) && (
        <div className="composer-attachment">
          {uploading ? (
            <>
              <span className="ca-icon">
                <Spinner size={18} />
              </span>
              <div className="ca-info">
                <b>Uploading…</b>
                <span>Getting your file ready</span>
              </div>
            </>
          ) : (
            <>
              {attachment.type === 'image' ? (
                <img src={mediaUrl(attachment.url)} alt="" className="ca-thumb" />
              ) : (
                <span className="ca-icon">
                  {attachment.type === 'video' ? <ImageIcon size={18} /> : <PaperclipIcon size={18} />}
                </span>
              )}
              <div className="ca-info">
                <b>{attachment.name}</b>
                <span>{formatBytes(attachment.size)}</span>
              </div>
              <button
                className="icon-btn"
                onClick={() => setAttachment(null)}
                aria-label="Remove attachment"
              >
                <XIcon size={16} />
              </button>
            </>
          )}
        </div>
      )}

      <div className="composer">
        <button
          className="composer-icon-btn"
          onClick={() => fileInputRef.current?.click()}
          data-tooltip="Upload a file"
          aria-label="Upload a file"
          type="button"
        >
          <PaperclipIcon size={20} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,audio/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadFile(file);
            e.target.value = '';
          }}
        />

        <textarea
          ref={textareaRef}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={placeholder}
          rows={1}
          maxLength={4000}
          aria-label={placeholder}
        />

        <div className="composer-right" ref={emojiRef}>
          <button
            className={`composer-icon-btn ${emojiOpen ? 'active' : ''}`}
            onClick={() => setEmojiOpen((v) => !v)}
            data-tooltip="Emoji"
            aria-label="Emoji picker"
            type="button"
          >
            <SmileIcon size={20} />
          </button>
          <button
            className={`composer-send ${canSend ? 'ready' : ''}`}
            onClick={send}
            disabled={!canSend}
            aria-label="Send message"
            type="button"
          >
            <SendIcon size={18} />
          </button>

          {emojiOpen && (
            <div className="emoji-picker">
              <div className="emoji-picker-head">Emoji</div>
              <div className="emoji-grid">
                {EMOJIS.map((emoji) => (
                  <button key={emoji} type="button" onClick={() => insertEmoji(emoji)}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
