import { jest } from '@jest/globals'
import P from 'pino'
import { LIDMappingStore } from '../../Signal/lid-mapping'
import type { LIDMapping, SignalDataTypeMap, SignalKeyStoreWithTransaction } from '../../Types'

const HOSTED_DEVICE_ID = 99

const mockKeys: jest.Mocked<SignalKeyStoreWithTransaction> = {
	get: jest.fn<SignalKeyStoreWithTransaction['get']>() as any,
	set: jest.fn<SignalKeyStoreWithTransaction['set']>(),
	transaction: jest.fn<SignalKeyStoreWithTransaction['transaction']>(async (work: () => any) => await work()) as any,
	isInTransaction: jest.fn<SignalKeyStoreWithTransaction['isInTransaction']>()
}
const logger = P({ level: 'silent' })

describe('LIDMappingStore', () => {
	const mockPnToLIDFunc = jest.fn<(jids: string[]) => Promise<LIDMapping[] | undefined>>()
	let lidMappingStore: LIDMappingStore

	beforeEach(() => {
		jest.clearAllMocks()
		lidMappingStore = new LIDMappingStore(mockKeys, logger, mockPnToLIDFunc)
	})

	describe('getPNForLID', () => {
		it('should correctly map a standard LID with a hosted device ID back to a standard PN with a hosted device', async () => {
			const lidWithHostedDevice = `12345:${HOSTED_DEVICE_ID}@lid`
			const pnUser = '54321'

			// @ts-ignore
			mockKeys.get.mockResolvedValue({ [`12345_reverse`]: pnUser } as SignalDataTypeMap['lid-mapping'])

			const result = await lidMappingStore.getPNForLID(lidWithHostedDevice)
			expect(result).toBe(`${pnUser}:${HOSTED_DEVICE_ID}@s.whatsapp.net`)
		})

		it('should return null if no reverse mapping is found', async () => {
			const lid = 'nonexistent@lid'

			// @ts-ignore
			mockKeys.get.mockResolvedValue({} as SignalDataTypeMap['lid-mapping']) // Simulate not found in DB

			const result = await lidMappingStore.getPNForLID(lid)
			expect(result).toBeNull()
		})
	})
	describe('storeLIDPNMappings', () => {
		it('returns only newly stored mappings and makes repeated mappings a no-op', async () => {
			mockKeys.get.mockResolvedValue({} as never)
			const pair = { lid: '111@lid', pn: '222@s.whatsapp.net' }
			const first = await lidMappingStore.storeLIDPNMappings([pair])
			const second = await lidMappingStore.storeLIDPNMappings([pair])
			expect(first).toEqual([{ pnUser: '222', lidUser: '111' }])
			expect(second).toEqual([])
			expect(mockKeys.set).toHaveBeenCalledTimes(1)
		})

		it('reports a concurrent new mapping only once', async () => {
			const db: Record<string, string> = {}
			const set = jest.fn(async (data: { 'lid-mapping'?: Record<string, string> }) => {
				Object.assign(db, data['lid-mapping'] || {})
			})
			const keys = {
				get: async (_type: string, ids: string[]) => {
					await new Promise(resolve => setTimeout(resolve, 5))
					return Object.fromEntries(ids.filter(id => id in db).map(id => [id, db[id]]))
				},
				set,
				transaction: async (work: () => Promise<unknown>) => work(),
				isInTransaction: () => false
			} as unknown as SignalKeyStoreWithTransaction
			const store = new LIDMappingStore(keys, logger)
			const pair = { lid: '333@lid', pn: '444@s.whatsapp.net' }
			const [first, second] = await Promise.all([store.storeLIDPNMappings([pair]), store.storeLIDPNMappings([pair])])
			expect([...first, ...second]).toEqual([{ pnUser: '444', lidUser: '333' }])
			expect(set).toHaveBeenCalledTimes(1)
		})
	})
})
