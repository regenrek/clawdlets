import { useCallback, useEffect, useRef, useState } from "react"
import { ClientOnly } from "@tanstack/react-router"
import type { editor as MonacoEditor } from "monaco-editor"
import { createDebouncedIdleRunner } from "~/lib/idle-debounce"

export type JsonEditorDiagnostic = {
  message: string
  severity: "error" | "warning"
  line: number
  column: number
  endLine: number
  endColumn: number
}

type MonacoJsonEditorProps = {
  value: string
  onChange: (value: string) => void
  schema: Record<string, unknown>
  schemaId: string
  readOnly?: boolean
  onDiagnostics?: (diagnostics: JsonEditorDiagnostic[]) => void
}

type MonacoModule = typeof import("monaco-editor")
type JsonLanguageService = import("vscode-json-languageservice").LanguageService
type JsonLanguageModule = {
  getLanguageService: typeof import("vscode-json-languageservice").getLanguageService
  TextDocument: typeof import("vscode-languageserver-textdocument").TextDocument
  DiagnosticSeverity: typeof import("vscode-languageserver-types").DiagnosticSeverity
}

const schemaCache = new Map<string, { value: string; expiresAt: number }>()
const schemaFailureCache = new Map<string, { message: string; expiresAt: number }>()
const schemaInFlight = new Map<string, Promise<string>>()
const SCHEMA_CACHE_MAX = 24
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000
const SCHEMA_FAILURE_CACHE_TTL_MS = 15 * 1000

let monacoLoadPromise: Promise<MonacoModule> | null = null
let jsonLanguageModulePromise: Promise<JsonLanguageModule> | null = null
let editorInstanceCounter = 0

async function loadMonaco(): Promise<MonacoModule> {
  if (!monacoLoadPromise) {
    monacoLoadPromise = (async () => {
      const [{ setupMonacoEnvironment }, monaco] = await Promise.all([
        import("~/lib/monaco-env"),
        import("monaco-editor"),
        import("monaco-editor/min/vs/editor/editor.main.css"),
      ])
      setupMonacoEnvironment()
      return monaco
    })()
  }
  return await monacoLoadPromise
}

async function loadJsonLanguageModule(): Promise<JsonLanguageModule> {
  if (!jsonLanguageModulePromise) {
    jsonLanguageModulePromise = (async () => {
      const [{ getLanguageService }, { TextDocument }, { DiagnosticSeverity }] = await Promise.all([
        import("vscode-json-languageservice"),
        import("vscode-languageserver-textdocument"),
        import("vscode-languageserver-types"),
      ])
      return { getLanguageService, TextDocument, DiagnosticSeverity }
    })()
  }
  return await jsonLanguageModulePromise
}

function resolveSchemaPath(relative: string, resource: string) {
  try {
    const base = new URL(resource)
    return new URL(relative, base).toString()
  } catch {
    return relative
  }
}

function normalizeSchemaUri(uri: string): string {
  return uri.trim()
}

const MAX_SCHEMA_BYTES = 512 * 1024
const SCHEMA_TIMEOUT_MS = 3000

function getAllowedOrigin(): string | null {
  if (typeof window === "undefined") return null
  return window.location.origin
}

function touchCache(key: string, entry: { value: string; expiresAt: number }) {
  schemaCache.delete(key)
  schemaCache.set(key, entry)
}

function touchFailureCache(key: string, entry: { message: string; expiresAt: number }) {
  schemaFailureCache.delete(key)
  schemaFailureCache.set(key, entry)
}

function getCachedSchema(uri: string, now: number): string | null {
  const cached = schemaCache.get(uri)
  if (!cached) return null
  if (cached.expiresAt <= now) {
    schemaCache.delete(uri)
    return null
  }
  touchCache(uri, cached)
  return cached.value
}

function getCachedSchemaFailure(uri: string, now: number): string | null {
  const cached = schemaFailureCache.get(uri)
  if (!cached) return null
  if (cached.expiresAt <= now) {
    schemaFailureCache.delete(uri)
    return null
  }
  touchFailureCache(uri, cached)
  return cached.message
}

