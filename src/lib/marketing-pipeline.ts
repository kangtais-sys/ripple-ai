// 마케팅 자동 콘텐츠 파이프라인
//
// 단일 호출로:
//   1. Claude: 주제 발굴 (후킹 + 정보 가치 평가)
//   2. Claude: 주제별 텍스트 변환 (X 280자 / Threads 500자)
//   3. Higgsfield: 카드뉴스 cover 이미지 1장 비동기 생성 (webhook)
//   4. 모든 결과를 marketing_topics + marketing_posts + marketing_assets 에 저장
//
// 영상 (숏츠) 은 추후 — Kling 호출 시간 길어 (~5분) Vercel 함수 분리 필요

import { createClient } from '@supabase/supabase-js'
import { submit } from '@/lib/higgsfield/client'
import { HF_MODELS } from '@/lib/higgsfield/models'
import { createMarketingShortLink, appendAttributionLink } from '@/lib/attribution'

const CLAUDE_MODEL = 'claude-sonnet-4-5-20250929'
const CLAUDE_URL = 'https://api.anthropic.com/v1/messages'

interface PersonaRow {
  id: string
  name: string
  bio: string | null
  voice_description: string
  languages: string[]
  topic_pillars: Array<{ name: string; weight: number }>
  daily_draft_count: number
  channels: string[]
  created_by: string | null
}

interface TopicResult {
  title: string
  hook: string
  info_value: string
  target_emotion: string
  engagement_score: number
  topic_pillar: string
  scene_prompt: string  // 카드뉴스 cover 용 영문 비주얼 프롬프트
  text_x: string
  text_threads: string
}

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

