export async function main(cmd: string) {
  if (cmd === 'optimize') {
    const { optimize } = await import('./optimizer')
    return optimize()
  }
  const { preview } = await import(`./preview.js`)
  const computed = await import('./' + cmd)
  return [preview(), computed]
}
