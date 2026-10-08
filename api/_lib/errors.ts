/**
 * 錯誤型別獨立成一個沒有相依的模組，這樣 auth.ts 之類的檔案不必為了拿 HttpError
 * 而把整個 Google Sheets client 一起拉進來（測試與冷啟動都比較便宜）。
 */

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export class SheetsError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message)
    this.name = 'SheetsError'
  }
}
