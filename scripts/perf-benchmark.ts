import { performance } from 'perf_hooks'
import * as constants from '../src/WABinary/constants'
import { decodeDecompressedBinaryNode } from '../src/WABinary/decode'
import { encodeBinaryNode } from '../src/WABinary/encode'
import { getBinaryNodeChildren } from '../src/WABinary/generic-utils'
import type { BinaryNode } from '../src/WABinary/types'

const iterations = Number(process.env.BENCH_ITERATIONS || 20_000)
const payload = Buffer.alloc(512, 0x61)
const node: BinaryNode = {
	tag: 'message',
	attrs: { id: 'BENCHMARK-MESSAGE-ID', to: '123456789@s.whatsapp.net', type: 'text' },
	content: [
		{ tag: 'enc', attrs: { v: '2', type: 'msg' }, content: payload },
		{
			tag: 'participants',
			attrs: {},
			content: [
				{ tag: 'to', attrs: { jid: '123456789@s.whatsapp.net' } },
				{ tag: 'to', attrs: { jid: '987654321@s.whatsapp.net' } }
			]
		}
	]
}

const encoded = encodeBinaryNode(node)
const report = (name: string, startedAt: number, count: number, bytes = 0) => {
	const elapsedMs = performance.now() - startedAt
	const opsPerSecond = (count / elapsedMs) * 1000
	const throughput = bytes ? `, ${((bytes / 1024 / 1024) / (elapsedMs / 1000)).toFixed(2)} MiB/s` : ''
	process.stdout.write(`${name}: ${opsPerSecond.toFixed(0)} ops/s${throughput} (${elapsedMs.toFixed(1)} ms)\\n`)
}

const run = async () => {
	for (let i = 0; i < 1_000; i++) {
		encodeBinaryNode(node)
		decodeDecompressedBinaryNode(encoded, constants)
		getBinaryNodeChildren(node.content?.[1] as BinaryNode, 'to')
	}

	const before = process.memoryUsage()
	let startedAt = performance.now()
	for (let i = 0; i < iterations; i++) encodeBinaryNode(node)
	report('Binary encode', startedAt, iterations, encoded.length * iterations)

	startedAt = performance.now()
	for (let i = 0; i < iterations; i++) decodeDecompressedBinaryNode(encoded, constants)
	report('Binary decode', startedAt, iterations, encoded.length * iterations)

	const childNode = node.content?.[1] as BinaryNode
	startedAt = performance.now()
	for (let i = 0; i < iterations * 10; i++) getBinaryNodeChildren(childNode, 'to')
	report('Indexed child lookup (10x)', startedAt, iterations * 10)

	const after = process.memoryUsage()
	process.stdout.write(
		`Memory delta: heap ${((after.heapUsed - before.heapUsed) / 1024 / 1024).toFixed(2)} MiB, RSS ${((after.rss - before.rss) / 1024 / 1024).toFixed(2)} MiB\\n`
	)
}

run().catch(error => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\\n`)
	process.exitCode = 1
})
