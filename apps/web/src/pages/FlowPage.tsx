import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import '@xyflow/react/dist/style.css'
import { ApiConfigAccordion } from '@/components/feature/ApiConfigAccordion'
import AIResultNode, { type AIResultNodeData } from '@/components/flow/AIResultNode'
import FloatingInput from '@/components/flow/FloatingInput'
import UserPromptNode, { type UserPromptNodeData } from '@/components/flow/UserPromptNode'
import { getLayoutedElements } from '@/components/flow/layout'
import {
  type ProviderType,
  getDefaultModel,
  getModelsByProvider,
  loadSettings,
  saveSettings,
} from '@/lib/constants'
import { encryptAndStoreToken, loadAllTokens } from '@/lib/crypto'
import {
  type GeneratedImage,
  clearFlowState,
  loadFlowState,
  saveFlowState,
} from '@/lib/flow-storage'
import { ArrowLeft, Download, Settings, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

const nodeTypes = {
  userPrompt: UserPromptNode,
  aiResult: AIResultNode,
}

function FlowCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [tokens, setTokens] = useState<Record<ProviderType, string>>({
    gitee: '',
    huggingface: '',
    modelscope: '',
  })
  const [provider, setProvider] = useState<ProviderType>(
    () => loadSettings().provider ?? 'huggingface'
  )
  const [model, setModel] = useState(() => loadSettings().model ?? 'z-image-turbo')
  const [showSettings, setShowSettings] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)
  const nodeIdRef = useRef(0)
  const imagesRef = useRef<GeneratedImage[]>([])
  const { fitView, setViewport } = useReactFlow()

  // Create image generated handler
  const handleImageGenerated = useCallback(
    (nodeId: string, image: GeneratedImage) => {
      imagesRef.current = [...imagesRef.current, image]
      // Update node data with the generated image URL and duration
      setNodes((nds) =>
        nds.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  imageUrl: image.url,
                  duration: image.duration, // Now a string like "8.1s"
                },
              }
            : node
        )
      )
    },
    [setNodes]
  )

  // Auto-save when nodes/edges/images change
  useEffect(() => {
    if (!isLoaded) return
    const timeoutId = setTimeout(() => {
      saveFlowState({
        nodes,
        edges,
        images: imagesRef.current,
        nodeIdCounter: nodeIdRef.current,
      })
    }, 500) // Debounce saves
    return () => clearTimeout(timeoutId)
  }, [nodes, edges, isLoaded])

  // Load saved state on mount
  useEffect(() => {
    loadFlowState().then((state) => {
      if (state?.nodes && state.nodes.length > 0) {
        // Restore images
        imagesRef.current = state.images || []
        nodeIdRef.current = state.nodeIdCounter || 0

        // Create an image lookup map
        const imageMap = new Map(imagesRef.current.map((img) => [img.id, img]))

        // Restore nodes with callbacks and image URLs
        const restoredNodes = state.nodes.map((node) => {
          if (node.type === 'aiResult') {
            const image = imageMap.get(node.id)
            return {
              ...node,
              data: {
                ...node.data,
                imageUrl: image?.url || (node.data as AIResultNodeData).imageUrl,
                duration: image?.duration || (node.data as AIResultNodeData).duration,
                onImageGenerated: handleImageGenerated,
              },
            }
          }
          return node
        })

        setNodes(restoredNodes)
        setEdges(state.edges || [])

        // Restore viewport if available
        if (state.viewport) {
          setTimeout(() => setViewport(state.viewport!), 100)
        } else {
          setTimeout(() => fitView({ padding: 0.2, duration: 500 }), 100)
        }

        // console.log(`Restored ${restoredNodes.length} nodes, ${state.images?.length || 0} images`);
      }
      setIsLoaded(true)
    })
  }, [setNodes, setEdges, setViewport, fitView, handleImageGenerated])

  useEffect(() => {
    loadAllTokens().then(setTokens)
  }, [])

  // Update model when provider changes
  useEffect(() => {
    const models = getModelsByProvider(provider)
    if (!models.find((m) => m.id === model)) {
      setModel(getDefaultModel(provider))
    }
  }, [provider, model])

  const saveToken = async (p: ProviderType, token: string) => {
    setTokens((prev) => ({ ...prev, [p]: token }))
    await encryptAndStoreToken(p, token)
  }

  const updateSettings = (patch: Partial<Record<string, unknown>>) => {
    const prev = loadSettings()
    saveSettings({ ...prev, ...patch })
  }

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  )

  const handleDownloadAll = async () => {
    if (imagesRef.current.length === 0) return
    const { downloadImage } = await import('@/lib/utils')
    for (let i = 0; i < imagesRef.current.length; i++) {
      const img = imagesRef.current[i]
      await downloadImage(img.url, `zenith-flow-${i + 1}.png`, img.provider)
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  const handleClearAll = async () => {
    if (confirm('Clear all nodes and saved images?')) {
      setNodes([])
      setEdges([])
      imagesRef.current = []
      nodeIdRef.current = 0
      await clearFlowState()
    }
  }

  const addNode = useCallback(
    (config: {
      prompt: string
      width: number
      height: number
      batchCount: number
      seed: number
    }) => {
      const newNodes: Node[] = []
      const newEdges: Edge[] = []
      const lastNodeId = nodes.length > 0 ? nodes[nodes.length - 1].id : null
      const timestamp = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      })
      const aspectRatio = `${config.width}:${config.height}`

      const promptNodeId = `prompt-${++nodeIdRef.current}`
      newNodes.push({
        id: promptNodeId,
        type: 'userPrompt',
        position: { x: 0, y: 0 },
        data: {
          prompt: config.prompt,
          timestamp,
          width: config.width,
          height: config.height,
          batchCount: config.batchCount,
        } as UserPromptNodeData,
      })

      if (lastNodeId) {
        newEdges.push({
          id: `e-${lastNodeId}-${promptNodeId}`,
          source: lastNodeId,
          target: promptNodeId,
        })
      }

      for (let i = 0; i < config.batchCount; i++) {
        const resultNodeId = `result-${++nodeIdRef.current}`
        newNodes.push({
          id: resultNodeId,
          type: 'aiResult',
          position: { x: 0, y: 0 },
          data: {
            prompt: config.prompt,
            width: config.width,
            height: config.height,
            aspectRatio,
            model,
            seed: config.seed + i,
            onImageGenerated: handleImageGenerated,
          } as AIResultNodeData,
        })

        newEdges.push({
          id: `e-${promptNodeId}-${resultNodeId}`,
          source: promptNodeId,
          target: resultNodeId,
        })
      }

      const nextNodes = [...nodes, ...newNodes]
      const nextEdges = [...edges, ...newEdges]
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
        nextNodes,
        nextEdges
      )

      setNodes(layoutedNodes)
      setEdges(layoutedEdges)
      setTimeout(() => fitView({ padding: 0.2, duration: 500 }), 100)
    },
    [nodes, edges, setNodes, setEdges, fitView, handleImageGenerated, model]
  )

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
                type="button"
                onClick={handleDownloadAll}
                className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
              >
                <Download className="w-4 h-4" />
                <span className="text-sm">Download All</span>
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-red-400 hover:border-red-600 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span className="text-sm">Clear</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-2 px-3 py-1.5 border border-zinc-700 rounded-lg text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors"
          >
            <Settings className="w-4 h-4" />
            <span className="text-sm">API</span>
            {tokens[provider] && <span className="w-2 h-2 bg-green-500 rounded-full" />}
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-zinc-100 font-medium">API Configuration</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-zinc-500 hover:text-zinc-300"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <ApiConfigAccordion
              provider={provider}
              model={model}
              currentToken={tokens[provider]}
              availableModels={getModelsByProvider(provider)}
              setProvider={(p) => {
                setProvider(p)
                updateSettings({ provider: p })
              }}
              setModel={(m) => {
                setModel(m)
                updateSettings({ model: m })
              }}
              saveToken={saveToken}
            />
          </div>
        </div>
      )}

      <FloatingInput onSubmit={addNode} providerLabel={`${provider} / ${model}`} />
    </div>
  )
}

export default function FlowPage() {
  return (
    <ReactFlowProvider>
      <FlowCanvas />
    </ReactFlowProvider>
  )
}
