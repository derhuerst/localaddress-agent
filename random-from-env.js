import createDebug from 'debug'
import {createRandomAddressesGenerator} from './lib/random-addresses-from-range.js'
import {createIpPoolAgent} from './index.js'
import {withSoftExit} from './lib/soft-exit.js'

const debug = createDebug('localaddress-agent:random-from-env')

let randomLocalAddressAgent = null

if (process.env.RANDOM_LOCAL_ADDRESSES_RANGE) {
	const range = process.env.RANDOM_LOCAL_ADDRESSES_RANGE
	const iface = process.env.RANDOM_LOCAL_ADDRESSES_INTERFACE || 'eth0'
	const deleteOnExit = process.env.RANDOM_LOCAL_ADDRESSES_DELETE_ON_EXIT !== 'false'

	debug(`creating an HTTP Agent that assigns random addresses from ${range} to ${iface}`)
	const randomAddresses = createRandomAddressesGenerator(range)()
	randomLocalAddressAgent = await createIpPoolAgent(
		randomAddresses,
		iface,
	)

	if (deleteOnExit) {
		withSoftExit(() => {
			randomLocalAddressAgent.destroy()
			.catch((err) => {
				console.error(err)
				process.exit()
			})
		})
	}
} else {
	debug('not creating an HTTP Agent because $RANDOM_LOCAL_ADDRESSES_RANGE is missing/empty')
}

setTimeout(() => {}, 20_1000)

export {
	randomLocalAddressAgent,
}
