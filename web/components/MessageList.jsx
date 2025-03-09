import React from 'react';
import styled from 'styled-components';

const QuickActions = styled.div`
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
`;

const QuickButton = styled.button`
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: #f0f0f0;
    transform: scale(1.1);
  }
`;

function MessageList({ messages }) {
  return (
    <div className="message-list">
      {messages.map(message => (
        <div 
          key={message.id} 
          className={`message ${message.isMedia ? 'media' : ''}`}
          style={{ position: 'relative' }}
        >
          <QuickActions className="quick-actions">
            <QuickButton onClick={() => console.log('Aggiungi nota')}>📝 Nota</QuickButton>
            <QuickButton onClick={() => console.log('Registra')}>🎙 Registra</QuickButton>
          </QuickActions>
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
