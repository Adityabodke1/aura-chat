import React from 'react';
import { Avatar } from './Common.jsx';
import { PhoneIcon, PhoneOffIcon, VideoIcon } from './Icons.jsx';

export default function IncomingCall({ incoming, onAccept, onDecline }) {
  if (!incoming) return null;
  return (
    <div className="incoming-backdrop">
      <div className="incoming-card">
        <div className="incoming-pulse">
          <span className="pulse-ring ring-one" />
          <span className="pulse-ring ring-two" />
          <span className="pulse-ring ring-three" />
          <Avatar user={incoming.from} size={92} className="incoming-avatar" />
        </div>

        <span className="incoming-kicker">
          {incoming.video ? <VideoIcon size={14} /> : <PhoneIcon size={14} />}
          Incoming {incoming.video ? 'video' : 'voice'} call
        </span>
        <h2>{incoming.from.username}</h2>
        <p>is calling you…</p>

        <div className="incoming-actions">
          <div className="incoming-action">
            <button className="call-round decline" onClick={onDecline} aria-label="Decline call">
              <PhoneOffIcon size={26} />
            </button>
            <span>Decline</span>
          </div>
          <div className="incoming-action">
            <button className="call-round accept" onClick={onAccept} aria-label="Accept call">
              <PhoneIcon size={26} />
            </button>
            <span>Accept</span>
          </div>
        </div>
      </div>
    </div>
  );
}
