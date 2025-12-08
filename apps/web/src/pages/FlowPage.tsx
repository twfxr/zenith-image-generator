import { useCallback, useState, useRef, useEffect } from "react";
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Settings, X, Plus, Trash2, MessageSquare, Download } from "lucide-react";
import { Link } from "react-router-dom";
import { encryptAndStore, decryptFromStore } from "@/lib/crypto";
import {
  loadFlowSessions,
  saveFlowSession,
  createFlowSession,
  deleteFlowSession,
  type FlowSession,
  type GeneratedImage,
} from "@/lib/flow-storage";
import UserPromptNode, { type UserPromptNodeData } from "@/components/flow/UserPromptNode";
import AIResultNode, { type AIResultNodeData } from "@/components/flow/AIResultNode";
import { getLayoutedElements } from "@/components/flow/layout";
import FloatingInput from "@/components/flow/FloatingInput";

const nodeTypes = {
  userPrompt: UserPromptNode,
  aiResult: AIResultNode,
};

function FlowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [sessions, setSessions] = useState<FlowSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sidebarHover, setSidebarHover] = useState(false);
  const nodeIdRef = useRef(0);
  const imagesRef = useRef<GeneratedImage[]>([]);
  const { fitView } = useReactFlow();

  useEffect(() => {
    loadFlowSessions().then(setSessions);
  }, []);

  useEffect(() => {
    decryptFromStore().then((key) => setApiKey(key || ""));
  }, []);

  const saveApiKey = async (key: string) => {
    await encryptAndStore(key);
    setApiKey(key);
  };

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const handleImageGenerated = useCallback(
    (_nodeId: string, image: GeneratedImage) => {
      imagesRef.current = [...imagesRef.current, image];
      if (currentSessionId) {
        const currentSession = sessions.find((s) => s.id === currentSessionId);
        if (currentSession) {
          const updatedSession = {
            ...currentSession,
            images: imagesRef.current,
            updatedAt: Date.now(),
          };
          const updated = sessions.map((s) =>
            s.id === currentSessionId ? updatedSession : s
          );
          setSessions(updated);
          saveFlowSession(updatedSession);
        }
      }
    },
    [currentSessionId, sessions]
  );


  const handleDownloadAll = async () => {
    const session = sessions.find((s) => s.id === currentSessionId);
    if (!session || session.images.length === 0) return;
    for (let i = 0; i < session.images.length; i++) {
      const img = session.images[i];
      const a = document.createElement("a");
      a.href = img.url;
      a.download = `zenith-${session.id}-${i + 1}.png`;
      a.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const addNode = useCallback(
    async (config: { prompt: string; width: number; height: number; batchCount: number; seed: number }) => {
      let sessionId = currentSessionId;
      if (!sessionId) {
        const newSession = await createFlowSession();
        setSessions((prev) => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        sessionId = newSession.id;
        imagesRef.current = [];
      }
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];
      const lastNodeId = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
      const timestamp = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
      const aspectRatio = `${config.width}:${config.height}`;

      const promptNodeId = `prompt-${++nodeIdRef.current}`;
      newNodes.push({
        id: promptNodeId,
        type: "userPrompt",
        position: { x: 0, y: 0 },
        data: {
          prompt: config.prompt,
          timestamp,
          width: config.width,
          height: config.height,
          batchCount: config.batchCount,
        } as UserPromptNodeData,
      });

      if (lastNodeId) {
        newEdges.push({
          id: `e-${lastNodeId}-${promptNodeId}`,
          source: lastNodeId,
          target: promptNodeId,
        });
      }

      for (let i = 0; i < config.batchCount; i++) {
        const resultNodeId = `result-${++nodeIdRef.current}`;
        newNodes.push({
          id: resultNodeId,
          type: "aiResult",
          position: { x: 0, y: 0 },
          data: {
            prompt: config.prompt,
            width: config.width,
            height: config.height,
            aspectRatio,
            model: "Gitee AI",
            seed: config.seed + i,
            onImageGenerated: handleImageGenerated,
          } as AIResultNodeData,
        });

        newEdges.push({
          id: `e-${promptNodeId}-${resultNodeId}`,
          source: promptNodeId,
          target: resultNodeId,
        });
      }

      const nextNodes = [...nodes, ...newNodes];
      const nextEdges = [...edges, ...newEdges];
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nextNodes, nextEdges);

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setTimeout(() => fitView({ padding: 0.2, duration: 500 }), 100);
    },
    [nodes, edges, setNodes, setEdges, fitView, handleImageGenerated, currentSessionId]
  );

  const handleNewSession = async () => {
    const newSession = await createFlowSession();
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setNodes([]);
    setEdges([]);
    imagesRef.current = [];
    nodeIdRef.current = 0;
  };

  const handleSelectSession = (session: FlowSession) => {
    setCurrentSessionId(session.id);
    imagesRef.current = session.images;
    setNodes([]);
    setEdges([]);
    nodeIdRef.current = 0;
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteFlowSession(sessionId);
    const updated = sessions.filter((s) => s.id !== sessionId);
    setSessions(updated);
    if (currentSessionId === sessionId) {
      setCurrentSessionId(updated.length > 0 ? updated[0].id : null);
      imagesRef.current = updated.length > 0 ? updated[0].images : [];
      setNodes([]);
      setEdges([]);
      nodeIdRef.current = 0;
    }
  };

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  return (
    <div className="h-screen w-screen bg-zinc-950 flex">
      {/* Sidebar - hover to show */}
      <div className="fixed left-0 top-0 bottom-0 z-40">
        <div
          className={`h-full w-4 bg-zinc-900 border-r border-zinc-800 transition-all duration-300 ${sidebarHover ? "w-64" : ""}`}
          onMouseEnter={() => setSidebarHover(true)}
          onMouseLeave={() => setSidebarHover(false)}
        >
          {sidebarHover && (
            <div className="h-full w-full flex flex-col">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <span className="text-zinc-300 font-medium">Sessions</span>
                <button onClick={handleNewSession} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200">
                  <Plus size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    onClick={() => handleSelectSession(session)}
                    className={`group flex items-center gap-2 p-2 rounded-lg cursor-pointer transition-colors ${
                      session.id === currentSessionId ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:bg-zinc-800/50"
                    }`}
                  >
                    <MessageSquare size={14} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{session.name}</div>
                      <div className="text-xs text-zinc-500">{session.images.length} images</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-red-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
              {currentSession && currentSession.images.length > 0 && (
                <div className="p-2 border-t border-zinc-800">
                  <div className="text-xs text-zinc-500 mb-2">Recent</div>
                  <div className="grid grid-cols-3 gap-1">
                    {currentSession.images.slice(-6).map((img) => (
                      <img key={img.id} src={img.url} alt="" className="w-full aspect-square object-cover rounded" />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* Main Canvas */}
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
          className="bg-zinc-950"
        >
          <Background variant={BackgroundVariant.Dots} color="#3f3f46" gap={20} />
          <Controls className="bg-zinc-900! border-zinc-800! rounded-lg! [&>button]:bg-zinc-800! [&>button]:border-zinc-700! [&>button:hover]:bg-zinc-700! [&>button>svg]:fill-zinc-300!" />
        </ReactFlow>

        {/* Header */}
        <div className="absolute top-0 left-0 right-0 h-14 flex items-center justify-between px-6 bg-linear-to-b from-zinc-950 to-transparent">
          <Link
            to="/"
            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="text-sm">Back</span>
          </Link>

          <h1 className="text-2xl font-bold text-orange-500 drop-shadow-[0_0_10px_rgba(249,115,22,0.5)] tracking-wider">
            ZENITH
          </h1>

          <div className="flex items-center gap-2">
            {currentSession && currentSession.images.length > 0 && (
              <button
                onClick={handleDownloadAll}
                className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="text-sm">Download All</span>
              </button>
            )}
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
            >
              <Settings className="w-4 h-4" />
              <span className="text-sm">API Key</span>
              {apiKey && <span className="w-2 h-2 bg-green-500 rounded-full" />}
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md mx-4">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-zinc-100 font-medium">API Configuration</h2>
                <button onClick={() => setShowSettings(false)} className="text-zinc-500 hover:text-zinc-300">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <label className="block text-zinc-400 text-sm mb-2">Gitee AI API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onBlur={(e) => saveApiKey(e.target.value)}
                placeholder="Enter your Gitee AI API Key..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
              />
              <p className="text-zinc-500 text-xs mt-2">Key is encrypted and stored locally (shared with home page).</p>
            </div>
          </div>
        )}

        <FloatingInput onSubmit={addNode} />
      </div>
    </div>
  );
}

export default function FlowPage() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  );
}