function storeSchema(uri: string, value: string) {
  schemaCache.set(uri, { value, expiresAt: Date.now() + SCHEMA_CACHE_TTL_MS })
  if (schemaCache.size <= SCHEMA_CACHE_MAX) return
  const overflow = schemaCache.size - SCHEMA_CACHE_MAX
  let removed = 0
  for (const key of schemaCache.keys()) {
    schemaCache.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

function storeSchemaFailure(uri: string, message: string) {
  schemaFailureCache.set(uri, { message, expiresAt: Date.now() + SCHEMA_FAILURE_CACHE_TTL_MS })
  if (schemaFailureCache.size <= SCHEMA_CACHE_MAX) return
  const overflow = schemaFailureCache.size - SCHEMA_CACHE_MAX
  let removed = 0
  for (const key of schemaFailureCache.keys()) {
    schemaFailureCache.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

async function schemaRequestService(uri: string): Promise<string> {
  const normalized = normalizeSchemaUri(uri)
  if (!/^https?:\/\//i.test(normalized)) throw new Error(`unsupported schema uri: ${normalized}`)
  const allowedOrigin = getAllowedOrigin()
  let targetOrigin = ""
  try {
    targetOrigin = new URL(normalized).origin
  } catch {
    throw new Error("invalid schema uri")
  }
  if (!allowedOrigin || targetOrigin !== allowedOrigin) {
    throw new Error("schema fetch blocked by origin policy")
  }
  const now = Date.now()
  const cachedFailure = getCachedSchemaFailure(normalized, now)
  if (cachedFailure) throw new Error(cachedFailure)
  const cached = getCachedSchema(normalized, now)
  if (cached) return cached
  const inFlight = schemaInFlight.get(normalized)
  if (inFlight) return await inFlight

  const task = (async () => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), SCHEMA_TIMEOUT_MS)
    try {
      const res = await fetch(normalized, { signal: controller.signal, redirect: "error" })
      if (!res.ok) throw new Error(`schema fetch failed: ${res.status}`)
      const text = await res.text()
      if (text.length > MAX_SCHEMA_BYTES) throw new Error("schema too large")
      storeSchema(normalized, text)
      return text
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      storeSchemaFailure(normalized, message)
      throw new Error(message)
    } finally {
      window.clearTimeout(timer)
    }
  })()

  schemaInFlight.set(normalized, task)
  try {
    return await task
  } finally {
    schemaInFlight.delete(normalized)
  }
}

export async function __test_schemaRequestService(uri: string): Promise<string> {
  return await schemaRequestService(uri)
}

export function __test_resetSchemaCache(): void {
  schemaCache.clear()
  schemaFailureCache.clear()
  schemaInFlight.clear()
}

export function __test_getSchemaFailureTtlMs(): number {
  return SCHEMA_FAILURE_CACHE_TTL_MS
}

function MonacoJsonEditorInner(props: MonacoJsonEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const modelRef = useRef<MonacoEditor.ITextModel | null>(null)
  const monacoRef = useRef<MonacoModule | null>(null)
  const applyingExternalChange = useRef(false)
  const loadRequested = useRef(false)
  const focusOnLoad = useRef(false)
  const instanceIdRef = useRef("")
  if (!instanceIdRef.current) instanceIdRef.current = String((editorInstanceCounter += 1))
  const currentSchemaId = useRef("")
  const schemaRef = useRef(props.schema)
  const schemaIdRef = useRef(props.schemaId)
  const onChangeRef = useRef(props.onChange)
  const onDiagnosticsRef = useRef(props.onDiagnostics)
  const valueRef = useRef(props.value)
  const validationRunner = useRef<ReturnType<typeof createDebouncedIdleRunner> | null>(null)
  const validationRunId = useRef(0)
  const languageModuleRef = useRef<JsonLanguageModule | null>(null)
  const languageServiceRef = useRef<JsonLanguageService | null>(null)
  const languageServicePromiseRef = useRef<Promise<JsonLanguageService> | null>(null)
  const themeObserverCleanupRef = useRef<(() => void) | null>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [isLoaded, setIsLoaded] = useState(false)

  const ensureLanguageService = useCallback(async () => {
    if (languageServiceRef.current) return languageServiceRef.current
    if (!languageServicePromiseRef.current) {
      languageServicePromiseRef.current = (async () => {
        const module = await loadJsonLanguageModule()
        languageModuleRef.current = module
        const service = module.getLanguageService({
          schemaRequestService,
          workspaceContext: {
            resolveRelativePath: resolveSchemaPath,
          },
        })
        languageServiceRef.current = service
        return service
      })()
    }
    return await languageServicePromiseRef.current
  }, [])

  const scheduleValidation = () => {
    if (!monacoRef.current || !modelRef.current) return
    if (!validationRunner.current) {
      validationRunner.current = createDebouncedIdleRunner({
        fn: () => void validateNow(),
        delayMs: 400,
        timeoutMs: 1000,
      })
    }
    validationRunner.current.schedule()
  }

  const validateNow = async () => {
    const runId = (validationRunId.current += 1)
    const monaco = monacoRef.current
    const model = modelRef.current
    if (!monaco || !model) return
    const schema = schemaRef.current
    const schemaId = schemaIdRef.current
    if (!schema || !schemaId) return
    const languageService = await ensureLanguageService()
    const languageModule = languageModuleRef.current
    if (!languageModule) return

    if (currentSchemaId.current !== schemaId) {
      languageService.configure({
        validate: true,
        allowComments: false,
        schemas: [
          {
            uri: `inmemory://schema/${schemaId}`,
            fileMatch: [model.uri.toString()],
            schema,
          },
        ],
      })
      currentSchemaId.current = schemaId
    }

    const document = languageModule.TextDocument.create(
      model.uri.toString(),
      "json",
      model.getVersionId(),
      model.getValue(),
    )
    const jsonDocument = languageService.parseJSONDocument(document)
    const diagnostics = await languageService.doValidation(document, jsonDocument)
    if (runId !== validationRunId.current) return

    const markers = diagnostics.map((diag) => {
      const severity =
        diag.severity === languageModule.DiagnosticSeverity.Error
          ? monaco.MarkerSeverity.Error
          : monaco.MarkerSeverity.Warning
      return {
        severity,
        message: diag.message,
        startLineNumber: diag.range.start.line + 1,
        startColumn: diag.range.start.character + 1,
        endLineNumber: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1,
      } satisfies MonacoEditor.IMarkerData
    })

    monaco.editor.setModelMarkers(model, "clawdbot-schema", markers)

    const onDiagnostics = onDiagnosticsRef.current
    if (onDiagnostics) {
      const list = diagnostics.map((diag) => ({
        message: diag.message,
        severity: diag.severity === languageModule.DiagnosticSeverity.Error ? "error" : "warning",
        line: diag.range.start.line + 1,
        column: diag.range.start.character + 1,
        endLine: diag.range.end.line + 1,
        endColumn: diag.range.end.character + 1,
      })) satisfies JsonEditorDiagnostic[]
      onDiagnostics(list)
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return
    if (!containerRef.current) return
    if (!shouldLoad) return

    let disposed = false

    void (async () => {
      const monaco = await loadMonaco()
      if (disposed) return
      monacoRef.current = monaco

      ;(monaco.languages as any).json?.jsonDefaults?.setDiagnosticsOptions({ validate: false })

      const model = monaco.editor.createModel(
        valueRef.current,
        "json",
        monaco.Uri.parse(`inmemory://clawdbot/${instanceIdRef.current}/config.json`),
      )
      modelRef.current = model

      const editor = monaco.editor.create(containerRef.current!, {
        model,
        readOnly: props.readOnly ?? false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        automaticLayout: true,
      })

      editorRef.current = editor

      editor.onDidChangeModelContent(() => {
        if (applyingExternalChange.current) return
        const value = model.getValue()
        onChangeRef.current(value)
        scheduleValidation()
      })

      scheduleValidation()

      const updateTheme = () => {
        const isDark = document.documentElement.classList.contains("dark")
        monaco.editor.setTheme(isDark ? "vs-dark" : "vs")
      }
      updateTheme()
      const observer = new MutationObserver(updateTheme)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
      themeObserverCleanupRef.current = () => observer.disconnect()
      setIsLoaded(true)
      if (focusOnLoad.current) {
        focusOnLoad.current = false
        editor.focus()
      }
    })()

    return () => {
      disposed = true
      validationRunner.current?.cancel()
      const editor = editorRef.current
      const model = modelRef.current
      themeObserverCleanupRef.current?.()
      themeObserverCleanupRef.current = null
      editor?.dispose()
      model?.dispose()
      editorRef.current = null
      modelRef.current = null
      monacoRef.current = null
    }
  }, [shouldLoad])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    editor.updateOptions({ readOnly: props.readOnly ?? false })
  }, [props.readOnly])

  useEffect(() => {
    valueRef.current = props.value
    const model = modelRef.current
    if (!model) return
    if (model.getValue() === props.value) return
    applyingExternalChange.current = true
    model.setValue(props.value)
    applyingExternalChange.current = false
    scheduleValidation()
  }, [props.value])

  useEffect(() => {
    schemaRef.current = props.schema
    schemaIdRef.current = props.schemaId
    onChangeRef.current = props.onChange
    onDiagnosticsRef.current = props.onDiagnostics
    scheduleValidation()
  }, [props.schema, props.schemaId, props.onChange, props.onDiagnostics])

  const requestLoad = useCallback((focus: boolean) => {
    if (loadRequested.current) return
    loadRequested.current = true
    focusOnLoad.current = focus
    setShouldLoad(true)
  }, [])

  return (
    <div ref={containerRef} className="relative h-full w-full" aria-busy={shouldLoad && !isLoaded}>
      {!isLoaded && (
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-muted-foreground/40 bg-muted/10 text-sm text-muted-foreground"
          onClick={() => requestLoad(true)}
          onFocus={() => requestLoad(true)}
          aria-label="Load JSON editor"
        >
          {shouldLoad ? "Loading editor…" : "Click or focus to load editor"}
        </button>
      )}
    </div>
  )
}

export function MonacoJsonEditor(props: MonacoJsonEditorProps) {
  return (
    <ClientOnly
      fallback={
        <div className="relative h-full w-full rounded-md border border-dashed border-muted-foreground/40 bg-muted/10 text-sm text-muted-foreground flex items-center justify-center">
          Loading editor…
        </div>
      }
    >
      <MonacoJsonEditorInner {...props} />
    </ClientOnly>
  )
}
