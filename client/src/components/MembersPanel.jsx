import React from 'react';
import { Avatar } from './Common.jsx';
import { CrownIcon, MicOffIcon } from './Icons.jsx';

function MemberRow({ member, online, owner, voice }) {
  return (
    <div className={`member-row ${online ? '' : 'offline'}`}>
      <Avatar user={member} size={32} status={online} />
      <div className="member-meta">
        <span className="member-name">{member.username}</span>
        {owner && (
          <span className="member-owner" title="Room owner">
            <CrownIcon size={12} />
          </span>
        )}
      </div>
      {voice?.muted && <MicOffIcon size={14} className="member-muted" />}
    </div>
  );
}

export default function MembersPanel({ room, me, online, voiceByChannel }) {
  const onlineSet = new Set(online);
  const voice = voiceByChannel[`room:${room.id}`] || [];
  const voiceMap = new Map(voice.map((v) => [v.userId, v]));
  const sorted = [...room.members].sort((a, b) => {
    if (a.id === room.ownerId) return -1;
    if (b.id === room.ownerId) return 1;
    return a.username.localeCompare(b.username);
  });
  const onlineMembers = sorted.filter((m) => onlineSet.has(m.id));
  const offlineMembers = sorted.filter((m) => !onlineSet.has(m.id));

  return (
    <aside className="members-panel">
      <div className="members-scroll">
        {onlineMembers.length > 0 && (
          <div className="member-group">
            <div className="member-group-label">Online — {onlineMembers.length}</div>
            {onlineMembers.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                online
                owner={member.id === room.ownerId}
                voice={voiceMap.get(member.id)}
              />
            ))}
          </div>
        )}
        {offlineMembers.length > 0 && (
          <div className="member-group">
            <div className="member-group-label">Offline — {offlineMembers.length}</div>
            {offlineMembers.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                online={false}
                owner={member.id === room.ownerId}
              />
            ))}
          </div>
        )}
        {voice.length > 0 && (
          <div className="member-group voice-members">
            <div className="member-group-label">In Voice — {voice.length}</div>
            {voice.map((p) => (
              <div className="member-row" key={p.userId}>
                <Avatar
                  user={{ username: p.username, avatarColor: p.avatarColor }}
                  size={24}
                  className="voice-avatar"
                />
                <div className="member-meta">
                  <span className="member-name">{p.userId === me.id ? `${p.username} (you)` : p.username}</span>
                </div>
                {p.muted && <MicOffIcon size={13} className="member-muted" />}
              </div>
            ))}
          </div>
        )}
      </div>
      {room.ownerId === me.id && (
        <div className="members-footer">
          <CrownIcon size={13} /> You own this room
        </div>
      )}
    </aside>
  );
}
