import React, { useEffect, useState, useCallback } from 'react';
import NotePopup from './components/NotePopup';
import { Helmet } from 'react-helmet';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { theme } from './styles/theme';
import {
  Container,
  Title,
  LoadingMessage,
  ChatContainer,
  ChatColumn,
  ChatHeader,
  ChatMessages,
  Message,
  NoteIndicator,
  MessageSender,
  MessageContent,
  MessageTime,
  ModalOverlay,
  ModalContent,
  CloseButton,
  MessageWrapper
} from './styles/components';

const API_BASE_URL = '/api';
const POLLING_INTERVAL = 5000; // 5 secondi

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
        
        return {
          ...chat,
          messages: messages
        };
      }));
      
      const orderedChats = chatOrder.length > 0 
        ? chatOrder.map(id => preparedChats.find(c => c.id === id)).filter(c => c)
        : preparedChats;
      
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

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Helmet>
        <title>WhatsApp Web Viewer</title>
      </Helmet>
      <Container>
        {isLoading ? (
          <>
            <Title>WhatsApp Web Viewer</Title>
            <LoadingMessage>Caricamento chat in corso...</LoadingMessage>
          </>
        ) : error ? (
          <>
            <Title>WhatsApp Web Viewer</Title>
            <LoadingMessage>Errore: {error}</LoadingMessage>
          </>
        ) : (
          <>
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
          </>
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
    </ThemeProvider>
  );
}

export default App;