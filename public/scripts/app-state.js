import { api } from './api.js';

const CACHE_KEY = 'appStateCache';
const CACHE_TTL = 30_000; // 30 seconds

export async function loadAppState() {
  const cached = getCachedState();
  if (cached) return withActiveBoard(cached);

  const data = await api('/api/bootstrap');
  setCachedState(data);
  return withActiveBoard(data);
}

export async function refreshAppState() {
  const data = await api('/api/bootstrap');
  setCachedState(data);
  return withActiveBoard(data);
}

function withActiveBoard(data) {
  const activeBoardId = localStorage.getItem('activeBoardId') || data.boards[0]?.id || '';
  return {
    ...data,
    activeBoardId: data.boards.some((board) => board.id === activeBoardId) ? activeBoardId : data.boards[0]?.id
  };
}

function getCachedState() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return data;
  } catch {
    return null;
  }
}

function setCachedState(data) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() }));
  } catch { /* storage full — ignore */ }
}

export function invalidateStateCache() {
  sessionStorage.removeItem(CACHE_KEY);
}

export function setActiveBoard(state, boardId) {
  state.activeBoardId = boardId;
  localStorage.setItem('activeBoardId', boardId);
}

export function getActiveBoard(state) {
  return state.boards.find((board) => board.id === state.activeBoardId);
}
