// 마케팅 콘텐츠 → 가입 attribution 헬퍼
//
// 1) 발행 시점: createMarketingShortLink + appendAttributionLink
// 2) 클릭 시점: /s/[code] route 가 cookie set (90일)
// 3) 가입 시점: captureAttribution 으로 cookie → profiles 기록

import type { SupabaseClient } from '@supabase/supabase-js'

const TRACKING_HOST = 'https://ssobi.ai'
export const ATTR_COOKIE_NAME = 'ssobi_attr'
export const ATTR_COOKIE_MAX_AGE = 60 * 60 * 24 * 90  // 90일

function genShortCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)]
  return out
}

/**
 * marketing_posts 1건에 대한 short_link 생성.
 *
 * @param sb         service role supabase client
 * @param postId     marketing_posts.id (short_links.marketing_post_id 로 묶임)
 * @param adminUserId  short_links.user_id (NOT NULL FK) — 박을 admin profile id
 * @param targetUrl  리다이렉트 목적지 (기본: https://ssobi.ai)
 * @param label      short_link.label (선택)
 * @returns 생성된 6자 code
 */
export async function createMarketingShortLink(
  sb: SupabaseClient,
  postId: string,
  adminUserId: string,
  targetUrl: string = 'https://ssobi.ai',
  label?: string,
): Promise<string> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = genShortCode()
    const { error } = await sb.from('short_links').insert({
      code,
      user_id: adminUserId,
      target_url: targetUrl,
      label: label || 'Marketing post',
      marketing_post_id: postId,
    })
    if (!error) {
      // marketing_posts.short_code 도 채움
      await sb.from('marketing_posts').update({ short_code: code }).eq('id', postId)
      return code
    }
    lastErr = new Error(error.message)
    // 23505 = duplicate key → retry with new code
    if (error.code !== '23505') break
  }
  throw lastErr || new Error('shortlink_codegen_failed')
}

/**
 * 본문 끝에 추적 링크를 자동 삽입.
 * 이미 ssobi.ai/s/* 가 있으면 중복 추가 안 함.
 */
export function appendAttributionLink(content: string, code: string): string {
  const base = content.trimEnd()
  if (/ssobi\.ai\/s\/[a-zA-Z0-9]{4,12}/.test(base)) return base
  return `${base}\n\n${TRACKING_HOST}/s/${code}`
}

/**
 * 가입 직후 호출 — cookie 값으로 profiles.signup_source_* 채움.
 * 이미 source 가 있으면 skip (idempotent).
 *
 * @returns 캡처 성공시 { code, postId }, 실패시 null
 */
export async function captureAttribution(
  sb: SupabaseClient,
  userId: string,
  cookieValue: string | undefined | null,
): Promise<{ code: string; postId: string | null } | null> {
  if (!cookieValue || !/^[a-zA-Z0-9]{4,12}$/.test(cookieValue)) return null

  // 1) profile 이미 source 가 있나?
  const { data: existing } = await sb
    .from('profiles')
    .select('signup_source_code')
    .eq('id', userId)
    .maybeSingle()
  if (!existing || existing.signup_source_code) return null

  // 2) short_link 유효한지 + 마케팅 post 연결됐는지
  const { data: link } = await sb
    .from('short_links')
    .select('code, marketing_post_id')
    .eq('code', cookieValue)
    .maybeSingle()
  if (!link) return null

  // 3) profile 업데이트
  await sb
    .from('profiles')
    .update({
      signup_source_code: link.code,
      signup_source_post_id: link.marketing_post_id || null,
    })
    .eq('id', userId)

  return { code: link.code, postId: link.marketing_post_id || null }
}
