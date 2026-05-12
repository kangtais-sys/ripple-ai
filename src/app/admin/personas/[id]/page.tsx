import PersonaDetailClient from './client'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <PersonaDetailClient personaId={id} />
}
