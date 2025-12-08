import { openDB, type IDBPDatabase } from "idb";

export interface GeneratedImage {
  id: string;
  url: string;
  prompt: string;
  aspectRatio: string;
  timestamp: number;
  model: string;
  seed?: number;
  duration?: number;
  isBlurred?: boolean;
  isUpscaled?: boolean;
}

export interface FlowSession {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  images: GeneratedImage[];
}

const DB_NAME = "zenith-flow-db";
const DB_VERSION = 1;
const SESSIONS_STORE = "sessions";

let dbInstance: IDBPDatabase | null = null;

async function getDB(): Promise<IDBPDatabase> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = db.createObjectStore(SESSIONS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    },
  });

  return dbInstance;
}

export async function loadFlowSessions(): Promise<FlowSession[]> {
  try {
    const db = await getDB();
    const sessions = await db.getAll(SESSIONS_STORE);
    // Sort by updatedAt descending (most recent first)
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function saveFlowSession(session: FlowSession): Promise<void> {
  const db = await getDB();
  await db.put(SESSIONS_STORE, session);
}

export async function createFlowSession(): Promise<FlowSession> {
  const session: FlowSession = {
    id: `flow-${Date.now()}`,
    name: `Flow ${new Date().toLocaleString("zh-CN")}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    images: [],
  };
  await saveFlowSession(session);
  return session;
}

export async function updateFlowSession(
  sessionId: string,
  images: GeneratedImage[]
): Promise<void> {
  const db = await getDB();
  const session = await db.get(SESSIONS_STORE, sessionId);
  if (session) {
    session.images = images;
    session.updatedAt = Date.now();
    await db.put(SESSIONS_STORE, session);
  }
}

export async function deleteFlowSession(sessionId: string): Promise<void> {
  const db = await getDB();
  await db.delete(SESSIONS_STORE, sessionId);
}

// Flow input settings storage (keep in localStorage - small data)
export interface FlowInputSettings {
  aspectRatioIndex: number;
  resolutionIndex: number; // 0=1K, 1=2K - independent of aspect ratio
  prompt: string;
}

const FLOW_INPUT_SETTINGS_KEY = "zenith-flow-input-settings";

export function loadFlowInputSettings(): FlowInputSettings {
  try {
    const data = localStorage.getItem(FLOW_INPUT_SETTINGS_KEY);
    if (data) {
      return JSON.parse(data);
    }
  } catch {
    // ignore
  }
  return {
    aspectRatioIndex: 0,
    resolutionIndex: 0,
    prompt: "",
  };
}

export function saveFlowInputSettings(settings: FlowInputSettings) {
  localStorage.setItem(FLOW_INPUT_SETTINGS_KEY, JSON.stringify(settings));
}
