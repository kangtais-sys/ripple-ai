// Higgsfield 모델 카탈로그
//
// 출처: https://docs.higgsfield.ai/docs/guides/images.md, .../video.md
//       전체 100+ 모델 https://cloud.higgsfield.ai/explore
// 사용 패턴:
//   import { HF_MODELS } from '@/lib/higgsfield/models'
//   submit(HF_MODELS.image.soul, { prompt, ... })

export const HF_MODELS = {
  image: {
    /** Higgsfield Soul Standard — flagship text-to-image. K-뷰티·포토리얼리즘 우수 */
    soul: 'higgsfield-ai/soul/standard',
    /** Reve — 다목적 text-to-image */
    reve: 'reve/text-to-image',
    /** Bytedance Seedream v4 — 사진 디테일·자연스러움 */
    seedream: 'bytedance/seedream/v4/text-to-image',
  },
  video: {
    /** Higgsfield DOP Preview — cinematic 비디오 */
    dop: 'higgsfield-ai/dop/preview',
    /** Bytedance Seedance Pro — image-to-video, 자연스러운 motion */
    seedance: 'bytedance/seedance/v1/pro/image-to-video',
    /** Kling 2.1 Pro — image-to-video, 아시아 미학 + 우수한 motion */
    kling: 'kling-video/v2.1/pro/image-to-video',
  },
} as const

export type HFImageModel = (typeof HF_MODELS.image)[keyof typeof HF_MODELS.image]
export type HFVideoModel = (typeof HF_MODELS.video)[keyof typeof HF_MODELS.video]
export type HFModelId = HFImageModel | HFVideoModel

// 기본 추천 — 페르소나 자동 생성 시 사용
export const HF_DEFAULTS = {
  text_to_image: HF_MODELS.image.soul,       // 캐릭터 + 시나리오
  image_to_video: HF_MODELS.video.kling,     // 5초 릴스·쇼츠
  fallback_image: HF_MODELS.image.seedream,  // soul 실패 시
} as const

// 채널별 권장 사이즈 (Higgsfield 가 받는 aspect_ratio·resolution 값)
//   허용 aspect_ratio: '9:16', '16:9', '4:3', '3:4', '1:1', '2:3', '3:2'
//   허용 resolution: '720p', '1080p' (2K 는 일부 모델만 지원 — 안전하게 1080p 사용)
export const CHANNEL_DIMENSIONS = {
  instagram_square: { aspect_ratio: '1:1', resolution: '1080p' },     // 1080×1080
  instagram_portrait: { aspect_ratio: '3:4', resolution: '1080p' },   // IG 캐러셀 (4:5 X → 3:4)
  instagram_story: { aspect_ratio: '9:16', resolution: '1080p' },     // 1080×1920
  reels_tiktok: { aspect_ratio: '9:16', resolution: '1080p' },        // 1080×1920
  card_news_slide: { aspect_ratio: '3:4', resolution: '1080p' },      // 카드뉴스 (3:4)
  hero_landscape: { aspect_ratio: '16:9', resolution: '1080p' },      // 1920×1080
} as const
