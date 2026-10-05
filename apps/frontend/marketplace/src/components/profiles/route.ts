import { promises as fs } from 'fs'
import { NextResponse } from 'next/server'

const PROFILES_DIR = `${process.cwd()}/src/app/profiles`

export async function GET() {
  const fileNames = await getFiles()

  const regex: RegExp = /.json/
  const jsonFiles = fileNames.filter((name) => regex.test(name))

  const profiles = jsonFiles.map(async (fileName) => {
    const data = await readFile(fileName)
    return data
  })

  const results = await Promise.all(profiles)
  return NextResponse.json(results)
}

async function getFiles() {
  try {
    const files = await fs.readdir(PROFILES_DIR)
    return files
  } catch (error) {
    console.error('Error reading directory:', error)
    return []
  }
}

async function readFile(fileName: string) {
  const filePath = `${PROFILES_DIR}/${fileName}`
  const fileContents = await fs.readFile(filePath, 'utf8')
  const data = JSON.parse(fileContents)
  return data
}
