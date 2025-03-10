import React, { useState, useEffect } from 'react';
import MessageList from './MessageList';

function ChatItem({ chat }) {
  const [isOpen, setIsOpen] = useState(false);
  const [profileImageUrl, setProfileImageUrl] = useState(null);

  useEffect(() => {
    // Log per debuggare l'immagine del profilo
    console.log('Chat Profile Image Path:', chat.profileImage);
    
    // Aggiungi il prefisso del server se non è già presente
    if (chat.profileImage && !chat.profileImage.startsWith('http')) {
      setProfileImageUrl(`http://localhost:8080${chat.profileImage}`);
    } else {
      setProfileImageUrl(chat.profileImage);
    }
  }, [chat.profileImage]);

  return (
    <div className={`chat-item ${isOpen ? 'open' : ''}`}>
      <div className="chat-header" onClick={() => setIsOpen(!isOpen)}>
        {profileImageUrl && (
          <img 
            src={profileImageUrl} 
            alt={`Immagine profilo di ${chat.name}`} 
            onError={(e) => {
              console.error('Errore caricamento immagine:', profileImageUrl);
              e.target.style.display = 'none';
            }}
            className="chat-profile-image"
            style={{
              width: '50px', 
              height: '50px', 
              borderRadius: '50%', 
              objectFit: 'cover',
              marginRight: '10px'
            }}
          />
        )}
        <div className="chat-info">
          <h3>{chat.name}</h3>
          <span>{chat.lastMessage.senderName}: {chat.lastMessage.content}</span>
        </div>
      </div>
      {isOpen && <MessageList messages={chat.messages} />}
    </div>
  );
}

export default ChatItem;