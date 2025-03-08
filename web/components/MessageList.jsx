import React from 'react';

function MessageList({ messages }) {
  return (
    <div className="message-list">
      {messages.map(message => (
        <div key={message.id} className={`message ${message.isMedia ? 'media' : ''}`}>
          <div className="message-sender">{message.senderName}</div>
          {message.isMedia ? (
            <img src={message.mediaPath} alt="Media content" />
          ) : (
            <div className="message-content">{message.content}</div>
          )}
          <div className="message-timestamp">
            {new Date(message.timestamp).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  );
}

export default MessageList;
