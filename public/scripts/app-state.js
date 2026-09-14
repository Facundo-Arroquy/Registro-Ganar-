import { api } from './api.js';

export async function loadAppState() {
  const data = await api('/api/bootstrap');
  if (isMockModeEnabled()) {
    const mocks = await api('/api/mocks');
    data.clients = mocks.clients;
    data.boards = mocks.boards;
  }
  const activeBoardId = localStorage.getItem('activeBoardId') || data.boards[0]?.id || '';
  return {
    ...data,
    activeBoardId: data.boards.some((board) => board.id === activeBoardId) ? activeBoardId : data.boards[0]?.id
  };
}

export function setActiveBoard(state, boardId) {
  state.activeBoardId = boardId;
  localStorage.setItem('activeBoardId', boardId);
}

export function getActiveBoard(state) {
  return state.boards.find((board) => board.id === state.activeBoardId);
}

export function isMockModeEnabled() {
  return localStorage.getItem('showMocks') === 'true';
}

export function setMockMode(enabled) {
  localStorage.setItem('showMocks', String(enabled));
}
