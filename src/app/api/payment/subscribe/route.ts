import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { PLANS, type PlanKey } from '@/lib/plans'

// 포트원 빌링키 발급 후 구독 등록
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { plan, billingKey } = await request.json()

  if (!PLANS[plan as PlanKey] || plan === 'free') {
    return NextResponse.json({ error: '유효하지 않은 플랜' }, { status: 400 })
  }

  const planInfo = PLANS[plan as PlanKey]

  try {
    // 포트원 정기결제 예약
    const paymentId = `repli_${user.id}_${Date.now()}`

    const portoneRes = await fetch('https://api.portone.io/payments/billing-key', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `PortOne ${process.env.PORTONE_API_SECRET}`,
      },
      body: JSON.stringify({
        billingKey,
        orderName: `Repli ${planInfo.name} 월간 구독`,
        customer: {
          id: user.id,
          email: user.email,
        },
        amount: {
          total: planInfo.price,
          currency: 'KRW',
        },
        paymentId,
      }),
    })

    const paymentData = await portoneRes.json()

    if (!portoneRes.ok) {
      console.error('[Payment] PortOne error:', paymentData)
      return NextResponse.json({ error: paymentData.message || '결제 실패' }, { status: 400 })
    }

    // 플랜 업그레이드
    await supabase
      .from('profiles')
      .update({ plan })
      .eq('id', user.id)

    // 알림톡 발송
    await sendKakaoNotify(user.email || '', planInfo.name, planInfo.price)

    return NextResponse.json({ success: true, plan, paymentId })
  } catch (error) {
    console.error('[Payment] Error:', error)
    return NextResponse.json({ error: '결제 처리 중 오류' }, { status: 500 })
  }
}

async function sendKakaoNotify(email: string, planName: string, price: number) {
  if (!process.env.KAKAO_ALIMTALK_API_KEY) return

  try {
    await fetch('https://api-alimtalk.cloud.toast.com/alimtalk/v2.3/appkeys/' + process.env.KAKAO_ALIMTALK_APP_KEY + '/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Secret-Key': process.env.KAKAO_ALIMTALK_API_KEY!,
      },
      body: JSON.stringify({
        senderKey: process.env.KAKAO_SENDER_KEY,
        templateCode: 'REPLI_SUBSCRIBE',
        recipientList: [{
          recipientNo: email, // 실제론 전화번호 필요
          templateParameter: {
            plan: planName,
            price: price.toLocaleString(),
            date: new Date().toLocaleDateString('ko-KR'),
          },
        }],
      }),
    })
  } catch (e) {
    console.error('[Kakao] Alimtalk failed:', e)
  }
}
