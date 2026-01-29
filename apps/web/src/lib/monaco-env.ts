import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker"

let configured = false

export function setupMonacoEnvironment() {
  if (configured) return
  if (typeof window === "undefined") return
  ;(self as any).MonacoEnvironment = {
    getWorker: (_: unknown, label: string) => {
      if (label === "json") return new JsonWorker()
      return new EditorWorker()
    },
  }
  configured = true
}
