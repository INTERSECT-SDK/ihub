import { promises as fs } from 'fs'
import Profile from './Profile'

export default async function Page({
  params,
}: {
  params: Promise<{ name: string }>
}) {
  const name = (await params).name

  // TODO read from database
  const file = await fs.readFile(
    process.cwd() + `/src/app/profiles/${name}.json`,
    'utf8',
  )

  const profile = JSON.parse(file)
  return <Profile profile={profile} />
}
