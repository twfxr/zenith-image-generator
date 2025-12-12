/**
 * Image Generator Hook
 *
 * Core state management and API calls for image generation
 */

import { generateImage, upscaleImage } from '@/lib/api'
import {
  ASPECT_RATIOS,
  DEFAULT_NEGATIVE_PROMPT,
  DEFAULT_PROMPT,
  PROVIDER_CONFIGS,
  type ProviderType,
  getDefaultModel,
  getModelsByProvider,
  loadSettings,
  saveSettings,
} from '@/lib/constants'
import { encryptAndStoreToken, loadAllTokens } from '@/lib/crypto'
import type { ImageDetails } from '@z-image/shared'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const IMAGE_DETAILS_KEY = 'lastImageDetails'

export function useImageGenerator() {
  const [tokens, setTokens] = useState<Record<ProviderType, string>>({
    gitee: '',
    huggingface: '',
    modelscope: '',
  })
  const [provider, setProvider] = useState<ProviderType>(
    () => loadSettings().provider ?? 'huggingface'
  )
  const [model, setModel] = useState(() => loadSettings().model ?? 'z-image-turbo')
  const [prompt, setPrompt] = useState(() => loadSettings().prompt ?? DEFAULT_PROMPT)
  const [negativePrompt, setNegativePrompt] = useState(
    () => loadSettings().negativePrompt ?? DEFAULT_NEGATIVE_PROMPT
  )
  const [width, setWidth] = useState(() => loadSettings().width ?? 1024)
  const [height, setHeight] = useState(() => loadSettings().height ?? 1024)
  const [steps, setSteps] = useState(() => loadSettings().steps ?? 9)
  const [loading, setLoading] = useState(false)
  const [imageDetails, setImageDetails] = useState<ImageDetails | null>(() => {
    const stored = localStorage.getItem(IMAGE_DETAILS_KEY)
    return stored ? JSON.parse(stored) : null
  })
  const [status, setStatus] = useState('Ready.')
  const [elapsed, setElapsed] = useState(0)
  const [selectedRatio, setSelectedRatio] = useState(() => loadSettings().selectedRatio ?? '1:1')
  const [uhd, setUhd] = useState(() => loadSettings().uhd ?? false)
  const [upscale8k] = useState(() => loadSettings().upscale8k ?? false)
  const [showInfo, setShowInfo] = useState(false)
  const [isBlurred, setIsBlurred] = useState(() => localStorage.getItem('isBlurred') === 'true')
  const [isUpscaled, setIsUpscaled] = useState(false)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const initialized = useRef(false)

  // Get current token for selected provider
  const currentToken = tokens[provider]

  // Get models for current provider
  const availableModels = getModelsByProvider(provider)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      loadAllTokens().then(setTokens)
    }
  }, [])

  // Update model when provider changes
  useEffect(() => {
    const models = getModelsByProvider(provider)
    if (!models.find((m) => m.id === model)) {
      setModel(getDefaultModel(provider))
    }
  }, [provider, model])

  useEffect(() => {
    if (initialized.current) {
      saveSettings({
        prompt,
        negativePrompt,
        width,
        height,
        steps,
        selectedRatio,
        uhd,
        upscale8k,
        provider,
        model,
      })
    }
  }, [prompt, negativePrompt, width, height, steps, selectedRatio, uhd, upscale8k, provider, model])

  useEffect(() => {
    if (imageDetails) {
      localStorage.setItem(IMAGE_DETAILS_KEY, JSON.stringify(imageDetails))
    } else {
      localStorage.removeItem(IMAGE_DETAILS_KEY)
    }
  }, [imageDetails])

  useEffect(() => {
    localStorage.setItem('isBlurred', String(isBlurred))
  }, [isBlurred])

  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const timer = setInterval(() => setElapsed((e) => e + 0.1), 100)
    return () => clearInterval(timer)
  }, [loading])

  const saveToken = async (p: ProviderType, token: string) => {
    setTokens((prev) => ({ ...prev, [p]: token }))
    await encryptAndStoreToken(p, token)
    if (token) toast.success(`${PROVIDER_CONFIGS[p].name} token saved`)
  }

  const addStatus = (msg: string) => {
    setStatus((prev) => `${prev}\n${msg}`)
  }

  const handleRatioSelect = (ratio: (typeof ASPECT_RATIOS)[number]) => {
    setSelectedRatio(ratio.label)
    const preset = uhd ? ratio.presets[1] : ratio.presets[0]
    setWidth(preset.w)
    setHeight(preset.h)
  }

  const handleUhdToggle = (enabled: boolean) => {
    setUhd(enabled)
    const ratio = ASPECT_RATIOS.find((r) => r.label === selectedRatio)
    if (ratio) {
      const preset = enabled ? ratio.presets[1] : ratio.presets[0]
      setWidth(preset.w)
      setHeight(preset.h)
    }
  }

  const handleDownload = async () => {
    if (!imageDetails?.url) return
    const { downloadImage } = await import('@/lib/utils')
    await downloadImage(imageDetails.url, `zenith-${Date.now()}.png`, imageDetails.provider)
  }

  const handleUpscale = async () => {
    if (!imageDetails?.url || isUpscaling || isUpscaled) return
    setIsUpscaling(true)
    addStatus('Upscaling to 4x...')

    const result = await upscaleImage(imageDetails.url, 4, tokens.huggingface || undefined)

    if (result.success && result.data.url) {
      setImageDetails((prev) => (prev ? { ...prev, url: result.data.url as string } : null))
      setIsUpscaled(true)
      addStatus('4x upscale complete!')
      toast.success('Image upscaled to 4x!')
    } else {
      addStatus(`Upscale failed: ${result.success ? 'No URL returned' : result.error}`)
      toast.error('Upscale failed')
    }

    setIsUpscaling(false)
  }

  const handleDelete = () => {
    setImageDetails(null)
    setIsUpscaled(false)
    setIsBlurred(false)
    setShowInfo(false)
    toast.success('Image deleted')
  }

  const handleGenerate = async () => {
    const providerConfig = PROVIDER_CONFIGS[provider]
    if (providerConfig.requiresAuth && !currentToken) {
      toast.error(`Please configure your ${providerConfig.name} token first`)
      return
    }

    setLoading(true)
    setImageDetails(null)
    setIsUpscaled(false)
    setIsBlurred(false)
    setShowInfo(false)
    setStatus('Initializing...')

    try {
      addStatus(`Sending request to ${providerConfig.name}...`)

      const result = await generateImage(
        {
          provider,
          prompt,
          negativePrompt,
          width,
          height,
          steps,
          model,
        },
        { token: currentToken || undefined }
      )

      if (!result.success) {
        throw new Error(result.error)
      }

      const details = result.data.imageDetails
      if (!details?.url) throw new Error('No image returned')
      addStatus(`Image generated in ${details.duration}!`)

      // Auto upscale to 8K if enabled
      if (upscale8k && details.url.startsWith('http')) {
        addStatus('Upscaling to 8K...')
        const upResult = await upscaleImage(details.url, 4, tokens.huggingface || undefined)

        if (upResult.success && upResult.data.url) {
          details.url = upResult.data.url
          addStatus('8K upscale complete!')
        } else {
          addStatus(`8K upscale failed: ${upResult.success ? 'No URL' : upResult.error}`)
          toast.error('8K upscale failed, showing original image')
        }
      }

      setImageDetails(details)
      toast.success('Image generated!')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'An error occurred'
      addStatus(`Error: ${msg}`)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return {
    // State
    tokens,
    currentToken,
    provider,
    model,
    availableModels,
    prompt,
    negativePrompt,
    width,
    height,
    steps,
    loading,
    imageDetails,
    status,
    elapsed,
    selectedRatio,
    uhd,
    showInfo,
    isBlurred,
    isUpscaled,
    isUpscaling,
    // Setters
    setProvider,
    setModel,
    setPrompt,
    setNegativePrompt,
    setWidth,
    setHeight,
    setSteps,
    setShowInfo,
    setIsBlurred,
    // Handlers
    saveToken,
    handleRatioSelect,
    handleUhdToggle,
    handleDownload,
    handleUpscale,
    handleDelete,
    handleGenerate,
  }
}
