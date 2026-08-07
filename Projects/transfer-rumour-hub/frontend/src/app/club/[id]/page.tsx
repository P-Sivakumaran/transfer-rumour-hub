import { notFound } from 'next/navigation'
import { api } from '@/lib/api'
import ClubDashboard from '@/components/ClubDashboard'

export default async function ClubPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10)
  const club = await api.clubs.get(id).catch(() => null)
  if (!club) notFound()

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-slate-500">{club.league} · {club.country}</p>
        <h1 className="text-3xl font-bold">{club.name}</h1>
      </div>
      <ClubDashboard club={club} />
    </div>
  )
}
