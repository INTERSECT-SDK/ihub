export function downloadJson(fileName: string, data: any) {
  const jsonStr = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = decodeURIComponent(fileName)
  a.click()

  URL.revokeObjectURL(url)
}
