import React, { useState } from 'react';
import MessageList from './MessageList';

function ChatItem({ chat }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={`chat-item ${isOpen ? 'open' : ''}`}>
      <div className="chat-header" onClick={() => setIsOpen(!isOpen)}>
        <h3>{chat.name}</h3>
        <span>{chat.lastMessage.senderName}: {chat.lastMessage.content}</span>
      </div>
      {isOpen && <MessageList messages={chat.messages} />}
    </div>
  );
}

export default ChatItem;
