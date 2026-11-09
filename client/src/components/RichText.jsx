import React from 'react';

const TOKEN_RE = /(https?:\/\/[^\s<]+|\*\*[^*\n]+\*\*|\*[^*\n]+\*|__[^_\n]+__|~~[^~\n]+~~|`[^`\n]+`)/g;

function renderToken(token, index) {
  if (/^https?:\/\//.test(token)) {
    const trailing = token.match(/[.,!?;:)]+$/)?.[0] || '';
    const href = trailing ? token.slice(0, -trailing.length) : token;
    return (
      <span key={index}>
        <a href={href} target="_blank" rel="noreferrer noopener" className="chat-link">
          {href}
        </a>
        {trailing}
      </span>
    );
  }
  if (token.startsWith('**')) return <strong key={index}>{token.slice(2, -2)}</strong>;
  if (token.startsWith('__')) return <u key={index}>{token.slice(2, -2)}</u>;
  if (token.startsWith('~~')) return <s key={index}>{token.slice(2, -2)}</s>;
  if (token.startsWith('`')) return <code key={index}>{token.slice(1, -1)}</code>;
  if (token.startsWith('*')) return <em key={index}>{token.slice(1, -1)}</em>;
  return token;
}

export default function RichText({ text = '' }) {
  const parts = [];
  let last = 0;
  let match;
  TOKEN_RE.lastIndex = 0;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(renderToken(match[0], parts.length));
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
