import React, { useEffect, useState } from 'react';
import './style.css';

const API_BASE_URL = 'http://localhost:8080/api';

function App() {
  const [chats, setChats] = useState([]);
  const [clientJID, setClientJID] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const initializeChats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/chats`);
        const chatsData = await response.json();
        
        const preparedChats = await Promise.all(chatsData.map(async (chat) => {
          const messagesResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chat.id)}/messages`);
          const messages = await messagesResponse.json();
          
          if (!clientJID && messages.length > 0) {
            setClientJID(messages[0].chat.includes('@g.us') 
              ? messages[0].sender 
              : messages[0].chat);
          }
          
          return {
            ...chat,
            messages: messages
          };
        }));
        
        setChats(preparedChats);
      } catch (error) {
        console.error('Errore nel caricamento iniziale delle chat:', error);
        setError(error.message);
      } finally {
        setIsLoading(false);
      }
    };

    initializeChats();
  }, [clientJID]);

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (isLoading) {
    return (
      <div className="container">
        <h1>WhatsApp Web Viewer</h1>
        <div className="loading">Caricamento chat in corso...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <h1>WhatsApp Web Viewer</h1>
        <div className="loading" style={{color: 'red'}}>
          Errore: {error}
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <h1>WhatsApp Web Viewer</h1>
      
      {chats.length > 0 ? (
        <div className="chat-container" id="chat-container">
        {chats.map((chat) => (
          <div className="chat-column" key={chat.id} id={`chat-${chat.id.replace(/[@:.]/g, '_')}`}>
            <div className="chat-header">
              <h2>{chat.name || 'Chat'}</h2>
            </div>
            <div className="chat-messages">
              {chat.messages.map((message) => (
                <div className="clearfix" key={message.id}>
                  <div 
                    className={`message ${message.sender === clientJID ? 'message-sent' : 'message-received'}`}
                    data-timestamp={message.timestamp}>
                    
                    {message.sender !== clientJID && (
                      <div className="message-sender">{message.senderName || 'Mittente'}</div>
                    )}
                    
                    <div className="message-content">
                      {message.isMedia && message.content.includes('📷 Immagine') && (
                        <div>
                          <div className="media-preview">
                            Anteprima immagine
                          </div>
                          <img 
                            src={message.mediaPath} 
                            alt="Immagine" 
                            style={{ maxWidth: '100%', borderRadius: '5px', marginTop: '10px' }}
                          />
                        </div>
                      )}
                      <span>{message.content}</span>
                    </div>
                    
                    <div className="message-time">
                      {formatTime(message.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      ) : (
        <div className="loading">Nessuna chat trovata</div>
      )}
    </div>
  );
}

export default App;
