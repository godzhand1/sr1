// Shared REST helpers for the streetfight lobby system — used by the
// LobbyBrowser (social sidebar) and the in-game pause menu.
// Every call auto-recovers from a stale rotated session token (401 →
// silent device-fingerprint re-register → retry once).
import axios from 'axios';
import { recoverCommunityAuth } from '../userIdentity';

const API = `${process.env.REACT_APP_BACKEND_URL}/api/streetfight`;
const SOCIAL = `${process.env.REACT_APP_BACKEND_URL}/api/social`;

export function authHeaders() {
  const t = localStorage.getItem('sr_community_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function withAuthRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.response?.status === 401) {
      const fresh = await recoverCommunityAuth(process.env.REACT_APP_BACKEND_URL);
      if (fresh) return await fn();
    }
    throw e;
  }
}

export const listLobbies = () =>
  withAuthRetry(() => axios.get(`${API}/lobbies`, { headers: authHeaders() })).then(r => r.data.lobbies || []);

export const createLobby = (name, privacy = 'open', mission = 'mission1', game = '2d') =>
  withAuthRetry(() => axios.post(`${API}/lobbies`, { name, mission, privacy, game }, { headers: authHeaders() })).then(r => r.data);

export const inviteToLobby = (lobbyId, userId) =>
  withAuthRetry(() => axios.post(`${API}/lobbies/${lobbyId}/invite`, { user_id: userId }, { headers: authHeaders() })).then(r => r.data);

export const respondToInvite = (lobbyId, accept) =>
  withAuthRetry(() => axios.post(`${API}/lobbies/${lobbyId}/invite-response`, { accept }, { headers: authHeaders() })).then(r => r.data);

export const listInvitees = () =>
  withAuthRetry(() => axios.get(`${API}/invitees`, { headers: authHeaders() })).then(r => r.data.invitees || []);

export const listFriends = () =>
  withAuthRetry(() => axios.get(`${SOCIAL}/friends`, { headers: authHeaders() })).then(r => (r.data.friends || []).map(f => f.other).filter(Boolean));

export const queueRanked = (lobbyId) =>
  withAuthRetry(() => axios.post(`${API}/lobbies/${lobbyId}/queue-ranked`, {}, { headers: authHeaders() })).then(r => r.data);

export const cancelRankedQueue = (lobbyId) =>
  withAuthRetry(() => axios.post(`${API}/lobbies/${lobbyId}/cancel-queue`, {}, { headers: authHeaders() })).then(r => r.data);

export const rankedStatus = () =>
  withAuthRetry(() => axios.get(`${API}/ranked/status`, { headers: authHeaders() })).then(r => r.data);
