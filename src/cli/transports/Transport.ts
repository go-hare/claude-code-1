import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'

/** WebSocket / SSE+POST / Hybrid 等会话上行传输的共有接口。 */
export type Transport = {
  setOnData(callback: (data: string) => void): void // 注册下行数据回调（按行文本）
  setOnClose(callback: (closeCode?: number, cause?: string) => void): void // 连接关闭时回调（可选关闭码 + 分类 cause）
  connect(): void | Promise<void> // 建立或重连传输
  write(message: StdoutMessage): void | Promise<void> // 向上游发送一条控制/流式消息
  close(): void // 主动关闭并释放资源
}
