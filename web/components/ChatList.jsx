import React from 'react';
import ChatItem from './ChatItem';

function ChatList({ chats }) {
  return (
    <div className="chat-list">
      {chats
        .sort((a, b) => {
          // Ordiniamo per timestamp dell'ultimo messaggio
          const aTime = a.messages.length > 0 ? new Date(a.messages[a.messages.length - 1].timestamp) : 0;
          const bTime = b.messages.length > 0 ? new Date(b.messages[b.messages.length - 1].timestamp) : 0;
          return bTime - aTime;
        })
        .map(chat => (
          <ChatItem key={chat.id} chat={chat} />
        ))}
    </div>
  );
}

export default ChatList;
