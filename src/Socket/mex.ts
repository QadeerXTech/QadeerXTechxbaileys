import { Boom } from '@hapi/boom'
import type { BinaryNode } from '../WABinary'
import { getBinaryNodeChild, S_WHATSAPP_NET } from '../WABinary'

const wMexQuery = (
	variables: Record<string, unknown>,
	queryId: string,
	query: (node: BinaryNode) => Promise<BinaryNode>,
	generateMessageTag: () => string
) => {
	return query({
		tag: 'iq',
		attrs: {
			id: generateMessageTag(),
			type: 'get',
			to: S_WHATSAPP_NET,
			xmlns: 'w:mex'
		},
		content: [
			{
				tag: 'query',
				attrs: { query_id: queryId },
				content: Buffer.from(JSON.stringify({ variables }), 'utf-8')
			}
		]
	})
}

export const executeWMexQuery = async <T>(
	variables: Record<string, unknown>,
	queryId: string,
	dataPath: string,
	query: (node: BinaryNode) => Promise<BinaryNode>,
	generateMessageTag: () => string
): Promise<T> => {
	const result = await wMexQuery(variables, queryId, query, generateMessageTag)
	const child = getBinaryNodeChild(result, 'result')
	if (child?.content) {
		const raw = child.content.toString()
		let data: ReturnType<typeof JSON.parse>
		try {
			data = JSON.parse(raw)
		} catch {
			// The server sometimes prefixes the JSON with binary bytes
			// (seen on WA 1054670094: content starts with \u0004 + JID bytes
			// instead of '{'). Find the first '{' and parse from there.
			const braceIdx = raw.indexOf('{')
			if (braceIdx > 0) {
				data = JSON.parse(raw.slice(braceIdx))
			} else {
				// Binary newsletter response (WA 1054670094 / Android): the server
				// returns the metadata as binary (JID + ACTIVE + name), not JSON.
				// Pass the raw string through so parseNewsletterMetadata can
				// extract the fields; anything else is still an error.
				if (raw.includes('@newsletter')) {
					return raw as unknown as T
				}
				throw new Boom(`WMex response is not JSON (first 120 chars): ${JSON.stringify(raw.slice(0, 120))}`, { statusCode: 400 })
			}
		}

		if (data.errors && data.errors.length > 0) {
			const errorMessages = data.errors.map((err: Error) => err.message || 'Unknown error').join(', ')
			const firstError = data.errors[0]
			const errorCode = firstError.extensions?.error_code || 400
			throw new Boom(`GraphQL server error: ${errorMessages}`, { statusCode: errorCode, data: firstError })
		}

		const response = dataPath ? data?.data?.[dataPath] : data?.data
		if (typeof response !== 'undefined') {
			return response as T
		}
	}

	const action = (dataPath || '').startsWith('xwa2_')
		? dataPath.substring(5).replace(/_/g, ' ')
		: dataPath?.replace(/_/g, ' ')
	throw new Boom(`Failed to ${action}, unexpected response structure.`, { statusCode: 400, data: result })
}
