import { spawn } from 'node:child_process'

type RunResult = {
  code: number
  stdout: string
  stderr: string
}

function runPm2(args: string[], timeoutMs = 15_000): Promise<RunResult> {
  return new Promise(resolve => {
    const child = spawn('pm2', args, {
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })

    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })

    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      resolve({ code: 124, stdout, stderr: `${stderr}\n(pm2 timeout)` })
    }, timeoutMs)

    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })

    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: 127, stdout, stderr: stderr || 'pm2 not found' })
    })
  })
}

export async function isPm2Available(): Promise<boolean> {
  const result = await runPm2(['-v'], 5_000)
  return result.code === 0 && result.stdout.trim().length > 0
}

export async function pm2StartOrReloadEcosystem(
  ecosystemFile: string,
  onlyApp?: string,
): Promise<RunResult> {
  const args = ['startOrReload', ecosystemFile]
  if (onlyApp) {
    args.push('--only', onlyApp)
  }
  return runPm2(args)
}

export async function pm2Stop(appName: string): Promise<RunResult> {
  return runPm2(['stop', appName])
}

export async function pm2Restart(appName: string): Promise<RunResult> {
  return runPm2(['restart', appName])
}

export async function pm2Delete(appName: string): Promise<RunResult> {
  return runPm2(['delete', appName])
}

export type Pm2JListItem = {
  name?: string
  pm2_env?: {
    status?: string
    pm_id?: number
    restart_time?: number
    pm_uptime?: number
  }
}

export async function pm2JList(): Promise<Pm2JListItem[] | null> {
  const result = await runPm2(['jlist'])
  if (result.code !== 0) return null

  try {
    return JSON.parse(result.stdout) as Pm2JListItem[]
  } catch {
    return null
  }
}

