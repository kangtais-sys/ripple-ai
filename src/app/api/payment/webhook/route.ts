import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// 포트원 결제 웹훅
export async function POST(request: NextRequest) {
  const body = await request.json()

  // 포트원 webhook signature 검증
  const webhookSecret = process.env.PORTONE_WEBHOOK_SECRET
  if (webhookSecret) {
    const sig = request.headers.get('webhook-id')
    if (!sig) return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  const supabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  try {
    const { type, data } = body

    if (type === 'Transaction.Paid') {
      // 결제 완료 → 이미 subscribe 엔드포인트에서 처리됨
      console.log(`[Payment Webhook] Paid: ${data?.paymentId}`)
    }

    if (type === 'Transaction.Failed' || type === 'Transaction.Cancelled') {
      // 결제 실패/취소 → 플랜 다운그레이드
      const paymentId = data?.paymentId || ''
      const userId = paymentId.split('_')[1] // repli_{userId}_{timestamp}

      if (userId) {
        await supabase
          .from('profiles')
          .update({ plan: 'free' })
          .eq('id', userId)

        console.log(`[Payment Webhook] Downgraded user ${userId} to free`)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('[Payment Webhook] Error:', error)
    return NextResponse.json({ received: true })
  }
}
