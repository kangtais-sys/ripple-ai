import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // 외부 이미지 최적화 허용 도메인 (Supabase Storage)
    //   /_next/image?url=...  엔드포인트가 Supabase 이미지를 가져와
    //   WebP/AVIF 변환 + 자동 리사이즈 + Vercel edge 캐시
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ffozahaztbudvsnnkvep.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
    // 최적화된 이미지의 minimum cache TTL — 31일 (Vercel 기본 60초에서 상향)
    //   Supabase Storage 가 no-cache 반환해도 Vercel edge 에서 이만큼 보존
    minimumCacheTTL: 60 * 60 * 24 * 31,
    // WebP + AVIF 자동 변환 (브라우저 지원 따라)
    formats: ['image/avif', 'image/webp'],
    // 일반적 디바이스 너비
    deviceSizes: [375, 640, 750, 828, 1080, 1200],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384, 480, 640, 800],
  },
};

export default nextConfig;
