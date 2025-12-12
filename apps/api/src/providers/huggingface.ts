/**
 * HuggingFace Provider Implementation
 */

import { HF_SPACES } from '@z-image/shared'
import type { GenerateSuccessResponse } from '@z-image/shared'
import type { ImageProvider, ProviderGenerateRequest } from './types'

/** Extract complete event data from SSE stream */
function extractCompleteEventData(sseStream: string): unknown {
  const lines = sseStream.split('\n')
  let currentEvent = ''

  for (const line of lines) {
    if (line.startsWith('event:')) {
      currentEvent = line.substring(6).trim()
    } else if (line.startsWith('data:')) {
      const jsonData = line.substring(5).trim()
      if (currentEvent === 'complete') {
        return JSON.parse(jsonData)
      }
      if (currentEvent === 'error') {
        // Parse actual error message from data
        try {
          const errorData = JSON.parse(jsonData)
          const errorMsg =
            errorData?.error || errorData?.message || JSON.stringify(errorData) || 'Unknown error'
          throw new Error(errorMsg)
        } catch (e) {
          if (e instanceof SyntaxError) {
            throw new Error(jsonData || 'Unknown SSE error')
          }
          throw e
        }
      }
    }
  }
  // No complete/error event found, show raw response for debugging
  throw new Error(`Unexpected SSE response: ${sseStream.substring(0, 300)}`)
}

/** Call Gradio API */
async function callGradioApi(baseUrl: string, endpoint: string, data: unknown[], hfToken?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (hfToken) headers.Authorization = `Bearer ${hfToken}`

  // Debug: log request (uncomment for debugging)
  // console.log(`[HuggingFace] Calling ${baseUrl}/gradio_api/call/${endpoint}`)
  // console.log('[HuggingFace] Data:', JSON.stringify(data).slice(0, 200))

  const queue = await fetch(`${baseUrl}/gradio_api/call/${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })

  if (!queue.ok) {
    const errText = await queue.text().catch(() => '')
    // console.error(`[HuggingFace] Queue request failed: ${queue.status}`, errText)
    throw new Error(`Queue request failed: ${queue.status} - ${errText.slice(0, 100)}`)
  }

  const queueData = (await queue.json()) as { event_id?: string }
  if (!queueData.event_id) {
    // console.error('[HuggingFace] No event_id in response:', queueData)
    throw new Error('No event_id returned')
  }

  // console.log(`[HuggingFace] Got event_id: ${queueData.event_id}`)

  const result = await fetch(`${baseUrl}/gradio_api/call/${endpoint}/${queueData.event_id}`, {
    headers,
  })
  const text = await result.text()

  // console.log(`[HuggingFace] SSE response length: ${text.length}`)

  return extractCompleteEventData(text) as unknown[]
}

/** Model-specific Gradio configurations */
const MODEL_CONFIGS: Record<
  string,
  { endpoint: string; buildData: (r: ProviderGenerateRequest, seed: number) => unknown[] }
> = {
  'z-image-turbo': {
    endpoint: 'generate_image',
    buildData: (r, seed) => [r.prompt, r.height, r.width, r.steps ?? 9, seed, false],
  },
  'qwen-image-fast': {
    endpoint: 'generate_image',
    buildData: (r, seed) => [r.prompt, seed, true, '1:1', 3, r.steps ?? 8],
  },
  'ovis-image': {
    endpoint: 'generate',
    buildData: (r, seed) => [r.prompt, r.height, r.width, seed, r.steps ?? 24, 4],
  },
  'flux-1-schnell': {
    endpoint: 'infer',
    buildData: (r, seed) => [r.prompt, seed, false, r.width, r.height, r.steps ?? 8],
  },
}

export class HuggingFaceProvider implements ImageProvider {
  readonly id = 'huggingface'
  readonly name = 'HuggingFace'

  async generate(request: ProviderGenerateRequest): Promise<GenerateSuccessResponse> {
    const seed = request.seed ?? Math.floor(Math.random() * 2147483647)
    const modelId = request.model || 'z-image-turbo'
    const baseUrl = HF_SPACES[modelId as keyof typeof HF_SPACES] || HF_SPACES['z-image-turbo']
    const config = MODEL_CONFIGS[modelId] || MODEL_CONFIGS['z-image-turbo']

    // Debug: log model info (uncomment for debugging)
    // console.log(`[HuggingFace] Model: ${modelId}, BaseURL: ${baseUrl}`)

    const data = await callGradioApi(
      baseUrl,
      config.endpoint,
      config.buildData(request, seed),
      request.authToken
    )

    const result = data as Array<{ url?: string } | number>
    const imageUrl = (result[0] as { url?: string })?.url
    if (!imageUrl) {
      // console.error('[HuggingFace] Invalid result:', result)
      throw new Error('No image returned from HuggingFace')
    }

    // console.log(`[HuggingFace] Success! URL: ${imageUrl.slice(0, 60)}...`)
    return {
      url: imageUrl,
      seed: typeof result[1] === 'number' ? result[1] : seed,
    }
  }
}

export const huggingfaceProvider = new HuggingFaceProvider()