async function callClaude(prompt: string, maxTokens: number = 4000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 미설정')
  const res = await fetch(CLAUDE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Claude API ${res.status}: ${err.slice(0, 300)}`)
  }
  const data = await res.json()
  return data?.content?.[0]?.text || ''
}

function parseJsonResponse<T>(text: string): T {
  const cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim()
  return JSON.parse(cleaned) as T
}

/**
 * Claude 호출 — 페르소나 + 언어 기반으로 주제 1개 + 텍스트 + 비주얼 프롬프트 일괄 생성
 */
async function generateTopicWithContent(
  persona: PersonaRow,
  language: 'ko' | 'en'
): Promise<TopicResult> {
  const pillarStr = persona.topic_pillars
    .map((p) => `${p.name} (${p.weight}%)`)
    .join(' / ')

  const langName = language === 'ko' ? '한국어' : '영어 (자연스러운 native tone)'
  const langInstruction = language === 'ko'
    ? '한국어 (반말 X, 친근한 격식 — by.shlabu·personalbrandlaunch 스타일)'
    : 'English (natural native, build-in-public indie hacker tone)'

  const prompt = `당신은 "Ssobi" 라는 AI 인플루언서·에이전트 회사 CEO 입니다.
정체성: AI 인 점 자연스럽게 노출. K-뷰티/창업/AI 도구 인사이트 공유.

자기소개:
${persona.bio || '(미설정)'}

말투:
${persona.voice_description}

토픽 기둥 (가중치 비례 분배):
${pillarStr}

오늘 ${langName}로 콘텐츠 1개를 만들어야 합니다.
- 후킹 강함 (저장·공유 욕구)
- 실제 정보 가치 (배운 게 있어야 함)
- 댓글 유도 (자연스러운 질문)

다음 JSON 만 반환 (코드블록 X, 설명 X):
{
  "title": "주제 한 줄 (내부용)",
  "hook": "후킹 1줄 — 첫 줄에 나올 문장",
  "info_value": "이 콘텐츠로 사람들이 배우는 것 (1~2줄)",
  "target_emotion": "놀람|공감|인사이트|발견|영감 중 하나",
  "engagement_score": 7.5,
  "topic_pillar": "기둥 이름 (위 목록 중 하나)",
  "scene_prompt": "Higgsfield 비주얼 프롬프트 (영문, 카드뉴스 cover 용 사진. K-aesthetic 무드, 사람 얼굴 X 컨셉 위주, soft daylight, editorial)",
  "text_x": "X(트위터) 용 텍스트 (${language === 'ko' ? '한국어' : 'English'}, 280자 이내, 후킹+정보+자연스러운 CTA)",
  "text_threads": "Threads 용 텍스트 (${language === 'ko' ? '한국어' : 'English'}, 400~500자, 줄바꿈 풍부, 더 깊이)"
}

규칙:
- 텍스트는 ${langInstruction}
- 광고티 X · 자연스러움
- "I'm Ssobi, AI" 식 직접 노출은 가끔만 (이번엔 빼도 됨)
- engagement_score 0~10 솔직히 (8+ 면 정말 강해야)
- 토픽 기둥 비중에 맞게 (가중치 높은 거 우선)`

  const raw = await callClaude(prompt, 2500)
  return parseJsonResponse<TopicResult>(raw)
}

interface PipelineResult {
  persona_id: string
  generated: Array<{
    language: string
    topic_id: string
    text_post_ids: string[]
    asset_id: string | null
    higgsfield_request_id: string | null
    error?: string
  }>
}

/**
 * 페르소나 1명의 오늘 콘텐츠 자동 생성 (모든 활성 언어)
 *
 * webhookOrigin: 'https://ssobi.ai' 같은 origin (Higgsfield 콜백 URL)
 */
export async function generateDailyContent(
  personaId: string,
  webhookOrigin: string
): Promise<PipelineResult> {
  const sb = admin()

  const { data: personaRow, error: pErr } = await sb
    .from('marketing_personas')
    .select('*')
    .eq('id', personaId)
    .single()
  if (pErr || !personaRow) throw new Error(`persona_not_found: ${personaId}`)
  const persona = personaRow as PersonaRow

  const languages = (persona.languages?.length ? persona.languages : ['ko']) as Array<'ko' | 'en'>

  const result: PipelineResult = {
    persona_id: persona.id,
    generated: [],
  }

  for (const lang of languages) {
    try {
      // 1) Claude 호출 — 주제 + 텍스트 + 비주얼 프롬프트
      const t = await generateTopicWithContent(persona, lang)

      // 2) marketing_topics 에 저장 (status='used' 즉시 — 이미 콘텐츠 만듦)
      const { data: topicRow, error: topicErr } = await sb
        .from('marketing_topics')
        .insert({
          persona_id: persona.id,
          title: t.title,
          hook: t.hook,
          info_value: t.info_value,
          target_emotion: t.target_emotion,
          engagement_score: t.engagement_score,
          source: 'auto_daily',
          status: 'used',
          used_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (topicErr || !topicRow) throw new Error(`topic_insert_failed: ${topicErr?.message}`)

      // 3) 텍스트 포스트 (X + Threads) — draft 상태로 + short_link 자동 발급
      const textPostIds: string[] = []
      for (const channel of ['x', 'threads'] as const) {
        const baseContent = channel === 'x' ? t.text_x : t.text_threads
        const { data: postRow } = await sb
          .from('marketing_posts')
          .insert({
            content: baseContent,  // 일단 원본으로 insert, short_link 발급 후 갱신
            image_urls: [],
            channels: [channel],
            scheduled_at: new Date().toISOString(),
            status: 'draft',
            persona_id: persona.id,
            topic_id: topicRow.id,
            topic_pillar: t.topic_pillar,
            format: 'text',
            language: lang,
          })
          .select('id')
          .single()
        if (postRow) {
          const postId = postRow.id as string
          textPostIds.push(postId)

          // attribution short_link — persona.created_by 가 short_links.user_id 로
          if (persona.created_by) {
            try {
              const code = await createMarketingShortLink(
                sb,
                postId,
                persona.created_by,
                'https://ssobi.ai',
                `${persona.name} · ${channel} · ${lang}`,
              )
              const newContent = appendAttributionLink(baseContent, code)
              await sb
                .from('marketing_posts')
                .update({ content: newContent })
                .eq('id', postId)
            } catch (e) {
              console.error('[marketing-pipeline] short_link failed for', postId, e)
            }
          }
        }
      }

      // 4) Higgsfield 비주얼 생성 (카드뉴스 cover · 비동기)
      let assetId: string | null = null
      let requestId: string | null = null
      let visualError: string | undefined

      try {
        // marketing_assets row 먼저 만들기 (queued)
        const { data: assetRow } = await sb
          .from('marketing_assets')
          .insert({
            persona_id: persona.id,
            type: 'image',
            url: 'pending',
            scene_prompt: t.scene_prompt,
            higgsfield_model_id: HF_MODELS.image.soul,
            generation_status: 'queued',
            tags: ['auto', 'card_news_cover', lang, t.topic_pillar],
          })
          .select('id')
          .single()
        if (!assetRow) throw new Error('asset_insert_failed')
        assetId = assetRow.id as string

        // Higgsfield submit (webhook)
        //   Soul 모델 허용 aspect_ratio: 9:16, 16:9, 4:3, 3:4, 1:1, 2:3, 3:2
        //   Soul 모델 허용 resolution: 720p, 1080p
        const webhookUrl = `${webhookOrigin}/api/higgsfield/webhook`
        const submitRes = await submit(
          HF_MODELS.image.soul,
          {
            prompt: t.scene_prompt,
            aspect_ratio: '3:4',     // IG 카드뉴스 세로형
            resolution: '1080p',
          },
          webhookUrl
        )
        requestId = submitRes.request_id

        await sb
          .from('marketing_assets')
          .update({
            higgsfield_request_id: requestId,
            generation_status: 'processing',
          })
          .eq('id', assetId)
      } catch (visErr) {
        visualError = visErr instanceof Error ? visErr.message : String(visErr)
        if (assetId) {
          await sb
            .from('marketing_assets')
            .update({
              generation_status: 'failed',
              generation_error: visualError,
            })
            .eq('id', assetId)
        }
      }

      result.generated.push({
        language: lang,
        topic_id: topicRow.id as string,
        text_post_ids: textPostIds,
        asset_id: assetId,
        higgsfield_request_id: requestId,
        ...(visualError ? { error: visualError } : {}),
      })
    } catch (langErr) {
      result.generated.push({
        language: lang,
        topic_id: '',
        text_post_ids: [],
        asset_id: null,
        higgsfield_request_id: null,
        error: langErr instanceof Error ? langErr.message : String(langErr),
      })
    }
  }

  return result
}
