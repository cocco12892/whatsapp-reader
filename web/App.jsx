import React, { useEffect, useState } from 'react';
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
                      <Message $isSent={message.sender === clientJID}>
                        {message.sender !== clientJID && (
                          <MessageSender>{message.senderName}</MessageSender>
                        )}
                        <MessageContent>
                          {message.isMedia && message.content.includes('📷 Immagine') && (
                            <div>
                              {message.mediaPath && (
                                <img 
                                  src={message.mediaPath} 
                                  alt="Immagine" 
                                  style={{ maxWidth: '100%', borderRadius: '5px', marginTop: '10px' }}
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
    </>
  );
}

export default App;
