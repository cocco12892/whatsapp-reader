import styled from 'styled-components';

export const Container = styled.div`
  max-width: 1600px;
  margin: 0 auto;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
`;

export const Title = styled.h1`
  text-align: center;
  color: #128c7e;
  margin-bottom: 20px;
  font-weight: 600;
  letter-spacing: -0.025em;
`;

export const LoadingMessage = styled.div`
  text-align: center;
  padding: 20px;
  color: #666;
  font-size: 1.2em;
`;

export const ChatContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
`;

export const ChatColumn = styled.div`
  flex: 1;
  min-width: 300px;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
  overflow: hidden;
`;

export const ChatHeader = styled.div`
  background-color: #128c7e;
  color: white;
  padding: 10px;
  position: sticky;
  top: 0;
  
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 500;
  }
`;

export const ChatMessages = styled.div`
  padding: 10px;
  height: calc(100vh - 150px);
  overflow-y: auto;
`;

export const Message = styled.div`
  margin-bottom: 10px;
  padding: 10px;
  border-radius: 8px;
  max-width: 80%;
  position: relative;
  background-color: ${props => props.$isSent ? '#dcf8c6' : '#f0f0f0'};
  float: ${props => props.$isSent ? 'right' : 'left'};
  clear: both;
  cursor: context-menu;
  overflow: visible;
  
  &:hover {
    background-color: ${props => props.$isSent ? '#c5e8b7' : '#e0e0e0'};
    
    .quick-actions {
      opacity: 1;
      pointer-events: auto;
    }
  }
`;

export const NoteIndicator = styled.div`
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

export const MessageSender = styled.div`
  font-weight: 500;
  font-size: 12px;
  margin-bottom: 5px;
`;

export const MessageContent = styled.div`
  word-break: break-word;
`;

export const MessageTime = styled.div`
  font-size: 10px;
  color: #999;
  text-align: right;
  margin-top: 5px;
`;

export const ModalOverlay = styled.div`
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

export const ModalContent = styled.div`
  max-width: 90%;
  max-height: 90%;
  img {
    max-width: 100%;
    max-height: 100%;
    border-radius: 5px;
  }
`;

export const CloseButton = styled.button`
  position: absolute;
  top: 20px;
  right: 20px;
  background: none;
  border: none;
  color: white;
  font-size: 24px;
  cursor: pointer;
`;

export const MessageWrapper = styled.div`
  &::after {
    content: "";
    clear: both;
    display: table;
  }
`;
