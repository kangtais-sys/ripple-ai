// src/inngest/client.ts
import { Inngest } from 'inngest'

// 이벤트 타입 — 워커들끼리 주고받는 페이로드 정의
export type Events = {
  'learn/url.requested': {
    data: {
      userId: string
      url: string
      sourceLabel?: string // 예: "millimilli 27번 상품"
      sourceType?: 'link_block' | 'manual' | 'sync' // 어디서 들어왔는지
      blockId?: string
    }
  }
  'learn/text.ready': {
    data: {
      userId: string
      url: string
      sourceLabel?: string
      sourceType?: string
      blockId?: string
      rawTextId: string // learn_queue.id (raw_text 저장된 row)
    }
  }
  'learn/chunks.ready': {
    data: {
      userId: string
      url: string
      sourceLabel?: string
      chunkIds: string[] // knowledge_chunks.id 배열 (embedding=null 상태)
    }
  }
  'learn/ig.connected': {
    data: {
      userId: string // IG 연동 직후 — 토큰은 ig_accounts 에서 워커가 읽음(이벤트에 안 실음)
    }
  }
}

export const inngest = new Inngest({
  id: 'ssobi',
  // INNGEST_EVENT_KEY는 Vercel env에 자동 설정됨 (Inngest 통합 시)
})
