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
import { ArrowLeft, Settings, X, Download, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { encryptAndStore, decryptFromStore } from "@/lib/crypto";
import {
  loadFlowState,
  saveFlowState,
  clearFlowState,
  type GeneratedImage,
} from "@/lib/flow-storage";
import UserPromptNode, {
  type UserPromptNodeData,
} from "@/components/flow/UserPromptNode";
import AIResultNode, {
  type AIResultNodeData,
} from "@/components/flow/AIResultNode";
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
  const [isLoaded, setIsLoaded] = useState(false);
  const nodeIdRef = useRef(0);
  const imagesRef = useRef<GeneratedImage[]>([]);
  const { fitView, setViewport } = useReactFlow();

  // Create image generated handler
  const handleImageGenerated = useCallback(
    (nodeId: string, image: GeneratedImage) => {
      imagesRef.current = [...imagesRef.current, image];
      // Update node data with the generated image URL
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageUrl: image.url,
                  duration: image.duration,
                },
              }
            : node
        )
      );
    },
    [setNodes]
  );

  // Auto-save when nodes/edges/images change
  useEffect(() => {
    if (!isLoaded) return;
    const timeoutId = setTimeout(() => {
      saveFlowState({
        nodes,
        edges,
        images: imagesRef.current,
        nodeIdCounter: nodeIdRef.current,
      });
    }, 500); // Debounce saves
    return () => clearTimeout(timeoutId);
  }, [nodes, edges, isLoaded]);

  // Load saved state on mount
  useEffect(() => {
    loadFlowState().then((state) => {
      if (state && state.nodes && state.nodes.length > 0) {
        // Restore images
        imagesRef.current = state.images || [];
        nodeIdRef.current = state.nodeIdCounter || 0;

        // Create an image lookup map
        const imageMap = new Map(imagesRef.current.map((img) => [img.id, img]));

        // Restore nodes with callbacks and image URLs
        const restoredNodes = state.nodes.map((node) => {
          if (node.type === "aiResult") {
            const image = imageMap.get(node.id);
            return {
              ...node,
              data: {
                ...node.data,
                imageUrl:
                  image?.url || (node.data as AIResultNodeData).imageUrl,
                duration:
                  image?.duration || (node.data as AIResultNodeData).duration,
                onImageGenerated: handleImageGenerated,
              },
            };
          }
          return node;
        });

        setNodes(restoredNodes);
        setEdges(state.edges || []);

        // Restore viewport if available
        if (state.viewport) {
          setTimeout(() => setViewport(state.viewport!), 100);
        } else {
          setTimeout(() => fitView({ padding: 0.2, duration: 500 }), 100);
        }

        // console.log(`Restored ${restoredNodes.length} nodes, ${state.images?.length || 0} images`);
      }
      setIsLoaded(true);
    });
  }, [setNodes, setEdges, setViewport, fitView, handleImageGenerated]);

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

  const handleDownloadAll = async () => {
    if (imagesRef.current.length === 0) return;
    for (let i = 0; i < imagesRef.current.length; i++) {
      const img = imagesRef.current[i];
      const a = document.createElement("a");
      a.href = img.url;
      a.download = `zenith-flow-${i + 1}.png`;
      a.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  };

  const handleClearAll = async () => {
    if (confirm("Clear all nodes and saved images?")) {
      setNodes([]);
      setEdges([]);
      imagesRef.current = [];
      nodeIdRef.current = 0;
      await clearFlowState();
    }
  };

  const addNode = useCallback(
    (config: {
      prompt: string;
      width: number;
      height: number;
      batchCount: number;
      seed: number;
    }) => {
      const newNodes: Node[] = [];
      const newEdges: Edge[] = [];
      const lastNodeId = nodes.length > 0 ? nodes[nodes.length - 1].id : null;
      const timestamp = new Date().toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
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
      const { nodes: layoutedNodes, edges: layoutedEdges } =
        getLayoutedElements(nextNodes, nextEdges);

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setTimeout(() => fitView({ padding: 0.2, duration: 500 }), 100);
    },
    [nodes, edges, setNodes, setEdges, fitView, handleImageGenerated]
  );

  return (
    <div className="h-screen w-screen bg-zinc-950">
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
          {nodes.length > 0 && (
            <>
              <button
                onClick={handleDownloadAll}
                className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="text-sm">Download All</span>
              </button>
              <button
                onClick={handleClearAll}
                className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-red-400 hover:border-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span className="text-sm">Clear</span>
              </button>
            </>
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
              <button
                onClick={() => setShowSettings(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <label className="block text-zinc-400 text-sm mb-2">
              Gitee AI API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={(e) => saveApiKey(e.target.value)}
              placeholder="Enter your Gitee AI API Key..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700"
            />
            <p className="text-zinc-500 text-xs mt-2">
              Key is encrypted and stored locally (shared with home page).
            </p>
          </div>
        </div>
      )}

      <FloatingInput onSubmit={addNode} />
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
