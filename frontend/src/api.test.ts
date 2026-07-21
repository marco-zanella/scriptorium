import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, streamMessage } from './api'

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
      } else {
        controller.close()
      }
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('streamMessage', () => {
  it('parses SSE frames split across chunk boundaries', async () => {
    // The boundary lands mid-JSON-string on purpose - the frame parser must
    // wait for the full \n\n-terminated frame before parsing, not try to
    // JSON.parse a partial chunk.
    const body = streamFromChunks([
      'data: {"type": "token", "text": "hel',
      'lo"}\n\n',
      'data: {"type": "done", "message": {"id": 1}}\n\n',
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body, headers: new Headers() }),
    )

    const events: unknown[] = []
    await streamMessage(1, 'hi', (event) => events.push(event))

    expect(events).toEqual([
      { type: 'token', text: 'hello' },
      { type: 'done', message: { id: 1 } },
    ])
  })

  it('parses multiple frames delivered in a single chunk', async () => {
    const body = streamFromChunks([
      'data: {"type": "tool_call", "status": "running", "name": "search_scriptorium", "args": {}}\n\ndata: {"type": "tool_call", "status": "done", "name": "search_scriptorium", "args": {}}\n\n',
    ])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, body, headers: new Headers() }),
    )

    const events: unknown[] = []
    await streamMessage(1, 'hi', (event) => events.push(event))

    expect(events).toHaveLength(2)
    expect((events[0] as { status: string }).status).toBe('running')
    expect((events[1] as { status: string }).status).toBe('done')
  })

  it('throws ApiError on a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        body: null,
        json: () => Promise.resolve({ detail: 'not found' }),
      }),
    )

    await expect(streamMessage(1, 'hi', () => {})).rejects.toBeInstanceOf(ApiError)
    await expect(streamMessage(1, 'hi', () => {})).rejects.toMatchObject({ status: 404 })
  })
})
