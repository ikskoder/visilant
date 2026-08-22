// A client for the Firefox remote debugging protocol, cut down to what these
// tests need.
//
// The wire format is `<byte length>:<json>`. Every packet names the actor it is
// addressed to or came from, and a request is answered by a packet from the same
// actor – with events from other actors free to arrive in between, which is why
// replies are matched rather than simply read.
import { Buffer } from 'node:buffer'
import net from 'node:net'

export interface Packet { from?: string, type?: string, [key: string]: unknown }

export class Rdp {
  private socket: net.Socket
  private buffer = Buffer.alloc(0)
  private waiters: ((packet: Packet) => void)[] = []
  private queue: Packet[] = []
  private closed: Error | null = null

  private constructor(socket: net.Socket) {
    this.socket = socket
    socket.on('data', chunk => this.absorb(chunk))
    socket.on('error', error => this.fail(error))
    socket.on('close', () => this.fail(new Error('debugger connection closed')))
  }

  static connect(port: number, host = '127.0.0.1'): Promise<Rdp> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ port, host })
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.removeListener('error', reject)
        resolve(new Rdp(socket))
      })
    })
  }

  private fail(error: Error) {
    this.closed = error
    for (const waiter of this.waiters.splice(0))
      waiter({ from: '__closed__', error: error.message })
  }

  private absorb(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (true) {
      const colon = this.buffer.indexOf(0x3A) // ':'
      if (colon < 0)
        return
      const length = Number(this.buffer.subarray(0, colon).toString('ascii'))
      if (!Number.isFinite(length))
        return
      if (this.buffer.length < colon + 1 + length)
        return
      const body = this.buffer.subarray(colon + 1, colon + 1 + length).toString('utf8')
      this.buffer = this.buffer.subarray(colon + 1 + length)
      const packet = JSON.parse(body) as Packet
      const waiter = this.waiters.shift()
      if (waiter)
        waiter(packet)
      else
        this.queue.push(packet)
    }
  }

  /** Next packet off the wire, whoever it is from. */
  next(timeoutMs = 30_000): Promise<Packet> {
    const queued = this.queue.shift()
    if (queued)
      return Promise.resolve(queued)
    if (this.closed)
      return Promise.reject(this.closed)
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const waiter = (packet: Packet) => {
        clearTimeout(timer)
        resolve(packet)
      }
      timer = setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== waiter)
        reject(new Error('timed out waiting for the debugger'))
      }, timeoutMs)
      this.waiters.push(waiter)
    })
  }

  send(packet: Packet & { to: string }) {
    const body = Buffer.from(JSON.stringify(packet), 'utf8')
    this.socket.write(`${body.length}:`)
    this.socket.write(body)
  }

  /** Send, then read past unrelated events until this actor answers. */
  async request(packet: Packet & { to: string }, timeoutMs = 30_000): Promise<Packet> {
    this.send(packet)
    while (true) {
      const reply = await this.next(timeoutMs)
      if (reply.from === packet.to)
        return reply
      if (reply.from === '__closed__')
        throw new Error(String(reply.error))
    }
  }

  /** Collect whatever arrives for a while. Used for target-available-form. */
  async drain(ms: number): Promise<Packet[]> {
    const collected: Packet[] = []
    const until = Date.now() + ms
    while (Date.now() < until) {
      try {
        collected.push(await this.next(Math.max(1, until - Date.now())))
      }
      catch {
        break
      }
    }
    return collected
  }

  close() {
    this.socket.destroy()
  }
}
