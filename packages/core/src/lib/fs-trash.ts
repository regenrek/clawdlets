import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.lstat(targetPath)
    return true
  } catch (err: any) {
    if (err?.code === "ENOENT") return false
    throw err
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true })
}

async function uniqueTrashName(baseName: string, dirPath: string): Promise<string> {
  const candidate = path.join(dirPath, baseName)
  if (!(await pathExists(candidate))) return baseName

  const ext = path.extname(baseName)
  const stem = path.basename(baseName, ext)
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`
    const name = `${stem}-${suffix}${ext}`
    if (!(await pathExists(path.join(dirPath, name)))) return name
  }

  throw new Error("failed to generate unique trash name")
}

async function movePath(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await fs.rename(sourcePath, destinationPath)
    return
  } catch (err: any) {
    if (err?.code !== "EXDEV") throw err
  }

  await fs.cp(sourcePath, destinationPath, { recursive: true, dereference: true })
  await fs.rm(sourcePath, { recursive: true, force: true })
}

function formatTrashDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "")
}

async function moveToTrashDarwin(targetPath: string): Promise<void> {
  const trashDir = path.join(os.homedir(), ".Trash")
  await ensureDir(trashDir)
  const name = await uniqueTrashName(path.basename(targetPath), trashDir)
  await movePath(targetPath, path.join(trashDir, name))
}

async function moveToTrashXdg(targetPath: string): Promise<void> {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share")
  const trashBase = path.join(dataHome, "Trash")
  const filesDir = path.join(trashBase, "files")
  const infoDir = path.join(trashBase, "info")

  await ensureDir(filesDir)
  await ensureDir(infoDir)

  const name = await uniqueTrashName(path.basename(targetPath), filesDir)
  const destinationPath = path.join(filesDir, name)
  await movePath(targetPath, destinationPath)

  const infoPath = path.join(infoDir, `${name}.trashinfo`)
  const info = `[Trash Info]\nPath=${encodeURI(path.resolve(targetPath))}\nDeletionDate=${formatTrashDate(new Date())}\n`
  await fs.writeFile(infoPath, info, "utf8")
}

async function execPowerShell(script: string): Promise<void> {
  const candidates = ["pwsh", "powershell.exe", "powershell"]
  let lastError: unknown

  for (const shell of candidates) {
    try {
      await execFileAsync(shell, ["-NoProfile", "-NonInteractive", "-Command", script])
      return
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        lastError = err
        continue
      }
      throw err
    }
  }

  throw lastError ?? new Error("PowerShell not available")
}

async function moveToTrashWindows(targetPath: string): Promise<void> {
  const escaped = targetPath.replace(/'/g, "''")
  const script = [
    "Add-Type -AssemblyName Microsoft.VisualBasic;",
    `$path='${escaped}';`,
    "if (Test-Path -LiteralPath $path) {",
    "  if ((Get-Item -LiteralPath $path) -is [System.IO.DirectoryInfo]) {",
    "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path,'OnlyErrorDialogs','SendToRecycleBin');",
    "  } else {",
    "    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path,'OnlyErrorDialogs','SendToRecycleBin');",
    "  }",
    "}",
  ].join(" ")
  await execPowerShell(script)
}

async function moveToTrashFallback(targetPath: string): Promise<void> {
  const trashDir = path.join(os.homedir(), ".clawdlets-trash")
  await ensureDir(trashDir)
  const name = await uniqueTrashName(path.basename(targetPath), trashDir)
  await movePath(targetPath, path.join(trashDir, name))
}

export async function moveToTrash(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath)
  if (!(await pathExists(resolved))) return

  if (process.platform === "win32") {
    try {
      await moveToTrashWindows(resolved)
      return
    } catch {
      await moveToTrashFallback(resolved)
      return
    }
  }

  if (process.platform === "darwin") {
    await moveToTrashDarwin(resolved)
    return
  }

  try {
    await moveToTrashXdg(resolved)
  } catch {
    await moveToTrashFallback(resolved)
  }
}
