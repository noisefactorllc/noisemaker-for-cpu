export class DslError extends SyntaxError {
  constructor(message, location = {}) {
    const sourceName = location.sourceName ?? '<dsl>'
    const line = location.line ?? 1
    const column = location.column ?? 1
    super(`${sourceName}:${line}:${column}: ${message}`)
    this.name = 'DslError'
    this.sourceName = sourceName
    this.line = line
    this.column = column
  }
}
