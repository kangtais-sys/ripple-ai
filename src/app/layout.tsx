import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ssobi.ai"),
  title: { default: "Ssobi. — 소셜 비서", template: "%s · Ssobi." },
  description: "키우고, 만들고. 이젠 나 대신 Ssobi가. SNS 자동 응대·카드뉴스 생성·내 링크까지 한 곳에서.",
  keywords: ["Ssobi", "쏘비", "소셜 비서", "SNS 자동화", "카드뉴스", "인플루언서", "링크인바이오"],
  authors: [{ name: "(주)공팔리터글로벌" }],
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: "https://ssobi.ai",
    siteName: "Ssobi.",
    title: "Ssobi. — 키우고, 만들고. 이젠 나 대신 Ssobi가.",
    description: "SNS 자동 응대·카드뉴스 생성·내 링크까지. 소셜 비서 Ssobi.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Ssobi." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ssobi. — 소셜 비서",
    description: "키우고, 만들고. 이젠 나 대신 Ssobi가.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
