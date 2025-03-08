import React, { useEffect, useState, useCallback } from 'react';
import NotePopup from './components/NotePopup';
import { Helmet } from 'react-helmet';
import styled from 'styled-components';

const API_BASE_URL = '/api';
const POLLING_INTERVAL = 5000; // 5 secondi

const Container = styled.div`
  max-width: 1600px;
  margin: 0 auto;
`;

const Title = styled.h1`
  text-align: center;
  color: #128c7e;
  margin-bottom: 20px;
`;

const LoadingMessage = styled.div`
  text-align: center;
  padding: 20px;
  color: #666;
  font-size: 1.2em;
`;

const ChatContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

const ChatColumn = styled.div`
  flex: 1;
  min-width: 300px;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  overflow: hidden;
`;

const ChatHeader = styled.div`
  background-color: #128c7e;
  color: white;
  padding: 10px;
  position: sticky;
  top: 0;
  
  h2 {
    margin: 0;
    font-size: 16px;
  }
`;

const ChatMessages = styled.div`
  padding: 10px;
  height: calc(100vh - 150px);
  overflow-y: auto;
`;

const Message = styled.div`
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 8px;
  max-width: 80%;
  position: relative;
  background-color: ${props => props.$isSent ? '#dcf8c6' : '#f0f0f0'};
  float: ${props => props.$isSent ? 'right' : 'left'};
  clear: both;
  cursor: context-menu;
  
  &:hover {
    background-color: ${props => props.$isSent ? '#c5e8b7' : '#e0e0e0'};
  }
`;

const NoteIndicator = styled.div`
  position: absolute;
  top: -5px;
  right: -5px;
  background-color: #ffeb3b;
  color: #000;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  cursor: pointer;
`;


const MessageSender = styled.div`
  font-weight: bold;
  font-size: 12px;
  margin-bottom: 5px;
`;

const MessageContent = styled.div`
  word-break: break-word;
`;

const MessageTime = styled.div`
  font-size: 10px;
  color: #999;
  text-align: right;
  margin-top: 5px;
`;

const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.9);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
`;

const ModalContent = styled.div`
  max-width: 90%;
  max-height: 90%;
  img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 5px;
  }
`;

const CloseButton = styled.button`
  position: absolute;
  top: 20px;
  right: 20px;
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
`;

const MessageWrapper = styled.div`
  &::after {
    content: "";
    clear: both;
    display: table;
  }
