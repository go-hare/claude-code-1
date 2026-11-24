import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { ACPClient } from '../acp/client'
import type { ModelInfo, SessionModelState } from '../acp/types'

const MODEL_CHANGE_TIMEOUT_MS = 15_000

export interface UseModelsResult {
  /** Whether model selection is supported by the current agent */
  supportsModelSelection: boolean
  /** List of available models */
  availableModels: ModelInfo[]
  /** The currently selected model ID */
  currentModelId: string | null
  /** The currently selected model info */
  currentModel: ModelInfo | null
  /** Set the model for the current session */
  setModel: (modelId: string) => Promise<void>
  /** Whether a model change is in progress */
  isLoading: boolean
}

/**
 * Hook to manage model selection state.
 * Reference: Zed's AcpModelSelector reads from state.available_models and state.current_model_id
 *
 * Uses event-driven updates instead of polling:
 * - setModelStateChangedHandler: called on session create/disconnect
 * - setModelChangedHandler: called when model selection changes
 */
export function useModels(client: ACPClient): UseModelsResult {
  const [modelState, setModelState] = useState<SessionModelState | null>(
    client.modelState,
  )
  const [isLoading, setIsLoading] = useState(false)
  const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearLoadingTimer = useCallback(() => {
    if (loadingTimerRef.current) {
      clearTimeout(loadingTimerRef.current)
      loadingTimerRef.current = null
    }
  }, [])

  // Subscribe to model state changes (session created/destroyed)
  useEffect(() => {
    const handleModelStateChanged = (state: SessionModelState | null) => {
      setModelState(state)
      if (!state) {
        clearLoadingTimer()
        setIsLoading(false)
        return
      }
      // Auto-restore previously selected model when a new session is created
      if (state.availableModels.length > 0) {
        let saved: string | null = null
        try {
          saved = localStorage.getItem('acp_model_id')
        } catch {
          // ignore
        }
        if (
          saved &&
          saved !== state.currentModelId &&
          state.availableModels.some(m => m.modelId === saved)
        ) {
          client.setSessionModel(saved).catch(() => {})
        }
      }
    }

    // Handler for when current model changes within a session
    const handleModelChanged = (modelId: string) => {
      clearLoadingTimer()
      try {
        localStorage.setItem('acp_model_id', modelId)
      } catch {
        // ignore
      }
      setModelState(prev => {
        if (!prev) return null
        return {
          ...prev,
          currentModelId: modelId,
        }
      })
      setIsLoading(false)
    }

    const handleError = () => {
      clearLoadingTimer()
      setIsLoading(false)
    }

    client.setModelStateChangedHandler(handleModelStateChanged)
    client.setModelChangedHandler(handleModelChanged)
    client.addErrorMessageHandler(handleError)

    return () => {
      clearLoadingTimer()
      client.setModelStateChangedHandler(() => {})
      client.setModelChangedHandler(() => {})
      client.removeErrorMessageHandler(handleError)
    }
  }, [client, clearLoadingTimer])

  const availableModels = useMemo(
    () => modelState?.availableModels ?? [],
    [modelState],
  )

  const currentModelId = modelState?.currentModelId ?? null

  const currentModel = useMemo(
    () => availableModels.find(m => m.modelId === currentModelId) ?? null,
    [availableModels, currentModelId],
  )

  const setModel = useCallback(
    async (modelId: string) => {
      if (!modelState) {
        throw new Error('Model selection not supported')
      }
      clearLoadingTimer()
      setIsLoading(true)
      loadingTimerRef.current = setTimeout(() => {
        loadingTimerRef.current = null
        setIsLoading(false)
      }, MODEL_CHANGE_TIMEOUT_MS)
      try {
        await client.setSessionModel(modelId)
        // Persist to localStorage only after server confirms via model_changed
      } catch (error) {
        clearLoadingTimer()
        setIsLoading(false)
        throw error
      }
    },
    [client, modelState, clearLoadingTimer],
  )

  return {
    supportsModelSelection: modelState !== null && availableModels.length > 0,
    availableModels,
    currentModelId,
    currentModel,
    setModel,
    isLoading,
  }
}
