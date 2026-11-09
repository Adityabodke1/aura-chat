import React from 'react';
import { AuraLogo, HomeIcon, PlusIcon, LockIcon } from './Icons.jsx';
import { initials, roomAccent } from '../utils.js';

export default function GuildRail({ rooms, view, unread, onHome, onSelectRoom, onCreateRoom, onJoinRoom }) {
  const homeActive = view.type !== 'room';

  return (
    <nav className="guild-rail" aria-label="Rooms">
      <button
        className={`rail-item rail-home ${homeActive ? 'active' : ''}`}
        onClick={onHome}
        data-tooltip="Direct Messages"
        aria-label="Direct Messages"
      >
        <span className="rail-pill" />
        <span className="rail-icon home-icon">
          {homeActive ? <AuraLogo size={28} /> : <HomeIcon size={25} />}
        </span>
      </button>

      <div className="rail-divider" />

      <div className="rail-rooms">
        {rooms.map((room) => {
          const active = view.type === 'room' && view.id === room.id;
          const count = unread[`room:${room.id}`] || 0;
          return (
            <button
              key={room.id}
              className={`rail-item ${active ? 'active' : ''} ${count ? 'has-unread' : ''}`}
              onClick={() => onSelectRoom(room.id)}
              data-tooltip={room.name}
              aria-label={`Room ${room.name}`}
            >
              <span className="rail-pill" />
              <span className="rail-icon room-icon" style={{ background: roomAccent(room.name) }}>
                {initials(room.name)}
              </span>
              {count > 0 && !active && <span className="rail-unread-dot" />}
              <span className="rail-tooltip">
                <b>{room.name}</b>
                <small>{room.members.length} member{room.members.length === 1 ? '' : 's'}</small>
              </span>
            </button>
          );
        })}
      </div>

      <button
        className="rail-item rail-action"
        onClick={onCreateRoom}
        data-tooltip="Create a room"
        aria-label="Create a room"
      >
        <span className="rail-icon">
          <PlusIcon size={22} />
        </span>
      </button>

      <button
        className="rail-item rail-action"
        onClick={onJoinRoom}
        data-tooltip="Join with code"
        aria-label="Join a room with a code"
      >
        <span className="rail-icon">
          <LockIcon size={20} />
        </span>
      </button>
    </nav>
  );
}
