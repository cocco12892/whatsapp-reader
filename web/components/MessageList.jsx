import React, { useState } from 'react';
import styled from 'styled-components';

const ContextMenu = styled.div`
  position: fixed;
  background: white;
  border: 1px solid #ddd;
  border-radius: 4px;
  box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  z-index: 1000;
  min-width: 120px;
`;

const MenuItem = styled.div`
  padding: 8px 12px;
  font-size: 14px;
  cursor: pointer;
  &:hover {
    background: #f0f0f0;
  }
`;

function MessageList({ messages }) {
  const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, messageId: null });

  const handleContextMenu = (e, messageId) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: e.pageX,
      y: e.pageY,
      messageId
    });
  };

  const handleKeyDown = (e, messageId) => {
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      handleRecord(messageId);
    }
  };

  const handleRecord = (messageId) => {
    console.log('Registrazione per messaggio:', messageId);
    // Qui implementa la logica di registrazione
  };

  const handleNote = (messageId) => {
    console.log('Aggiungi nota per messaggio:', messageId);
    // Qui implementa la logica per aggiungere note
  };

  const closeContextMenu = () => {
    setContextMenu({ visible: false, x: 0, y: 0, messageId: null });
  };

  return (
    <div className="message-list" onClick={closeContextMenu}>
      {messages.map(message => (
        <div 
          key={message.id} 
          className={`message ${message.isMedia ? 'media' : ''}`}
          style={{ position: 'relative' }}
          onContextMenu={(e) => handleContextMenu(e, message.id)}
          onKeyDown={(e) => handleKeyDown(e, message.id)}
          tabIndex={0}
        >
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

      {contextMenu.visible && (
        <ContextMenu style={{ top: contextMenu.y, left: contextMenu.x }}>
          <MenuItem onClick={() => handleNote(contextMenu.messageId)}>📝 Aggiungi nota</MenuItem>
          <MenuItem onClick={() => handleRecord(contextMenu.messageId)}>🎙 Registra</MenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

export default MessageList;
