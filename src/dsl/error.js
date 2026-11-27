export class DslError extends SyntaxError {
  constructor(message, location = {}, code) {
    const sourceName = location.sourceName ?? '<dsl>'
    const line = location.line ?? 1
    const column = location.column ?? 1
    super(`${sourceName}:${line}:${column}: ${message}`)
    this.name = 'DslError'
    if (code) this.code = code
    this.sourceName = sourceName
    this.line = line
    this.column = column
  }
}
