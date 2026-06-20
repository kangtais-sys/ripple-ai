// src/app/api/inngest/route.ts
import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { fetchUrlWorker } from '@/inngest/workers/fetch-url'
import { chunkTextWorker } from '@/inngest/workers/chunk-text'
import { embedChunksWorker } from '@/inngest/workers/embed-chunks'
import { learnIgPersonaWorker } from '@/inngest/workers/learn-ig-persona'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [fetchUrlWorker, chunkTextWorker, embedChunksWorker, learnIgPersonaWorker],
  streaming: false,
})

// 이 라우트는 Vercel function이지만 실제 작업은 Inngest cloud가 트리거.
// 메모리 부담 거의 없음 (각 step이 별도 invocation).