`;

function App() {
  const [chats, setChats] = useState([]);
  const [chatOrder, setChatOrder] = useState([]);
  const [clientJID, setClientJID] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isUserScrolling, setIsUserScrolling] = useState(false);
  const [modalImage, setModalImage] = useState(null);
  const [notePopup, setNotePopup] = useState({
    visible: false,
    messageId: null,
    position: { x: 0, y: 0 },
    note: ''
  });

  const fetchChats = async () => {
    try {
      console.log("Fetching chats...");
      const response = await fetch(`${API_BASE_URL}/chats`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const chatsData = await response.json();
      console.log("Received chats data:", chatsData);
      
      const preparedChats = await Promise.all(chatsData.map(async (chat) => {
        const messagesResponse = await fetch(`${API_BASE_URL}/chats/${encodeURIComponent(chat.id)}/messages`);
        if (!messagesResponse.ok) {
          throw new Error(`HTTP error! status: ${messagesResponse.status}`);
        }
        const messages = await messagesResponse.json();
        
        // Non impostiamo clientJID automaticamente
        // Tutti i messaggi sono considerati ricevuti
        
        return {
          ...chat,
          messages: messages
        };
      }));
      
      // Manteniamo l'ordine esistente delle chat
      const orderedChats = chatOrder.length > 0 
        ? chatOrder.map(id => preparedChats.find(c => c.id === id)).filter(c => c)
        : preparedChats;
      
      // Aggiorniamo l'ordine se ci sono nuove chat
      if (chatOrder.length !== orderedChats.length) {
        setChatOrder(orderedChats.map(c => c.id));
      }
      
      setChats(orderedChats);
    } catch (error) {
      console.error('Errore nel caricamento delle chat:', error);
      setError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();

    const intervalId = setInterval(() => {
      if (!isUserScrolling) {
        fetchChats();
      }
    }, POLLING_INTERVAL);

    return () => clearInterval(intervalId);
  }, [clientJID, isUserScrolling]);

  const handleScroll = (e) => {
    const element = e.target;
    const isAtBottom = Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) < 50;
    setIsUserScrolling(!isAtBottom);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleImageClick = useCallback((imageSrc) => {
    setModalImage(imageSrc);
  }, []);

  const closeModal = useCallback(() => {
    setModalImage(null);
  }, []);

  const saveNote = useCallback((messageId, note) => {
    const notes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    notes[messageId] = note;
    localStorage.setItem('messageNotes', JSON.stringify(notes));
  }, []);

  const getNote = useCallback((messageId) => {
    const notes = JSON.parse(localStorage.getItem('messageNotes') || '{}');
    return notes[messageId] || '';
  }, []);

  const handleMessageRightClick = useCallback((e, messageId) => {
    e.preventDefault();
    setNotePopup({
      visible: true,
      messageId,
      position: { x: e.clientX, y: e.clientY },
      note: getNote(messageId)
    });
  }, [getNote]);

  const handleNoteChange = useCallback((e) => {
    setNotePopup(prev => ({
      ...prev,
      note: e.target.value
    }));
  }, []);

  const handleSaveNote = useCallback(() => {
    saveNote(notePopup.messageId, notePopup.note);
    setNotePopup(prev => ({ ...prev, visible: false }));
  }, [notePopup, saveNote]);

  if (isLoading) {
    return (
      <Container>
        <Title>WhatsApp Web Viewer</Title>
        <LoadingMessage>Caricamento chat in corso...</LoadingMessage>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <Title>WhatsApp Web Viewer</Title>
        <LoadingMessage>Errore: {error}</LoadingMessage>
      </Container>
    );
  }

  return (
    <>
      <Helmet>
        <title>WhatsApp Web Viewer</title>
      </Helmet>
      <Container>
        <Title>WhatsApp Web Viewer</Title>
        {chats.length > 0 ? (
          <ChatContainer>
            {chats.map((chat) => (
              <ChatColumn key={chat.id}>
                <ChatHeader>
                  <h2>{chat.name || 'Chat'}</h2>
                </ChatHeader>
                <ChatMessages onScroll={handleScroll}>
                  {chat.messages.map((message) => (
                    <MessageWrapper key={message.id}>
                      <Message 
                        $isSent={false}
                        onContextMenu={(e) => handleMessageRightClick(e, message.id)}
                      >
                        {getNote(message.id) && (
                          <NoteIndicator onClick={(e) => handleMessageRightClick(e, message.id)}>
                            !
                          </NoteIndicator>
                        )}
                        <MessageSender>{message.senderName}</MessageSender>
                        <MessageContent>
                          {message.isMedia && message.content.includes('📷 Immagine') && (
                            <div>
                              {message.mediaPath && (
                                <img 
                                  src={message.mediaPath} 
                                  alt="Immagine" 
                                  style={{ 
                                    maxWidth: '100%', 
                                    borderRadius: '5px', 
                                    marginTop: '10px',
                                    cursor: 'pointer'
                                  }}
                                  onClick={() => handleImageClick(message.mediaPath)}
                                  onError={(e) => e.target.style.display = 'none'}
                                />
                              )}
                            </div>
                          )}
                          <span>{message.content}</span>
                        </MessageContent>
                        <MessageTime>
                          {formatTime(message.timestamp)}
                        </MessageTime>
                      </Message>
                    </MessageWrapper>
                  ))}
                </ChatMessages>
              </ChatColumn>
            ))}
          </ChatContainer>
        ) : (
          <LoadingMessage>Nessuna chat trovata</LoadingMessage>
        )}
      </Container>
      
      {modalImage && (
        <ModalOverlay onClick={closeModal}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <img src={modalImage} alt="Immagine ingrandita" />
            <CloseButton onClick={closeModal}>&times;</CloseButton>
          </ModalContent>
        </ModalOverlay>
      )}

      <NotePopup
        open={notePopup.visible}
        onClose={() => setNotePopup(prev => ({ ...prev, visible: false }))}
        note={notePopup.note}
        onChange={handleNoteChange}
        onSave={handleSaveNote}
        position={notePopup.position}
      />
    </>
  );
}

export default App;
