import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { streamAssistant, type AssistantCandidateContext, type AssistantImageInput } from '@/lib/api'

export type ChatRole = 'user' | 'assistant'

export type ChatImageAttachment = {
  id: string
  mediaType: AssistantImageInput['mediaType']
  name?: string
  /** 仅内存中用于预览，持久化时省略以避免撑爆 localStorage */
  previewUrl?: string
}

export type ChatMsg = {
  id: string
  role: ChatRole
  content: string
  images?: ChatImageAttachment[]
  thinking: string[]
  reasoning?: string
  modelLabel?: string
  streaming?: boolean
  error?: string
  errorCode?: string
  at: number
}

export type ChatSession = {
  id: string
  title: string
  createdAt: number
  messages: ChatMsg[]
}

type ChatState = {
  sessions: ChatSession[]
  activeId: string | null
  streamingId: string | null
  createSession: () => string
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  send: (
    text: string,
    contextCandidate?: AssistantCandidateContext | null,
    modelOverride?: { provider?: string; model?: string } | null,
    images?: (AssistantImageInput & { previewUrl?: string })[],
  ) => Promise<void>
  stop: () => void
  clearAll: () => void
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

let abortStream: (() => void) | null = null

function patchMessage(
  set: (fn: (state: ChatState) => Partial<ChatState>) => void,
  messageId: string,
  patch: (message: ChatMsg) => ChatMsg,
) {
  set((state) => ({
    sessions: state.sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => (message.id === messageId ? patch(message) : message)),
    })),
  }))
}

export const useChat = create<ChatState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeId: null,
      streamingId: null,

      createSession: () => {
        const id = uid()
        const session: ChatSession = { id, title: '新会话', createdAt: Date.now(), messages: [] }
        set((state) => ({
          sessions: [session, ...state.sessions].slice(0, 20),
          activeId: id,
        }))
        return id
      },

      selectSession: (id) => set({ activeId: id }),

      deleteSession: (id) =>
        set((state) => {
          const sessions = state.sessions.filter((s) => s.id !== id)
          return { sessions, activeId: state.activeId === id ? (sessions[0]?.id ?? null) : state.activeId }
        }),

      stop: () => {
        abortStream?.()
        abortStream = null
        const id = get().streamingId
        if (id) patchMessage(set, id, (m) => ({ ...m, streaming: false }))
        set({ streamingId: null })
      },

      clearAll: () => {
        abortStream?.()
        set({ sessions: [], activeId: null, streamingId: null })
      },

      send: async (text, contextCandidate = null, modelOverride = null, images = []) => {
        const content = text.trim()
        const validImages = Array.isArray(images) ? images.slice(0, 4) : []
        if (!content && validImages.length === 0) return

        let sessionId = get().activeId
        if (!sessionId) sessionId = get().createSession()
        const session = get().sessions.find((s) => s.id === sessionId)
        if (!session) return

        const history = session.messages
          .filter((m) => !m.error && (m.content || (m.images && m.images.length > 0)))
          .slice(-8)
          .map((m) => ({
            role: m.role,
            content: m.content || (m.images?.length ? `[附带 ${m.images.length} 张图片]` : ''),
          }))

        const userImages: ChatImageAttachment[] = validImages.map((img) => ({
          id: uid(),
          mediaType: img.mediaType,
          name: img.name,
          previewUrl: img.previewUrl || `data:${img.mediaType};base64,${img.data}`,
        }))

        const displayTitle = content ? content.slice(0, 18) : `图片分析 (${validImages.length} 张)`
        const assistantId = uid()
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  title: s.title === '新会话' ? displayTitle : s.title,
                  messages: [
                    ...s.messages,
                    {
                      id: uid(),
                      role: 'user' as const,
                      content,
                      ...(userImages.length ? { images: userImages } : {}),
                      thinking: [],
                      at: Date.now(),
                    },
                    {
                      id: assistantId,
                      role: 'assistant' as const,
                      content: '',
                      thinking: [],
                      reasoning: '',
                      streaming: true,
                      at: Date.now(),
                    },
                  ],
                }
              : s,
          ),
          streamingId: assistantId,
        }))

        abortStream = streamAssistant(
          {
            message: content,
            history,
            contextCandidate,
            ...(validImages.length
              ? {
                  images: validImages.map((img) => ({
                    mediaType: img.mediaType,
                    data: img.data,
                    ...(img.name ? { name: img.name } : {}),
                  })),
                }
              : {}),
            ...(modelOverride?.provider && modelOverride?.model
              ? { provider: modelOverride.provider, model: modelOverride.model }
              : {}),
          },
          {
            onMeta: (meta) => {
              if (meta.provider && meta.model) {
                patchMessage(set, assistantId, (m) => ({
                  ...m,
                  modelLabel: `${meta.provider} / ${meta.model}`,
                }))
              }
            },
            onThinking: (steps) =>
              patchMessage(set, assistantId, (m) => ({
                ...m,
                thinking: [...m.thinking, ...steps.filter((step) => !m.thinking.includes(step))].slice(-6),
              })),
            onReasoning: (chunk) =>
              patchMessage(set, assistantId, (m) => ({
                ...m,
                reasoning: (m.reasoning || '') + chunk,
              })),
            onDelta: (chunk) =>
              patchMessage(set, assistantId, (m) => ({ ...m, content: m.content + chunk })),
            onDone: () => {
              patchMessage(set, assistantId, (m) => ({ ...m, streaming: false }))
              set({ streamingId: null })
              abortStream = null
            },
            onError: (message, code) => {
              patchMessage(set, assistantId, (m) => ({
                ...m,
                streaming: false,
                error: message,
                errorCode: code,
              }))
              set({ streamingId: null })
              abortStream = null
            },
          },
        )
      },
    }),
    {
      name: 'bole-chat-v1',
      partialize: (state) => ({
        activeId: state.activeId,
        sessions: state.sessions.slice(0, 20).map((s) => ({
          ...s,
          messages: s.messages.slice(-60).map((m) => ({
            ...m,
            streaming: false,
            ...(m.images
              ? {
                  images: m.images.map(({ id, mediaType, name }) => ({ id, mediaType, name })),
                }
              : {}),
          })),
        })),
      }),
      onRehydrateStorage: () => (state) => {
        state?.sessions.forEach((s) => s.messages.forEach((m) => (m.streaming = false)))
      },
    },
  ),
)
