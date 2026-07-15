export class CslError extends SyntaxError {
  constructor(message, location = {}) {
    const sourceName = location.sourceName ?? '<csl>'
    const line = location.line ?? 1
    const column = location.column ?? 1
    super(`${sourceName}:${line}:${column}: ${message}`)
    this.name = 'CslError'
    this.sourceName = sourceName
    this.line = line
    this.column = column
  }
}
